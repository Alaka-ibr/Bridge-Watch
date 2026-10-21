import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * In-memory query-builder mock for `getDatabase()`, covering the specific
 * chains `reconciliation.service.ts` uses: `.insert().returning()`,
 * `.where().update().returning()`, `.orderBy().limit().timeout()`,
 * `.where().first()` (with or without a trailing `.timeout()`), and
 * `.select().catch()`. Date-range filtering (`.andWhere(col, op, value)`)
 * is intentionally a no-op — tests that exercise date-windowed methods
 * avoid relying on rows being excluded by range, focusing instead on the
 * grouping/severity/serialization logic those methods build on top of.
 */
function createMockDb() {
  const tables: Record<string, any[]> = {
    reconciliation_runs: [],
    assets: [],
    bridges: [],
    bridge_operators: [],
    reserve_commitments: [],
  };
  let idCounter = 0;

  function makeBuilder(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    let filtered = [...rows];
    let sortState: { col: string; dir: string } | null = null;
    let limitState: number | null = null;

    const applyOrderAndLimit = () => {
      let result = filtered;
      if (sortState) {
        const { col, dir } = sortState;
        result = [...result].sort((a, b) => {
          const an = Number(a[col]);
          const bn = Number(b[col]);
          return dir === "asc" ? an - bn : bn - an;
        });
      }
      if (limitState !== null) result = result.slice(0, limitState);
      return result;
    };

    const builder: any = {
      where: vi.fn((cond: any) => {
        if (typeof cond === "function") return builder;
        filtered = filtered.filter((row) =>
          Object.entries(cond).every(([k, v]) => row[k] === v)
        );
        return builder;
      }),
      andWhere: vi.fn(() => builder),
      orderBy: vi.fn((col: string, dir = "asc") => {
        sortState = { col, dir };
        return builder;
      }),
      limit: vi.fn((n: number) => {
        limitState = n;
        return builder;
      }),
      select: vi.fn(() => builder),
      timeout: vi.fn(() => builder),
      catch: vi.fn(() => Promise.resolve(applyOrderAndLimit())),
      first: vi.fn(() => {
        const result = applyOrderAndLimit()[0] ?? null;
        return {
          timeout: () => Promise.resolve(result),
          then: (resolve: any) => resolve(result),
        };
      }),
      insert: vi.fn((data: any) => {
        const record = { id: data.id ?? `run-${++idCounter}`, ...data };
        rows.push(record);
        return { returning: vi.fn(() => Promise.resolve([record])) };
      }),
      update: vi.fn((data: any) => {
        filtered.forEach((row) => Object.assign(row, data));
        const snapshot = [...filtered];
        return {
          returning: vi.fn(() => Promise.resolve(snapshot)),
          then: (resolve: any) => resolve(snapshot.length),
        };
      }),
      then: (resolve: any) => resolve(applyOrderAndLimit()),
    };
    return builder;
  }

  const db: any = vi.fn((table: string) => makeBuilder(table));
  return { db, tables };
}

let mockDbState: ReturnType<typeof createMockDb>;

vi.mock("../../database/connection.js", () => ({
  getDatabase: () => mockDbState.db,
}));

import { ReconciliationService, type ReconciliationRunDto } from "../reconciliation.service.js";

function makeRunRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-seed",
    asset_code: "USDC",
    job_id: null,
    bridge_name: "Allbridge",
    source_chain: "ethereum",
    status: "success",
    stellar_supply: 1000,
    reported_supply: 1000,
    mismatch_percentage: 0,
    attempt: 1,
    error: null,
    finished_at: new Date("2026-01-02T00:00:00Z"),
    started_at: new Date("2026-01-01T00:00:00Z"),
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-02T00:00:00Z"),
    on_chain_source: null,
    reserve_attestation: null,
    reported_backing: null,
    triage_status: null,
    triage_owner: null,
    triage_note: null,
    triaged_at: null,
    ...overrides,
  };
}

function makeRunDto(overrides: Partial<ReconciliationRunDto> = {}): ReconciliationRunDto {
  return {
    id: "run-1",
    assetCode: "USDC",
    bridgeName: "Allbridge",
    sourceChain: "ethereum",
    status: "success",
    triageStatus: "open",
    triageOwner: null,
    triageNote: null,
    triagedAt: null,
    stellarSupply: 1000,
    reportedSupply: 1000,
    mismatchPercentage: 0,
    discrepancy: 0,
    discrepancyAbs: 0,
    severity: "aligned",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:05:00.000Z",
    attempt: 1,
    jobId: null,
    error: null,
    sourceData: [],
    ...overrides,
  };
}

describe("ReconciliationService", () => {
  let service: ReconciliationService;

  beforeEach(() => {
    mockDbState = createMockDb();
    service = new ReconciliationService();
  });

  // ── Balance matching / discrepancy (serializeRun) ──────────────────────

  describe("serializeRun — balance matching across chains", () => {
    it("computes a positive discrepancy when on-chain supply exceeds reported supply", () => {
      const row = makeRunRow({ stellar_supply: 1050, reported_supply: 1000 });
      const context = { assets: new Map(), bridges: [] };

      const dto = (service as any).serializeRun(row, context);

      expect(dto.discrepancy).toBe(50);
      expect(dto.discrepancyAbs).toBe(50);
    });

    it("computes negative drift when reported supply exceeds on-chain supply", () => {
      const row = makeRunRow({ stellar_supply: 900, reported_supply: 1000 });
      const context = { assets: new Map(), bridges: [] };

      const dto = (service as any).serializeRun(row, context);

      expect(dto.discrepancy).toBe(-100);
      expect(dto.discrepancyAbs).toBe(100);
    });

    it("treats zero balances on both sides as zero discrepancy, not null", () => {
      const row = makeRunRow({ stellar_supply: 0, reported_supply: 0 });
      const context = { assets: new Map(), bridges: [] };

      const dto = (service as any).serializeRun(row, context);

      expect(dto.discrepancy).toBe(0);
      expect(dto.discrepancyAbs).toBe(0);
      expect(dto.stellarSupply).toBe(0);
      expect(dto.reportedSupply).toBe(0);
    });

    it("leaves discrepancy null when either supply is missing", () => {
      const row = makeRunRow({ stellar_supply: null, reported_supply: 1000 });
      const context = { assets: new Map(), bridges: [] };

      const dto = (service as any).serializeRun(row, context);

      expect(dto.discrepancy).toBeNull();
      expect(dto.discrepancyAbs).toBeNull();
    });
  });

  // ── Mismatch detection / threshold alerting (getSeverity) ──────────────

  describe("getSeverity — mismatch threshold alerting", () => {
    it.each([
      [0, "aligned"],
      [0.1, "aligned"],
      [0.5, "low"],
      [1, "medium"],
      [5, "high"],
      [5.01, "critical"],
      [50, "critical"],
    ])("classifies %s%% mismatch as %s", (pct, expected) => {
      expect((service as any).getSeverity("mismatch", pct)).toBe(expected);
    });

    it("classifies a failed run as high severity regardless of mismatch percentage", () => {
      expect((service as any).getSeverity("failed", null)).toBe("high");
      expect((service as any).getSeverity("failed", 0)).toBe("high");
    });

    it("classifies a running run with no mismatch data yet as low", () => {
      expect((service as any).getSeverity("running", null)).toBe("low");
    });

    it("classifies a completed run with no mismatch data as aligned", () => {
      expect((service as any).getSeverity("success", null)).toBe("aligned");
    });
  });

  // ── Trend direction ─────────────────────────────────────────────────────

  describe("getTrendDirection", () => {
    it("reports 'new' when there is no previous run", () => {
      const latest = makeRunDto({ mismatchPercentage: 2 });
      expect((service as any).getTrendDirection(latest, null)).toBe("new");
    });

    it("reports 'flat' when either run lacks mismatch data", () => {
      const latest = makeRunDto({ mismatchPercentage: null });
      const previous = makeRunDto({ mismatchPercentage: 2 });
      expect((service as any).getTrendDirection(latest, previous)).toBe("flat");
    });

    it("reports 'flat' for a sub-threshold delta", () => {
      const latest = makeRunDto({ mismatchPercentage: 1.001 });
      const previous = makeRunDto({ mismatchPercentage: 1.0 });
      expect((service as any).getTrendDirection(latest, previous)).toBe("flat");
    });

    it("reports 'worsening' when mismatch increases", () => {
      const latest = makeRunDto({ mismatchPercentage: 3 });
      const previous = makeRunDto({ mismatchPercentage: 1 });
      expect((service as any).getTrendDirection(latest, previous)).toBe("worsening");
    });

    it("reports 'improving' when mismatch decreases", () => {
      const latest = makeRunDto({ mismatchPercentage: 1 });
      const previous = makeRunDto({ mismatchPercentage: 3 });
      expect((service as any).getTrendDirection(latest, previous)).toBe("improving");
    });
  });

  // ── Summary building (unresolved / delta / history) ─────────────────────

  describe("buildSummary", () => {
    it("flags a summary unresolved when the latest run is not a success and not closed out by triage", () => {
      const latest = makeRunDto({ id: "r2", status: "mismatch", triageStatus: "open" });
      const previous = makeRunDto({ id: "r1", status: "mismatch", triageStatus: "open" });
      const summary = (service as any).buildSummary([latest, previous]);
      expect(summary.unresolved).toBe(true);
    });

    it("does not flag a summary unresolved once triage marks it resolved", () => {
      const latest = makeRunDto({ id: "r2", status: "mismatch", triageStatus: "resolved" });
      const summary = (service as any).buildSummary([latest]);
      expect(summary.unresolved).toBe(false);
    });

    it("computes mismatchDelta between the latest and previous run", () => {
      const latest = makeRunDto({ id: "r2", mismatchPercentage: 3, startedAt: "2026-01-02T00:00:00.000Z" });
      const previous = makeRunDto({ id: "r1", mismatchPercentage: 1, startedAt: "2026-01-01T00:00:00.000Z" });
      const summary = (service as any).buildSummary([latest, previous]);
      expect(summary.mismatchDelta).toBe(2);
      expect(summary.previousRunId).toBe("r1");
    });

    it("caps history at the most recent 30 runs, oldest first", () => {
      const runs = Array.from({ length: 35 }, (_, i) =>
        makeRunDto({
          id: `r${i}`,
          startedAt: new Date(2026, 0, i + 1).toISOString(),
        })
      );
      const summary = (service as any).buildSummary(runs);
      expect(summary.history).toHaveLength(30);
      // Oldest-first within the retained window.
      expect(new Date(summary.history[0].startedAt).getTime()).toBeLessThan(
        new Date(summary.history[29].startedAt).getTime()
      );
    });
  });

  // ── Bridge name inference ────────────────────────────────────────────────

  describe("inferBridgeName", () => {
    it("prefers the run's own stored bridge_name", () => {
      const name = (service as any).inferBridgeName("USDC", { bridge_name: "Custom Bridge" }, {
        assets: new Map(),
        bridges: [],
      });
      expect(name).toBe("Custom Bridge");
    });

    it("falls back to a matching bridge from metadata", () => {
      const name = (service as any).inferBridgeName("USDC", { bridge_name: null }, {
        assets: new Map(),
        bridges: [{ name: "USDC Allbridge", source_chain: "ethereum" }],
      });
      expect(name).toBe("USDC Allbridge");
    });

    it("falls back to the asset's bridge_provider when no bridge matches", () => {
      const name = (service as any).inferBridgeName(
        "USDC",
        { bridge_name: null },
        {
          assets: new Map([["USDC", { symbol: "USDC", issuer: null, bridge_provider: "Allbridge", source_chain: null }]]),
          bridges: [],
        }
      );
      expect(name).toBe("Allbridge USDC Bridge");
    });

    it("falls back to 'Unassigned bridge' when nothing matches", () => {
      const name = (service as any).inferBridgeName("USDC", { bridge_name: null }, {
        assets: new Map(),
        bridges: [],
      });
      expect(name).toBe("Unassigned bridge");
    });
  });

  // ── Triage status resolution ─────────────────────────────────────────────

  describe("resolveTriageStatus", () => {
    it("uses the stored triage_status when present", () => {
      const status = (service as any).resolveTriageStatus({ triage_status: "acknowledged", status: "mismatch" });
      expect(status).toBe("acknowledged");
    });

    it("defaults a successful run to resolved", () => {
      const status = (service as any).resolveTriageStatus({ triage_status: null, status: "success" });
      expect(status).toBe("resolved");
    });

    it("defaults a non-successful run to open", () => {
      const status = (service as any).resolveTriageStatus({ triage_status: null, status: "mismatch" });
      expect(status).toBe("open");
    });
  });

  // ── DB-backed: run lifecycle ─────────────────────────────────────────────

  describe("startRun", () => {
    it("creates a running row and returns its id", async () => {
      const { id } = await service.startRun({ assetCode: "USDC" });
      expect(id).toBeTruthy();
      expect(mockDbState.tables.reconciliation_runs).toHaveLength(1);
      expect(mockDbState.tables.reconciliation_runs[0]).toMatchObject({
        asset_code: "USDC",
        status: "running",
        attempt: 1,
      });
    });

    it("respects an explicit attempt number", async () => {
      await service.startRun({ assetCode: "USDC", attempt: 3 });
      expect(mockDbState.tables.reconciliation_runs[0].attempt).toBe(3);
    });
  });

  describe("finishRun", () => {
    it("marks a run finished with the final status and supply figures", async () => {
      const row = makeRunRow({ id: "run-x", status: "running" });
      mockDbState.tables.reconciliation_runs.push(row);

      await service.finishRun({
        id: "run-x",
        status: "mismatch",
        stellarSupply: 900,
        reportedSupply: 1000,
        mismatchPercentage: 10,
      });

      expect(row.status).toBe("mismatch");
      expect(row.stellar_supply).toBe(900);
      expect(row.reported_supply).toBe(1000);
      expect(row.mismatch_percentage).toBe(10);
      expect(row.finished_at).toBeInstanceOf(Date);
    });
  });

  describe("updateTriageStatus", () => {
    it("returns null when the run does not exist", async () => {
      const result = await service.updateTriageStatus("missing", { status: "acknowledged" });
      expect(result).toBeNull();
    });

    it("updates and returns the triaged run", async () => {
      const row = makeRunRow({ id: "run-y" });
      mockDbState.tables.reconciliation_runs.push(row);

      const result = await service.updateTriageStatus("run-y", {
        status: "acknowledged",
        owner: "ops-team",
        note: "Investigating",
      });

      expect(result?.triageStatus).toBe("acknowledged");
      expect(result?.triageOwner).toBe("ops-team");
      expect(result?.triageNote).toBe("Investigating");
    });
  });

  describe("listRuns / getLatestRun", () => {
    it("filters listRuns by assetCode", async () => {
      mockDbState.tables.reconciliation_runs.push(
        makeRunRow({ id: "a", asset_code: "USDC" }),
        makeRunRow({ id: "b", asset_code: "EURC" })
      );

      const runs = await service.listRuns({ assetCode: "USDC" });
      expect(runs).toHaveLength(1);
      expect(runs[0].asset_code).toBe("USDC");
    });

    it("returns the most recently started run for an asset", async () => {
      mockDbState.tables.reconciliation_runs.push(
        makeRunRow({ id: "old", asset_code: "USDC", started_at: new Date("2026-01-01T00:00:00Z") }),
        makeRunRow({ id: "new", asset_code: "USDC", started_at: new Date("2026-01-03T00:00:00Z") })
      );

      const latest = await service.getLatestRun("USDC");
      expect(latest?.id).toBe("new");
    });

    it("returns undefined-ish/null when no runs exist for the asset", async () => {
      const latest = await service.getLatestRun("GHOST");
      expect(latest ?? null).toBeNull();
    });
  });
});
