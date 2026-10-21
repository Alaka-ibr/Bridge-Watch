import { describe, it, expect, vi, beforeEach } from "vitest";
import { IncidentService, type CreateIncidentPayload } from "../../src/services/incident.service.js";
import { enrichmentPipelineService } from "../../src/services/enrichment/index.js";

// Mock enrichment pipeline
vi.mock("../../src/services/enrichment/index.js", () => ({
  enrichmentPipelineService: {
    enrich: vi.fn().mockResolvedValue({
      metadata: { enriched: true, confidence: 0.95 },
      tags: ["defi", "liquidity"],
      derivedFields: { riskScore: 85 },
      validation: { isValid: true },
      attempts: 1,
    }),
  },
}));

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

type MockRow = Record<string, unknown>;

function createMockKnex() {
  let tableData: Record<string, MockRow[]> = {
    bridge_incidents: [],
    bridge_incident_reads: [],
    bridge_incident_ingestion_history: [],
  };

  const knex = vi.fn((tableName: string) => {
    let rows = [...(tableData[tableName] ?? [])];
    const whereConditions: Array<Record<string, unknown> | ((qb: unknown) => void)> = [];
    let limitVal: number | null = null;
    let offsetVal: number = 0;
    let orderByCol: string | null = null;
    let orderDir: string = "asc";

    const queryBuilder: any = {
      where: vi.fn((condition: any, val?: any) => {
        if (typeof condition === "function") {
          const subQb = {
            where: (c: any, v?: any) => {
              if (typeof c === "string") {
                whereConditions.push({ [c]: v });
              }
              return subQb;
            },
          };
          condition(subQb);
        } else if (typeof condition === "string") {
          whereConditions.push({ [condition]: val });
        } else if (typeof condition === "object") {
          whereConditions.push(condition);
        }
        return queryBuilder;
      }),
      leftJoin: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
      orderBy: vi.fn((col: string, dir: string = "asc") => {
        orderByCol = col;
        orderDir = dir;
        return queryBuilder;
      }),
      limit: vi.fn((n: number) => {
        limitVal = n;
        return queryBuilder;
      }),
      offset: vi.fn((n: number) => {
        offsetVal = n;
        return queryBuilder;
      }),
      select: vi.fn(async () => {
        let filtered = applyFilters(rows, whereConditions);
        if (orderByCol) {
          filtered.sort((a, b) => {
            const valA = String(a[orderByCol!]);
            const valB = String(b[orderByCol!]);
            return orderDir === "desc" ? valB.localeCompare(valA) : valA.localeCompare(valB);
          });
        }
        if (offsetVal) filtered = filtered.slice(offsetVal);
        if (limitVal !== null) filtered = filtered.slice(0, limitVal);
        return filtered;
      }),
      first: vi.fn(async () => {
        const filtered = applyFilters(rows, whereConditions);
        return filtered[0] ?? null;
      }),
      count: vi.fn(async () => {
        const filtered = applyFilters(rows, whereConditions);
        return [{ count: String(filtered.length) }];
      }),
      clone: vi.fn(() => queryBuilder),
      insert: vi.fn((data: any) => {
        const newRow = {
          id: data.id || `inc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          status: data.status || "open",
          created_at: new Date(),
          updated_at: new Date(),
          resolved_at: null,
          requires_manual_review: false,
          ingestion_attempt_count: 0,
          last_ingestion_error: null,
          normalized_fingerprint: null,
          ...data,
        };
        tableData[tableName] = [...(tableData[tableName] ?? []), newRow];

        const insertChain: any = {
          returning: vi.fn(async () => [newRow]),
          onConflict: vi.fn(() => ({
            ignore: vi.fn().mockResolvedValue(1),
          })),
        };
        return insertChain;
      }),
      update: vi.fn((updateData: any) => ({
        returning: vi.fn(async () => {
          const filtered = applyFilters(rows, whereConditions);
          if (filtered.length === 0) return [];
          const updatedRow = { ...filtered[0], ...updateData, updated_at: new Date() };
          tableData[tableName] = tableData[tableName].map((r) =>
            r.id === updatedRow.id ? updatedRow : r
          );
          return [updatedRow];
        }),
      })),
    };

    return queryBuilder;
  });

  function applyFilters(
    data: MockRow[],
    conditions: Array<Record<string, unknown> | ((qb: unknown) => void)>
  ) {
    return data.filter((row) => {
      for (const cond of conditions) {
        if (typeof cond === "object") {
          for (const [key, val] of Object.entries(cond)) {
            if (row[key] !== val) return false;
          }
        }
      }
      return true;
    });
  }

  return {
    knex,
    setTableData: (table: string, data: MockRow[]) => {
      tableData[table] = data;
    },
    getTableData: (table: string) => tableData[table] ?? [],
    reset: () => {
      tableData = {
        bridge_incidents: [],
        bridge_incident_reads: [],
        bridge_incident_ingestion_history: [],
      };
    },
  };
}

const mockDb = createMockKnex();

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => mockDb.knex,
}));

describe("IncidentService Unit Tests", () => {
  let service: IncidentService;

  beforeEach(() => {
    mockDb.reset();
    vi.clearAllMocks();
    service = new IncidentService();
  });

  describe("createIncident", () => {
    it("creates an incident with enrichment pipeline data", async () => {
      const payload: CreateIncidentPayload = {
        bridgeId: "bridge-stellar-eth",
        assetCode: "USDC",
        severity: "high",
        title: "Large liquidity outflow detected",
        description: "Abnormal volume spike exceeding 500k within 5 minutes",
        sourceType: "indexer",
        sourceExternalId: "ext-123",
        sourceUrl: "https://explorer.example.com/tx/123",
        sourceRepository: "stellar/bridge-node",
        sourceActor: "operator-01",
        sourceAttribution: { detectedBy: "VolumeAnomalyEngine" },
        followUpActions: ["Freeze liquidity pool", "Alert security team"],
        occurredAt: "2026-09-27T12:00:00.000Z",
      };

      const result = await service.createIncident(payload);

      expect(enrichmentPipelineService.enrich).toHaveBeenCalledWith(
        expect.objectContaining({
          recordType: "incident",
          provider: "indexer",
        })
      );
      expect(result.id).toBeDefined();
      expect(result.bridgeId).toBe("bridge-stellar-eth");
      expect(result.assetCode).toBe("USDC");
      expect(result.severity).toBe("high");
      expect(result.status).toBe("open");
      expect(result.title).toBe("Large liquidity outflow detected");
      expect(result.followUpActions).toEqual(["Freeze liquidity pool", "Alert security team"]);
      expect(result.enrichmentTags).toEqual(["defi", "liquidity"]);
    });

    it("falls back to manual defaults if optional fields are omitted", async () => {
      const payload: CreateIncidentPayload = {
        bridgeId: "bridge-generic",
        severity: "low",
        title: "Minor latency warning",
        description: "Latency exceeded 2000ms",
      };

      const result = await service.createIncident(payload);
      expect(result.sourceType).toBeNull();
      expect(result.assetCode).toBeNull();
      expect(result.resolvedAt).toBeNull();
    });
  });

  describe("listIncidents & getIncident", () => {
    beforeEach(() => {
      mockDb.setTableData("bridge_incidents", [
        {
          id: "inc-1",
          bridge_id: "bridge-1",
          asset_code: "XLM",
          severity: "critical",
          status: "open",
          title: "Bridge exploit attempt",
          description: "Malicious contract call",
          source_attribution: JSON.stringify({}),
          enrichment_metadata: JSON.stringify({}),
          enrichment_tags: ["exploit"],
          derived_fields: JSON.stringify({}),
          enrichment_validation: JSON.stringify({}),
          follow_up_actions: JSON.stringify([]),
          occurred_at: new Date("2026-09-27T10:00:00Z"),
          created_at: new Date("2026-09-27T10:00:00Z"),
          updated_at: new Date("2026-09-27T10:00:00Z"),
        },
        {
          id: "inc-2",
          bridge_id: "bridge-2",
          asset_code: "USDC",
          severity: "medium",
          status: "resolved",
          title: "Temporary RPC timeout",
          description: "Horizon node restarted",
          source_attribution: JSON.stringify({}),
          enrichment_metadata: JSON.stringify({}),
          enrichment_tags: ["rpc"],
          derived_fields: JSON.stringify({}),
          enrichment_validation: JSON.stringify({}),
          follow_up_actions: JSON.stringify([]),
          occurred_at: new Date("2026-09-27T08:00:00Z"),
          created_at: new Date("2026-09-27T08:00:00Z"),
          updated_at: new Date("2026-09-27T08:30:00Z"),
          resolved_at: new Date("2026-09-27T08:30:00Z"),
        },
      ]);
    });

    it("lists all incidents with total count", async () => {
      const { incidents, total } = await service.listIncidents();
      expect(total).toBe(2);
      expect(incidents.length).toBe(2);
      expect(incidents[0].id).toBe("inc-1");
    });

    it("filters incidents by bridgeId", async () => {
      const { incidents } = await service.listIncidents({ bridgeId: "bridge-1" });
      expect(incidents.length).toBe(1);
      expect(incidents[0].bridgeId).toBe("bridge-1");
    });

    it("filters incidents by severity and status", async () => {
      const { incidents } = await service.listIncidents({
        severity: "medium",
        status: "resolved",
      });
      expect(incidents.length).toBe(1);
      expect(incidents[0].id).toBe("inc-2");
    });

    it("returns specific incident by id", async () => {
      const incident = await service.getIncident("inc-1");
      expect(incident).not.toBeNull();
      expect(incident?.title).toBe("Bridge exploit attempt");
    });

    it("returns null when incident not found", async () => {
      const incident = await service.getIncident("non-existent");
      expect(incident).toBeNull();
    });
  });

  describe("updateIncidentStatus & updateIncidentSeverity", () => {
    beforeEach(() => {
      mockDb.setTableData("bridge_incidents", [
        {
          id: "inc-1",
          bridge_id: "bridge-1",
          severity: "high",
          status: "open",
          title: "Incident 1",
          description: "Desc",
          source_attribution: "{}",
          enrichment_metadata: "{}",
          enrichment_tags: [],
          derived_fields: "{}",
          enrichment_validation: "{}",
          follow_up_actions: "[]",
          occurred_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);
    });

    it("updates status to investigating without setting resolved_at", async () => {
      const updated = await service.updateIncidentStatus("inc-1", "investigating");
      expect(updated?.status).toBe("investigating");
      expect(updated?.resolvedAt).toBeNull();
    });

    it("updates status to resolved and populates resolved_at", async () => {
      const updated = await service.updateIncidentStatus("inc-1", "resolved");
      expect(updated?.status).toBe("resolved");
      expect(updated?.resolvedAt).toBeDefined();
    });

    it("returns null when updating non-existent incident status", async () => {
      const updated = await service.updateIncidentStatus("missing", "resolved");
      expect(updated).toBeNull();
    });

    it("escalates or modifies incident severity", async () => {
      const updated = await service.updateIncidentSeverity("inc-1", "critical");
      expect(updated?.severity).toBe("critical");
    });

    it("returns null when updating non-existent incident severity", async () => {
      const updated = await service.updateIncidentSeverity("missing", "critical");
      expect(updated).toBeNull();
    });
  });

  describe("markRead and getUnreadCount", () => {
    it("records user session read", async () => {
      await expect(service.markRead("inc-1", "session-user-123")).resolves.not.toThrow();
    });

    it("queries unread count for user session", async () => {
      const count = await service.getUnreadCount("session-user-123");
      expect(typeof count).toBe("number");
    });
  });

  describe("getHeatmapData", () => {
    beforeEach(() => {
      mockDb.setTableData("bridge_incidents", [
        {
          id: "inc-1",
          bridge_id: "b1",
          asset_code: "XLM",
          severity: "critical",
          status: "open",
          title: "T1",
          description: "D1",
          source_attribution: "{}",
          enrichment_metadata: "{}",
          enrichment_tags: [],
          derived_fields: "{}",
          enrichment_validation: "{}",
          follow_up_actions: "[]",
          occurred_at: new Date("2026-09-27T14:30:00Z"),
          created_at: new Date("2026-09-27T14:30:00Z"),
          updated_at: new Date("2026-09-27T14:30:00Z"),
        },
        {
          id: "inc-2",
          bridge_id: "b1",
          asset_code: "XLM",
          severity: "high",
          status: "open",
          title: "T2",
          description: "D2",
          source_attribution: "{}",
          enrichment_metadata: "{}",
          enrichment_tags: [],
          derived_fields: "{}",
          enrichment_validation: "{}",
          follow_up_actions: "[]",
          occurred_at: new Date("2026-09-27T14:45:00Z"),
          created_at: new Date("2026-09-27T14:45:00Z"),
          updated_at: new Date("2026-09-27T14:45:00Z"),
        },
      ]);
    });

    it("aggregates incidents into date/hour buckets with severity counts", async () => {
      const heatmap = await service.getHeatmapData({
        startDate: "2026-09-27T00:00:00Z",
        endDate: "2026-09-27T23:59:59Z",
        assetSymbol: "XLM",
      });

      expect(heatmap.totalIncidents).toBe(2);
      expect(heatmap.assets).toEqual(["XLM"]);
      expect(heatmap.buckets.length).toBe(1);
      expect(heatmap.buckets[0].count).toBe(2);
      expect(heatmap.buckets[0].bySeverity.critical).toBe(1);
      expect(heatmap.buckets[0].bySeverity.high).toBe(1);
    });
  });

  describe("getIncidentReplayTimeline", () => {
    it("returns null if incident does not exist", async () => {
      const timeline = await service.getIncidentReplayTimeline("missing");
      expect(timeline).toBeNull();
    });

    it("assembles complete chronological timeline across creation, ingestion, enrichment, and resolution", async () => {
      mockDb.setTableData("bridge_incidents", [
        {
          id: "inc-100",
          bridge_id: "bridge-stellar",
          asset_code: "USDC",
          severity: "critical",
          status: "resolved",
          title: "Liquidity drain",
          description: "Drained pool reserves",
          source_attribution: JSON.stringify({ detectedBy: "AuditWatcher" }),
          enrichment_metadata: JSON.stringify({ enriched: true }),
          enrichment_tags: ["security", "drain"],
          derived_fields: JSON.stringify({ lossUsd: 1000000 }),
          enrichment_validation: JSON.stringify({ valid: true }),
          follow_up_actions: JSON.stringify(["Halt Bridge"]),
          occurred_at: new Date("2026-09-27T10:00:00Z"),
          created_at: new Date("2026-09-27T10:00:00Z"),
          updated_at: new Date("2026-09-27T10:30:00Z"),
          resolved_at: new Date("2026-09-27T11:00:00Z"),
        },
      ]);

      mockDb.setTableData("bridge_incident_ingestion_history", [
        {
          id: "ing-1",
          incident_id: "inc-100",
          event_type: "webhook_received",
          source_type: "guard_node",
          source_external_id: "ext-999",
          status: "success",
          attempt_number: 1,
          payload: JSON.stringify({ raw: "event" }),
          error_message: null,
          created_at: new Date("2026-09-27T10:05:00Z"),
        },
      ]);

      const timeline = await service.getIncidentReplayTimeline("inc-100");

      expect(timeline).not.toBeNull();
      expect(timeline?.incidentId).toBe("inc-100");
      expect(timeline?.events.length).toBeGreaterThanOrEqual(4);

      const eventTypes = timeline?.events.map((e) => e.eventType);
      expect(eventTypes).toContain("incident_created");
      expect(eventTypes).toContain("ingestion");
      expect(eventTypes).toContain("enrichment");
      expect(eventTypes).toContain("status_change");
      expect(eventTypes).toContain("resolution");
      expect(timeline?.durationMs).toBeGreaterThan(0);
    });
  });

  describe("mapDatabaseRow edge cases", () => {
    it("handles already parsed objects or null/undefined fields safely", () => {
      const rawRow = {
        id: "inc-raw",
        bridge_id: "b-raw",
        asset_code: null,
        severity: "low",
        status: "open",
        title: "Raw Row",
        description: "Testing row mapping",
        source_url: null,
        source_type: null,
        source_external_id: null,
        source_repository: null,
        source_repo_avatar_url: null,
        source_actor: null,
        source_attribution: { custom: "obj" },
        enrichment_metadata: { customMeta: true },
        enrichment_tags: ["t1", "t2"],
        derived_fields: { calc: 123 },
        enrichment_validation: { pass: true },
        requires_manual_review: 1,
        ingestion_attempt_count: "2",
        last_ingestion_error: "Some error",
        normalized_fingerprint: "fp-abc",
        follow_up_actions: ["action1"],
        occurred_at: "2026-09-27T10:00:00Z",
        resolved_at: null,
        created_at: "2026-09-27T10:00:00Z",
        updated_at: "2026-09-27T10:00:00Z",
      };

      const mapped = service.mapDatabaseRow(rawRow);
      expect(mapped.id).toBe("inc-raw");
      expect(mapped.requiresManualReview).toBe(true);
      expect(mapped.ingestionAttemptCount).toBe(2);
      expect(mapped.enrichmentTags).toEqual(["t1", "t2"]);
      expect(mapped.followUpActions).toEqual(["action1"]);
    });
  });
});
