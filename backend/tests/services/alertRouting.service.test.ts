import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AlertRoutingService,
  type CreateAlertRoutingRuleInput,
  type RouteableAlert,
} from "../../src/services/alertRouting.service.js";

// Mock external notification services
vi.mock("../../src/services/webhook.service.js", () => ({
  webhookService: {
    listEndpoints: vi.fn().mockResolvedValue([
      {
        id: "ep-1",
        ownerAddress: "GOWNER123",
        isActive: true,
        filterEventTypes: ["alert.triggered"],
      },
    ]),
    queueDelivery: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("../../src/services/email.service.js", () => ({
  emailNotificationService: {
    sendAlertEmail: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("../../src/services/slack.notification.service.js", () => ({
  slackNotificationService: {
    isConfigured: vi.fn().mockReturnValue(true),
    sendAlert: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("../../src/services/preferences.service.js", () => ({
  PreferencesService: vi.fn().mockImplementation(() => ({
    getPreferences: vi.fn().mockResolvedValue({
      categories: {
        alerts: {
          channels: ["in_app", "webhook", "email", "slack"],
          defaultSeverity: "low",
          mutedAssets: [],
        },
      },
    }),
  })),
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

// Mock redis
const mockRedisCache = new Map<string, string>();
vi.mock("../../src/utils/redis.js", () => ({
  redis: {
    get: vi.fn(async (key: string) => mockRedisCache.get(key) ?? null),
    set: vi.fn(async (key: string, val: string, _mode?: string, _ttl?: number) => {
      mockRedisCache.set(key, val);
      return "OK";
    }),
    publish: vi.fn().mockResolvedValue(1),
  },
}));

type MockRow = Record<string, unknown>;

function createMockKnex() {
  let tableData: Record<string, MockRow[]> = {
    alert_routing_rules: [],
    alert_routing_audit: [],
  };

  const knex = vi.fn((tableName: string) => {
    let whereFilters: Array<(row: MockRow) => boolean> = [];
    let limitVal: number | null = null;
    let offsetVal: number = 0;
    let orderByCol: string | null = null;
    let orderDir: string = "asc";

    const queryBuilder: any = {
      where: vi.fn((arg1: any, arg2?: any, arg3?: any) => {
        if (typeof arg1 === "function") {
          const subConditions: Array<(row: MockRow) => boolean> = [];
          const subQb = {
            where: (col: string, val: any) => {
              subConditions.push((row) => row[col] === val);
              return subQb;
            },
            orWhereNull: (col: string) => {
              subConditions.push((row) => row[col] === null || row[col] === undefined);
              return subQb;
            },
          };
          arg1(subQb);
          whereFilters.push((row) => subConditions.some((fn) => fn(row)));
        } else if (typeof arg1 === "string" && arg2 !== undefined && arg3 !== undefined) {
          // e.g. where("created_at", ">=", cutoff)
          whereFilters.push((row) => {
            const rowVal = row[arg1] instanceof Date ? (row[arg1] as Date).getTime() : new Date(String(row[arg1])).getTime();
            const targetVal = arg3 instanceof Date ? arg3.getTime() : new Date(String(arg3)).getTime();
            if (arg2 === ">=") return rowVal >= targetVal;
            if (arg2 === "<=") return rowVal <= targetVal;
            if (arg2 === ">") return rowVal > targetVal;
            if (arg2 === "<") return rowVal < targetVal;
            return row[arg1] === arg3;
          });
        } else if (typeof arg1 === "string" && arg2 !== undefined) {
          whereFilters.push((row) => row[arg1] === arg2);
        } else if (typeof arg1 === "object" && arg1 !== null) {
          whereFilters.push((row) => {
            for (const [k, v] of Object.entries(arg1)) {
              if (row[k] !== v) return false;
            }
            return true;
          });
        }
        return queryBuilder;
      }),
      whereIn: vi.fn((col: string, vals: any[]) => {
        whereFilters.push((row) => vals.includes(row[col]));
        return queryBuilder;
      }),
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
      then: (resolve: (v: any) => any, reject?: (e: any) => any) => {
        let rows = tableData[tableName] ?? [];
        for (const filterFn of whereFilters) {
          rows = rows.filter(filterFn);
        }
        if (orderByCol) {
          rows = [...rows].sort((a, b) => {
            const valA = a[orderByCol!] ?? "";
            const valB = b[orderByCol!] ?? "";
            return orderDir === "desc"
              ? String(valB).localeCompare(String(valA))
              : String(valA).localeCompare(String(valB));
          });
        }
        if (offsetVal) rows = rows.slice(offsetVal);
        if (limitVal !== null) rows = rows.slice(0, limitVal);
        return Promise.resolve(rows).then(resolve, reject);
      },
      first: vi.fn(async () => {
        let rows = tableData[tableName] ?? [];
        for (const filterFn of whereFilters) {
          rows = rows.filter(filterFn);
        }
        return rows[0] ?? null;
      }),
      insert: vi.fn((data: any) => {
        const inserted = {
          id: data.id || `rule-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          created_at: new Date(),
          updated_at: new Date(),
          ...data,
        };
        tableData[tableName] = [...(tableData[tableName] ?? []), inserted];

        const insertChain: any = {
          returning: vi.fn(async () => [inserted]),
        };
        return insertChain;
      }),
      update: vi.fn((updateData: any) => ({
        returning: vi.fn(async () => {
          let rows = tableData[tableName] ?? [];
          const matchingIndices: number[] = [];
          rows.forEach((row, idx) => {
            if (whereFilters.every((fn) => fn(row))) {
              matchingIndices.push(idx);
            }
          });

          const updatedRows: MockRow[] = [];
          for (const idx of matchingIndices) {
            const updated = { ...rows[idx], ...updateData, updated_at: new Date() };
            rows[idx] = updated;
            updatedRows.push(updated);
          }
          tableData[tableName] = rows;
          return updatedRows;
        }),
      })),
      delete: vi.fn(async () => {
        let rows = tableData[tableName] ?? [];
        const surviving = rows.filter((row) => !whereFilters.every((fn) => fn(row)));
        const deletedCount = rows.length - surviving.length;
        tableData[tableName] = surviving;
        return deletedCount;
      }),
    };

    return queryBuilder;
  });

  return {
    knex,
    setTableData: (table: string, data: MockRow[]) => {
      tableData[table] = data;
    },
    getTableData: (table: string) => tableData[table] ?? [],
    reset: () => {
      tableData = {
        alert_routing_rules: [],
        alert_routing_audit: [],
      };
    },
  };
}

const mockDb = createMockKnex();

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => mockDb.knex,
}));

describe("AlertRoutingService Unit Tests", () => {
  let service: AlertRoutingService;

  beforeEach(() => {
    mockDb.reset();
    mockRedisCache.clear();
    vi.clearAllMocks();
    service = new AlertRoutingService();
  });

  describe("Rule CRUD operations", () => {
    it("creates a new alert routing rule", async () => {
      const input: CreateAlertRoutingRuleInput = {
        name: "Critical Security Rule",
        ownerAddress: "GABC123",
        severityLevels: ["critical", "high"],
        assetCodes: ["USDC", "XLM"],
        sourceTypes: ["bridge", "oracle"],
        channels: ["in_app", "webhook"],
        fallbackChannels: ["email"],
        suppressionWindowSeconds: 300,
        priorityOrder: 1,
        isActive: true,
      };

      const rule = await service.createRule(input);
      expect(rule.id).toBeDefined();
      expect(rule.name).toBe("Critical Security Rule");
      expect(rule.severityLevels).toEqual(["critical", "high"]);
      expect(rule.channels).toEqual(["in_app", "webhook"]);
      expect(rule.fallbackChannels).toEqual(["email"]);
      expect(rule.suppressionWindowSeconds).toBe(300);
    });

    it("lists routing rules filtered by ownerAddress", async () => {
      await service.createRule({
        name: "User Rule",
        ownerAddress: "GUSER1",
        channels: ["in_app"],
        isActive: true,
      });

      const rules = await service.listRules("GUSER1");
      expect(rules.length).toBeGreaterThanOrEqual(1);
    });

    it("updates an existing routing rule", async () => {
      const rule = await service.createRule({
        name: "Original",
        channels: ["in_app"],
      });

      const updated = await service.updateRule(rule.id, {
        name: "Updated",
        channels: ["in_app", "slack"],
      });

      expect(updated?.name).toBe("Updated");
      expect(updated?.channels).toEqual(["in_app", "slack"]);
    });

    it("bulk updates rules active state", async () => {
      const r1 = await service.createRule({ name: "R1", channels: ["in_app"] });
      const r2 = await service.createRule({ name: "R2", channels: ["in_app"] });

      const updated = await service.bulkUpdateRules([r1.id, r2.id], false);
      expect(updated.length).toBe(2);
      expect(updated[0].isActive).toBe(false);
      expect(updated[1].isActive).toBe(false);
    });

    it("deletes a routing rule", async () => {
      const rule = await service.createRule({
        name: "To Delete",
        channels: ["in_app"],
      });

      const success = await service.deleteRule(rule.id);
      expect(success).toBe(true);
    });
  });

  describe("Alert Routing and Channel Selection", () => {
    const baseAlert: RouteableAlert = {
      eventTime: new Date(),
      alertRuleId: "alert-rule-1",
      ownerAddress: "GOWNER123",
      ruleName: "High Volume Drain",
      assetCode: "USDC",
      sourceType: "bridge",
      severity: "critical",
      triggeredValue: 500000,
      threshold: 100000,
      metric: "volume",
      webhookUrl: "https://webhook.example.com/alerts",
    };

    it("routes alert to matching rule channels and records audit", async () => {
      await service.createRule({
        name: "Critical USDC Bridge Rule",
        ownerAddress: "GOWNER123",
        severityLevels: ["critical"],
        assetCodes: ["USDC"],
        sourceTypes: ["bridge"],
        channels: ["in_app", "webhook"],
        fallbackChannels: ["slack"],
        suppressionWindowSeconds: 0,
        isActive: true,
      });

      await service.routeAlert(baseAlert);

      const audits = mockDb.getTableData("alert_routing_audit");
      expect(audits.length).toBeGreaterThanOrEqual(1);
    });

    it("suppresses alerts when duplicate arrives within suppression window", async () => {
      await service.createRule({
        name: "Suppression Rule",
        ownerAddress: "GOWNER123",
        channels: ["in_app"],
        suppressionWindowSeconds: 60,
        isActive: true,
      });

      await service.routeAlert(baseAlert);
      await service.routeAlert(baseAlert);

      const audits = mockDb.getTableData("alert_routing_audit");
      const suppressed = audits.find((e) => e.status === "suppressed");
      expect(suppressed).toBeDefined();
    });

    it("routes to fallback channel when primary channel dispatch fails", async () => {
      const { webhookService } = await import("../../src/services/webhook.service.js");
      (webhookService.listEndpoints as any).mockResolvedValueOnce([]);

      await service.createRule({
        name: "Webhook with Slack Fallback",
        ownerAddress: "GOWNER123",
        channels: ["webhook"],
        fallbackChannels: ["slack"],
        suppressionWindowSeconds: 0,
        isActive: true,
      });

      await service.routeAlert({
        ...baseAlert,
        webhookUrl: undefined,
      });

      const audits = mockDb.getTableData("alert_routing_audit");
      expect(audits.some((e) => e.channel === "slack" || e.status === "fallback")).toBe(true);
    });
  });

  describe("Audit History", () => {
    it("retrieves audit history with filters and limits", async () => {
      mockDb.setTableData("alert_routing_audit", [
        {
          id: "audit-1",
          event_time: new Date(),
          alert_rule_id: "rule-1",
          routing_rule_id: "rrule-1",
          owner_address: "GADDR1",
          asset_code: "USDC",
          source_type: "bridge",
          severity: "critical",
          channel: "in_app",
          status: "delivered",
          reason: null,
          attempt_count: 1,
          latency_ms: 12,
          created_at: new Date(),
        },
      ]);

      const history = await service.getAuditHistory({
        ownerAddress: "GADDR1",
        status: "delivered",
        limit: 10,
      });

      expect(history.length).toBe(1);
      expect(history[0].id).toBe("audit-1");
      expect(history[0].channel).toBe("in_app");
      expect(history[0].status).toBe("delivered");
    });
  });
});
