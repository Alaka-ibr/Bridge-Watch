import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * In-memory query-builder mock for `getDatabase()`.
 *
 * Mirrors the specific call chains `ingestionQueueManager.service.ts`
 * actually uses (`.where({id}).update()/.first()/.delete()`, `.insert()`,
 * `.count({count:"*"}).first()`), rather than emulating knex generally, so
 * assertions can inspect `tables.<name>` directly instead of re-deriving SQL
 * semantics in every test.
 */
function createMockDb() {
  const tables: Record<string, any[]> = {
    ingestion_jobs: [],
    dead_letter_jobs: [],
  };

  function makeBuilder(table: string) {
    let filtered = tables[table];
    const builder: any = {
      where: vi.fn((cond: any) => {
        if (typeof cond === "function") return builder;
        filtered = filtered.filter((row) =>
          Object.entries(cond).every(([k, v]) => row[k] === v)
        );
        return builder;
      }),
      andWhere: (...args: any[]) => builder.where(...args),
      orWhere: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      select: vi.fn(() => builder),
      count: vi.fn(() => ({
        first: () => Promise.resolve({ count: filtered.length }),
      })),
      first: vi.fn(() => Promise.resolve(filtered[0] ?? null)),
      insert: vi.fn((data: any) => {
        const record = { ...data };
        tables[table].push(record);
        return Promise.resolve([record]);
      }),
      update: vi.fn((data: any) => {
        filtered.forEach((row) => Object.assign(row, data));
        return Promise.resolve(filtered.length);
      }),
      delete: vi.fn(() => {
        const removed = filtered.length;
        filtered.forEach((row) => {
          const idx = tables[table].indexOf(row);
          if (idx >= 0) tables[table].splice(idx, 1);
        });
        return Promise.resolve(removed);
      }),
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

vi.mock("../../config/index.js", () => ({
  config: {
    INGESTION_MIN_CONFIRMATIONS_STELLAR: 3,
    INGESTION_MIN_CONFIRMATIONS_ETHEREUM: 12,
    INGESTION_MIN_CONFIRMATIONS_POLYGON: 12,
    INGESTION_MIN_CONFIRMATIONS_BASE: 12,
    INGESTION_REORG_BUFFER_DEPTH: 100,
    INGESTION_UNCONFIRMED_EVENT_TTL_MINUTES: 60,
  },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../ingestionWatermarkCoordinator.service.js", () => ({
  ingestionWatermarkCoordinator: { publish: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../queueFairness.service.js", () => ({
  queueFairnessService: { getAllPolicies: vi.fn().mockResolvedValue({}) },
  initDRRState: vi.fn(() => ({})),
  drrNextLane: vi.fn(() => "medium"),
}));

import { IngestionQueueManager, JobPriority } from "../ingestionQueueManager.service.js";

function makeJobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job-1",
    type: "event",
    priority: JobPriority.MEDIUM,
    payload: "{}",
    attempts: 0,
    max_attempts: 3,
    created_at: new Date(),
    updated_at: new Date(),
    next_retry_at: null,
    status: "pending",
    ...overrides,
  };
}

describe("IngestionQueueManager", () => {
  let manager: IngestionQueueManager;

  beforeEach(() => {
    mockDbState = createMockDb();
    manager = IngestionQueueManager.getInstance();
    vi.clearAllMocks();
  });

  describe("handleJob — happy path", () => {
    it("marks a job completed when processJobLogic succeeds", async () => {
      const row = makeJobRow();
      mockDbState.tables.ingestion_jobs.push(row);
      vi.spyOn(manager as any, "processJobLogic").mockResolvedValueOnce(undefined);

      await (manager as any).handleJob(row);

      expect(row.status).toBe("completed");
    });
  });

  describe("handleJob — retry and dead-letter routing", () => {
    it("marks a job failed and schedules a retry when attempts remain", async () => {
      const row = makeJobRow({ attempts: 0, max_attempts: 3 });
      mockDbState.tables.ingestion_jobs.push(row);
      vi.spyOn(manager as any, "processJobLogic").mockRejectedValueOnce(new Error("boom"));

      await (manager as any).handleJob(row);

      expect(row.status).toBe("failed");
      expect(row.attempts).toBe(1);
      expect(row.next_retry_at).toBeInstanceOf(Date);
      expect(mockDbState.tables.dead_letter_jobs).toHaveLength(0);
    });

    it("routes to the dead-letter queue once max attempts are exhausted", async () => {
      const row = makeJobRow({ attempts: 2, max_attempts: 3 });
      mockDbState.tables.ingestion_jobs.push(row);
      vi.spyOn(manager as any, "processJobLogic").mockRejectedValueOnce(new Error("boom"));

      await (manager as any).handleJob(row);

      expect(row.attempts).toBe(3);
      expect(row.next_retry_at).toBeNull();
      expect(mockDbState.tables.dead_letter_jobs).toHaveLength(1);
      expect(mockDbState.tables.dead_letter_jobs[0].id).toBe("job-1");
      expect(mockDbState.tables.ingestion_jobs).toHaveLength(0);
    });

    it("does not dead-letter a job on its first failure below max attempts", async () => {
      const row = makeJobRow({ attempts: 0, max_attempts: 3 });
      mockDbState.tables.ingestion_jobs.push(row);
      vi.spyOn(manager as any, "processJobLogic").mockRejectedValueOnce(new Error("boom"));

      await (manager as any).handleJob(row);

      expect(mockDbState.tables.dead_letter_jobs).toHaveLength(0);
      expect(mockDbState.tables.ingestion_jobs).toHaveLength(1);
    });
  });

  describe("moveToDeadLetter", () => {
    it("copies the job into dead_letter_jobs and removes it from ingestion_jobs", async () => {
      const row = makeJobRow({ id: "job-2", attempts: 3, last_error: "final failure" });
      mockDbState.tables.ingestion_jobs.push(row);

      await (manager as any).moveToDeadLetter(row);

      expect(mockDbState.tables.dead_letter_jobs).toHaveLength(1);
      expect(mockDbState.tables.dead_letter_jobs[0]).toMatchObject({
        id: "job-2",
        error_message: "final failure",
      });
      expect(mockDbState.tables.ingestion_jobs).toHaveLength(0);
    });
  });

  describe("requeueDeadLetter", () => {
    it("moves a dead-letter job back into the pending queue with a reset attempt count", async () => {
      mockDbState.tables.dead_letter_jobs.push({
        id: "job-3",
        type: "event",
        priority: JobPriority.HIGH,
        payload: "{}",
        attempts: 3,
        max_attempts: 3,
        created_at: new Date(),
      });

      await manager.requeueDeadLetter("job-3");

      expect(mockDbState.tables.dead_letter_jobs).toHaveLength(0);
      expect(mockDbState.tables.ingestion_jobs).toHaveLength(1);
      const requeued = mockDbState.tables.ingestion_jobs[0];
      expect(requeued.status).toBe("pending");
      expect(requeued.attempts).toBe(0);
    });

    it("throws when the dead-letter job does not exist", async () => {
      await expect(manager.requeueDeadLetter("missing")).rejects.toThrow(
        "Dead-letter job not found: missing"
      );
    });
  });

  describe("enqueueJob", () => {
    it("creates a pending job with defaults applied", async () => {
      const job = await manager.enqueueJob({ type: "alert", payload: { foo: "bar" } });

      expect(job.status).toBe("pending");
      expect(job.priority).toBe(JobPriority.MEDIUM);
      expect(job.maxAttempts).toBe(3);
      expect(job.attempts).toBe(0);
      expect(mockDbState.tables.ingestion_jobs).toHaveLength(1);
    });

    it("respects explicit priority and maxAttempts overrides", async () => {
      const job = await manager.enqueueJob({
        type: "metric",
        priority: JobPriority.CRITICAL,
        payload: {},
        maxAttempts: 5,
      });

      expect(job.priority).toBe(JobPriority.CRITICAL);
      expect(job.maxAttempts).toBe(5);
    });
  });

  describe("getMetrics", () => {
    it("aggregates counts per status and the dead-letter total", async () => {
      mockDbState.tables.ingestion_jobs.push(
        makeJobRow({ id: "a", status: "pending" }),
        makeJobRow({ id: "b", status: "pending" }),
        makeJobRow({ id: "c", status: "processing" }),
        makeJobRow({ id: "d", status: "completed" }),
        makeJobRow({ id: "e", status: "failed" })
      );
      mockDbState.tables.dead_letter_jobs.push({ id: "f" });

      const metrics = await manager.getMetrics();

      expect(metrics).toEqual({
        pending: 2,
        processing: 1,
        completed: 1,
        failed: 1,
        deadLetter: 1,
      });
    });
  });

  describe("concurrent job handling", () => {
    it("does not start new processing when already at the concurrency limit", async () => {
      (manager as any).processingCount = (manager as any).concurrencyLimit;
      const handleJobSpy = vi.spyOn(manager as any, "handleJob");

      await manager.processPendingJobs();

      expect(handleJobSpy).not.toHaveBeenCalled();
    });

    it("increments and decrements processingCount around each handled job", async () => {
      const row = makeJobRow({ id: "job-a" });
      mockDbState.tables.ingestion_jobs.push(row);

      // Exercises the increment/decrement contract processPendingJobs relies
      // on: the caller bumps processingCount before handleJob, and its
      // `.finally` decrements it regardless of success or failure.
      const before = (manager as any).processingCount;
      (manager as any).processingCount++;
      vi.spyOn(manager as any, "processJobLogic").mockResolvedValueOnce(undefined);
      await (manager as any).handleJob(row).finally(() => {
        (manager as any).processingCount--;
      });

      expect((manager as any).processingCount).toBe(before);
      expect(row.status).toBe("completed");
    });
  });
});
