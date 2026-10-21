import crypto from "crypto";
import type { Knex } from "knex";
import { getDatabase } from "../database/connection.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { ingestionWatermarkCoordinator } from "./ingestionWatermarkCoordinator.service.js";
import type { IngestionJobRow, UnconfirmedEventRow } from "../types/ingestion.types.js";

export type IngestionJobType = "alert" | "event" | "metric";

export enum JobPriority {
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4,
}

export interface IngestionJobPayload {
  [key: string]: unknown;
}

export interface IngestionJob {
  id: string;
  type: IngestionJobType;
  priority: JobPriority;
  payload: IngestionJobPayload;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  nextRetryAt: Date | null;
  status: "pending" | "processing" | "failed" | "completed";
}

export interface IngestionMetrics {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  deadLetter: number;
}

export interface UnconfirmedEvent {
  id: string;
  sourceChain: string;
  eventType: string;
  payload: Record<string, unknown>;
  txHash: string;
  ledgerSequence: number;
  observedLedger: number;
  confirmations: number;
  requiredConfirmations: number;
  isConfirmed: boolean;
  isRolledBack: boolean;
}

const MIN_CONFIRMATIONS: Record<string, number> = {
  stellar: config.INGESTION_MIN_CONFIRMATIONS_STELLAR,
  ethereum: config.INGESTION_MIN_CONFIRMATIONS_ETHEREUM,
  polygon: config.INGESTION_MIN_CONFIRMATIONS_POLYGON,
  base: config.INGESTION_MIN_CONFIRMATIONS_BASE,
};

function getRequiredConfirmations(chain: string): number {
  return MIN_CONFIRMATIONS[chain] ?? 3;
}

/** How often the zombie-lease reaper runs (#1269). */
export const INGESTION_LEASE_REAPER_INTERVAL_MS = 10_000;
/** Leases/jobs with no heartbeat/progress beyond this are presumed dead (#1269). */
export const INGESTION_ZOMBIE_THRESHOLD_MS = 30_000;

export interface ReapedZombie {
  leaseKey: string;
  previousOwner: string | null;
  range: Record<string, unknown>;
  requeuedJobId: string | null;
}

export class IngestionQueueManager {
  private static instance: IngestionQueueManager;

  private readonly concurrencyLimit: number;
  private processingCount = 0;
  private leaseReaperTimer: NodeJS.Timeout | null = null;

  private constructor(concurrencyLimit: number = 5) {
    this.concurrencyLimit = concurrencyLimit;
  }

  public static getInstance(): IngestionQueueManager {
    if (!IngestionQueueManager.instance) {
      IngestionQueueManager.instance = new IngestionQueueManager();
    }
    return IngestionQueueManager.instance;
  }

  public async enqueueJob(params: {
    type: IngestionJobType;
    priority?: JobPriority;
    payload: IngestionJobPayload;
    maxAttempts?: number;
  }): Promise<IngestionJob> {
    const db = getDatabase();
    const now = new Date();
    const job: IngestionJob = {
      id: crypto.randomUUID(),
      type: params.type,
      priority: params.priority ?? JobPriority.MEDIUM,
      payload: params.payload,
      attempts: 0,
      maxAttempts: params.maxAttempts ?? 3,
      createdAt: now,
      updatedAt: now,
      nextRetryAt: null,
      status: "pending",
    };

    await db("ingestion_jobs").insert({
      id: job.id,
      type: job.type,
      priority: job.priority,
      payload: JSON.stringify(job.payload),
      attempts: job.attempts,
      max_attempts: job.maxAttempts,
      created_at: now,
      updated_at: now,
      next_retry_at: null,
      status: job.status,
    });
    logger.info({ jobId: job.id }, "Ingestion job enqueued");
    return job;
  }

  public async processPendingJobs(): Promise<void> {
    if (this.processingCount >= this.concurrencyLimit) {
      return;
    }

    const db = getDatabase();
    const pendingJobs = await db("ingestion_jobs")
      .where({ status: "pending" })
      .orWhere(function () {
        this.where({ status: "failed" })
          .where("attempts", "<", db.raw("max_attempts"))
          .where((qb: Knex.QueryBuilder) => {
            qb.where("next_retry_at", "<=", new Date()).orWhereNull("next_retry_at");
          });
      })
      .orderBy([{ column: "priority", order: "desc" }, { column: "created_at", order: "asc" }])
      .limit(this.concurrencyLimit - this.processingCount);

    for (const row of pendingJobs) {
      this.processingCount++;
      this.handleJob(row).finally(() => {
        this.processingCount--;
      });
    }
  }

  private async handleJob(row: IngestionJobRow): Promise<void> {
    const db = getDatabase();
    const jobId = row.id;
    try {
      await db("ingestion_jobs")
        .where({ id: jobId })
        .update({ status: "processing", updated_at: new Date() });

      await this.processJobLogic(row);

      await db("ingestion_jobs")
        .where({ id: jobId })
        .update({ status: "completed", updated_at: new Date() });
      logger.info({ jobId }, "Ingestion job completed");
    } catch (err) {
      const attempts = (row.attempts ?? 0) + 1;
      const maxAttempts = row.max_attempts ?? 3;
      const nextRetry = attempts < maxAttempts ? this.calculateBackoff(attempts) : null;

      await db("ingestion_jobs")
        .where({ id: jobId })
        .update({
          attempts,
          next_retry_at: nextRetry,
          status: "failed",
          updated_at: new Date(),
        });

      logger.error({ jobId, err }, "Ingestion job processing failed");

      if (attempts >= maxAttempts) {
        await this.moveToDeadLetter(row);
      }
    }
  }

  private async processJobLogic(jobRow: IngestionJobRow): Promise<void> {
    return;
  }

  public async bufferUnconfirmedEvent(params: {
    sourceChain: string;
    eventType: string;
    payload: Record<string, unknown>;
    txHash: string;
    ledgerSequence: number;
    currentLedger: number;
  }): Promise<UnconfirmedEvent> {
    const db = getDatabase();
    const required = getRequiredConfirmations(params.sourceChain);
    const confirmations = Math.max(0, params.currentLedger - params.ledgerSequence);

    const [row] = await db("unconfirmed_events")
      .insert({
        source_chain: params.sourceChain,
        event_type: params.eventType,
        payload: JSON.stringify(params.payload),
        tx_hash: params.txHash,
        ledger_sequence: params.ledgerSequence,
        observed_ledger: params.currentLedger,
        confirmations: confirmations,
        required_confirmations: required,
        is_confirmed: confirmations >= required,
        confirmed_at: confirmations >= required ? new Date() : null,
      })
      .onConflict(["tx_hash", "source_chain"])
      .merge({
        confirmations: confirmations,
        is_confirmed: confirmations >= required,
        confirmed_at: confirmations >= required ? new Date() : null,
        updated_at: new Date(),
      })
      .returning("*");

    // Publish durable source progress with finality separated from observation.
    // Downstream consumers can therefore wait for the confirmation boundary,
    // rather than treating a fast provider's wall-clock update as complete.
    await ingestionWatermarkCoordinator.publish({
      source: params.sourceChain,
      coveredThrough: params.currentLedger,
      finalizedThrough: Math.max(0, params.currentLedger - required),
      gaps: [],
    });

    if (confirmations >= required) {
      logger.info(
        { txHash: params.txHash, sourceChain: params.sourceChain, confirmations, required },
        "Event confirmed and ready for processing"
      );
    } else {
      logger.debug(
        { txHash: params.txHash, sourceChain: params.sourceChain, confirmations, required },
        "Event buffered awaiting confirmations"
      );
    }

    return this.mapUnconfirmedEvent(row);
  }

  public async checkConfirmationsAndProcess(): Promise<void> {
    const db = getDatabase();
    const now = new Date();
    const cutoff = new Date(now.getTime() - config.INGESTION_UNCONFIRMED_EVENT_TTL_MINUTES * 60 * 1000);

    const unconfirmed = await db("unconfirmed_events")
      .where({ is_confirmed: false, is_rolled_back: false })
      .where("observed_at", ">", cutoff);

    for (const event of unconfirmed) {
      const currentLedger = await this.getCurrentLedger(event.source_chain as string);
      if (currentLedger === null) continue;

      const eventLedger = Number(event.ledger_sequence);
      const confirmations = currentLedger - eventLedger;

      if (confirmations >= Number(event.required_confirmations)) {
        await db("unconfirmed_events")
          .where({ id: event.id })
          .update({
            confirmations,
            is_confirmed: true,
            confirmed_at: now,
            updated_at: now,
          });
        logger.info(
          { eventId: event.id, confirmations, required: event.required_confirmations },
          "Event reached required confirmations"
        );
      } else {
        await db("unconfirmed_events")
          .where({ id: event.id })
          .update({ confirmations: Math.max(0, confirmations), updated_at: now });
      }
    }
  }

  public async detectReorgAndRollback(): Promise<string[]> {
    const db = getDatabase();
    const now = new Date();
    const rollbackCutoff = new Date(now.getTime() - config.INGESTION_UNCONFIRMED_EVENT_TTL_MINUTES * 60 * 1000);
    const chainGroups = await db("unconfirmed_events")
      .where({ is_rolled_back: false })
      .where("observed_at", ">", rollbackCutoff)
      .select("source_chain")
      .distinct();

    const rolledBackEventIds: string[] = [];

    for (const group of chainGroups) {
      const chain = group.source_chain as string;
      const currentLedger = await this.getCurrentLedger(chain);
      if (currentLedger === null) continue;

      const confirmedEvents = await db("unconfirmed_events")
        .where({ source_chain: chain, is_confirmed: true, is_rolled_back: false })
        .where("ledger_sequence", ">", currentLedger - config.INGESTION_REORG_BUFFER_DEPTH)
        .select("ledger_sequence", "tx_hash", "id")
        .orderBy("ledger_sequence", "desc")
        .limit(50);

      for (const event of confirmedEvents) {
        const txStillValid = await this.checkTransactionOnChain(chain, event.tx_hash as string, Number(event.ledger_sequence));
        if (!txStillValid) {
          await db("unconfirmed_events")
            .where({ id: event.id })
            .update({
              is_rolled_back: true,
              is_confirmed: false,
              rolled_back_at: now,
              updated_at: now,
            });

          await db("ingestion_jobs")
            .where({ status: "pending" })
            .whereRaw("payload::jsonb @> ?", JSON.stringify({ txHash: event.tx_hash }))
            .delete();

          logger.warn(
            { eventId: event.id, txHash: event.tx_hash, chain },
            "Event rolled back due to re-org detection"
          );
          rolledBackEventIds.push(event.id as string);
        }
      }
    }

    if (rolledBackEventIds.length > 0) {
      logger.warn({ count: rolledBackEventIds.length }, "Re-org detected and rollback applied");
    }

    return rolledBackEventIds;
  }

  // ── Zombie lease reaper (#1269) ──────────────────────────────────────
  //
  // Workers heartbeat their ledger-range leases every 10s (see
  // WorkerLeaseService.startHeartbeat). When a pod dies abruptly the
  // heartbeat stops; this reaper evicts leases with no heartbeat for >30s
  // and re-queues their unfinished ranges so ingestion does not stall until
  // manual operator intervention.

  /** Start the periodic zombie-lease reaper. Safe to call multiple times. */
  public startLeaseReaper(intervalMs: number = INGESTION_LEASE_REAPER_INTERVAL_MS): void {
    if (this.leaseReaperTimer) return;
    const timer = setInterval(() => {
      this.reapZombieLeases().catch((err) => logger.error({ err }, "Lease reaper cycle failed"));
    }, intervalMs);
    if (typeof (timer as any)?.unref === "function") (timer as any).unref();
    this.leaseReaperTimer = timer;
  }

  /** Stop the periodic zombie-lease reaper. */
  public stopLeaseReaper(): void {
    if (this.leaseReaperTimer) {
      clearInterval(this.leaseReaperTimer);
      this.leaseReaperTimer = null;
    }
  }

  /**
   * One reaper cycle: evict zombie leases and re-queue unfinished ranges.
   *
   * 1. Evicts leases with no heartbeat for > threshold via
   *    WorkerLeaseService.evictZombieLeases (lazy import avoids a module cycle).
   * 2. For each evicted lease, re-queues its `metadata.range` as a pending
   *    ingestion job (or resets the referenced `metadata.jobId` to pending).
   * 3. Sweeps `ingestion_jobs` stuck in `processing` with no progress beyond
   *    the threshold back to `pending` as a second safety net.
   */
  public async reapZombieLeases(now: Date = new Date()): Promise<ReapedZombie[]> {
    const { workerLeaseService } = await import("./workerLease.service.js");
    const evicted = await workerLeaseService.evictZombieLeases(now, INGESTION_ZOMBIE_THRESHOLD_MS);
    const reaped: ReapedZombie[] = [];

    for (const lease of evicted) {
      const meta = (lease.metadata ?? {}) as Record<string, unknown>;
      const range =
        (meta.range as Record<string, unknown> | undefined) ??
        (meta as Record<string, unknown>);
      let requeuedJobId: string | null = null;
      try {
        if (typeof meta.jobId === "string") {
          const db = getDatabase();
          const updated = await db("ingestion_jobs")
            .where({ id: meta.jobId })
            .whereIn("status", ["processing", "failed"])
            .update({ status: "pending", next_retry_at: null, updated_at: now });
          if (updated > 0) requeuedJobId = meta.jobId as string;
        }
        if (!requeuedJobId && range && (range.fromLedger !== undefined || range.from !== undefined)) {
          const job = await this.enqueueJob({
            type: "event",
            priority: JobPriority.HIGH,
            payload: {
              requeuedFromZombieLease: lease.leaseKey,
              previousOwner: lease.ownerId,
              range,
            },
          });
          requeuedJobId = job.id;
        }
      } catch (err) {
        logger.error({ err, leaseKey: lease.leaseKey }, "Failed re-queueing zombie lease range");
      }
      logger.warn(
        { leaseKey: lease.leaseKey, previousOwner: lease.ownerId, requeuedJobId },
        "Zombie worker lease evicted and range re-queued"
      );
      reaped.push({
        leaseKey: lease.leaseKey,
        previousOwner: lease.ownerId,
        range: range ?? {},
        requeuedJobId,
      });
    }

    // Safety net: jobs stuck in `processing` with no update beyond threshold
    // (e.g. worker died before a lease row existed) go back to `pending`.
    try {
      const db = getDatabase();
      const stuckCutoff = new Date(now.getTime() - INGESTION_ZOMBIE_THRESHOLD_MS);
      await db("ingestion_jobs")
        .where({ status: "processing" })
        .andWhere("updated_at", "<=", stuckCutoff)
        .update({ status: "pending", updated_at: now });
    } catch (err) {
      logger.error({ err }, "Failed sweeping stuck processing jobs");
    }

    return reaped;
  }

  public async getMetrics(): Promise<IngestionMetrics> {
    const db = getDatabase();
    const [{ pending }, { processing }, { completed }, { failed }, { deadLetter }] = await Promise.all([
      db("ingestion_jobs").where({ status: "pending" }).count({ count: "*" }).first(),
      db("ingestion_jobs").where({ status: "processing" }).count({ count: "*" }).first(),
      db("ingestion_jobs").where({ status: "completed" }).count({ count: "*" }).first(),
      db("ingestion_jobs").where({ status: "failed" }).count({ count: "*" }).first(),
      db("dead_letter_jobs").count({ count: "*" }).first(),
    ]);
    return {
      pending: Number(pending?.count ?? 0),
      processing: Number(processing?.count ?? 0),
      completed: Number(completed?.count ?? 0),
      failed: Number(failed?.count ?? 0),
      deadLetter: Number(deadLetter?.count ?? 0),
    };
  }

  public async getUnconfirmedEventMetrics(): Promise<{
    total: number;
    pendingConfirmation: number;
    confirmed: number;
    rolledBack: number;
  }> {
    const db = getDatabase();
    const [total, pendingConfirmation, confirmed, rolledBack] = await Promise.all([
      db("unconfirmed_events").count({ count: "*" }).first(),
      db("unconfirmed_events").where({ is_confirmed: false, is_rolled_back: false }).count({ count: "*" }).first(),
      db("unconfirmed_events").where({ is_confirmed: true }).count({ count: "*" }).first(),
      db("unconfirmed_events").where({ is_rolled_back: true }).count({ count: "*" }).first(),
    ]);
    return {
      total: Number(total?.count ?? 0),
      pendingConfirmation: Number(pendingConfirmation?.count ?? 0),
      confirmed: Number(confirmed?.count ?? 0),
      rolledBack: Number(rolledBack?.count ?? 0),
    };
  }

  public async requeueDeadLetter(jobId: string): Promise<void> {
    const db = getDatabase();
    const deadJob = await db("dead_letter_jobs").where({ id: jobId }).first();
    if (!deadJob) {
      throw new Error(`Dead-letter job not found: ${jobId}`);
    }
    const now = new Date();
    await db("ingestion_jobs").insert({
      id: deadJob.id,
      type: deadJob.type,
      priority: deadJob.priority,
      payload: deadJob.payload,
      attempts: 0,
      max_attempts: deadJob.max_attempts ?? 3,
      created_at: deadJob.created_at,
      updated_at: now,
      next_retry_at: null,
      status: "pending",
    });
    await db("dead_letter_jobs").where({ id: jobId }).delete();
    logger.info({ jobId }, "Dead-letter job re-queued");
  }

  private calculateBackoff(attempt: number): Date {
    const baseDelayMs = 5_000;
    const delay = baseDelayMs * Math.pow(2, attempt - 1);
    const next = new Date();
    next.setTime(next.getTime() + delay);
    return next;
  }

  private async moveToDeadLetter(jobRow: IngestionJobRow): Promise<void> {
    const db = getDatabase();
    await db("dead_letter_jobs").insert({
      id: jobRow.id,
      type: jobRow.type,
      priority: jobRow.priority,
      payload: jobRow.payload,
      attempts: jobRow.attempts,
      max_attempts: jobRow.max_attempts,
      error_message: jobRow.last_error ?? null,
      created_at: jobRow.created_at,
      failed_at: new Date(),
    });
    await db("ingestion_jobs").where({ id: jobRow.id }).delete();
    logger.warn({ jobId: jobRow.id }, "Job moved to dead-letter queue");
  }
  private mapUnconfirmedEvent(row: UnconfirmedEventRow): UnconfirmedEvent {
    // Delegate to the shared pure mapper to keep logic testable and reuseable.
    // Import dynamically to avoid circular import issues at module load time.
    // (The mapper is lightweight and synchronous.)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { mapUnconfirmedEventRow } = require("./ingestionQueueManager.mapper.js");
    return mapUnconfirmedEventRow(row);
  }

  private async getCurrentLedger(sourceChain: string): Promise<number | null> {
    try {
      const db = getDatabase();
      if (sourceChain === "stellar") {
        const result = await db("unconfirmed_events")
          .where({ source_chain: sourceChain })
          .max("observed_ledger as max_ledger")
          .first();
        const ledger = result?.max_ledger ? Number(result.max_ledger) : null;
        return ledger !== null ? ledger + 1 : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async checkTransactionOnChain(chain: string, txHash: string, ledgerSequence: number): Promise<boolean> {
    try {
      const db = getDatabase();
      const existing = await db("unconfirmed_events")
        .where({ tx_hash: txHash, source_chain: chain, ledger_sequence: ledgerSequence, is_rolled_back: false })
        .first();
      return !!existing;
    } catch {
      return true;
    }
  }
}

export const ingestionQueueManager = IngestionQueueManager.getInstance();
