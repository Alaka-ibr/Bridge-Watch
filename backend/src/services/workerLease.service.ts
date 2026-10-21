import type { Knex } from "knex";
import { getDatabase } from "../database/connection.js";

/**
 * Durable worker leases with renewal and fencing tokens.
 *
 * `utils/lock.ts` acquires a Redis key with a fixed TTL and cannot extend it, so
 * a worker whose job runs longer than the TTL loses the lock without noticing:
 * the key expires, another worker acquires it, and both proceed. This service
 * addresses that with a renewable lease plus a fencing token that makes the
 * loss detectable at the point of the write.
 *
 * ── Why a fencing token and not just renewal ────────────────────────────────
 *
 * Renewal narrows the window but cannot close it. A worker can stall — GC
 * pause, blocked syscall, suspended VM — past its expiry, wake up still
 * believing it holds the lease, and write. The token is what makes that
 * harmless: it increases on every acquisition, so the stalled worker's write
 * carries a lower token than the current holder's, and the receiving side
 * rejects it via `isFencedOut`. A lease without a fencing token is a lock that
 * is *usually* exclusive, which is not the same thing.
 *
 * The token lives in PostgreSQL rather than Redis because it has to survive an
 * eviction to be worth anything: a token that restarts at zero silently
 * re-authorises every stale writer.
 */

export type LeaseEventType = "acquired" | "renewed" | "released" | "expired" | "stolen";

export interface WorkerLease {
  leaseKey: string;
  ownerId: string | null;
  fencingToken: number;
  acquiredAt: string | null;
  renewedAt: string | null;
  expiresAt: string | null;
  releasedAt: string | null;
  ttlMs: number;
  renewalCount: number;
  lostCount: number;
  metadata: Record<string, unknown>;
}

export interface AcquireResult {
  acquired: boolean;
  lease: WorkerLease | null;
  /** Populated when `acquired` is false, so callers can log why. */
  reason?: "held_by_other";
}

/** Default lease duration. Renewal happens well inside this. */
export const DEFAULT_LEASE_TTL_MS = 30_000;

/**
 * Fraction of the TTL after which a holder should renew.
 *
 * A third leaves room for two consecutive renewal failures before the lease
 * actually lapses — enough to ride out a transient database blip without
 * handing the work to a second worker.
 */
export const RENEWAL_THRESHOLD = 1 / 3;

/**
 * Periodic heartbeat renewal interval for active worker leases (#1269).
 *
 * Workers holding a ledger-range lease renew every 10s so a crash/OOM/node
 * termination is distinguishable from a slow-but-alive worker.
 */
export const LEASE_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * A lease with no heartbeat (renewed_at) for longer than this is considered
 * a zombie: the holder is presumed dead and the lease is eligible for
 * eviction + re-queue of its unfinished range (#1269).
 */
export const LEASE_ZOMBIE_THRESHOLD_MS = 30_000;

export interface ZombieLeaseInfo {
  lease: WorkerLease;
  /** ms since last heartbeat (renewed_at, falling back to acquired_at). */
  msSinceHeartbeat: number;
}

// ── Pure helpers ────────────────────────────────────────────────────────────
//
// Kept free of database access so the timing rules can be tested directly;
// these are where the correctness of the scheme actually lives.

/** True when the lease has lapsed at `now`. */
export function isExpired(lease: Pick<WorkerLease, "expiresAt">, now: Date = new Date()): boolean {
  if (!lease.expiresAt) return true;
  return new Date(lease.expiresAt).getTime() <= now.getTime();
}

/** True when the lease is currently held by `ownerId` and has not lapsed. */
export function isHeldBy(
  lease: Pick<WorkerLease, "ownerId" | "expiresAt">,
  ownerId: string,
  now: Date = new Date()
): boolean {
  return lease.ownerId === ownerId && !isExpired(lease, now);
}

/** Milliseconds remaining before the lease lapses; 0 once it has. */
export function remainingMs(
  lease: Pick<WorkerLease, "expiresAt">,
  now: Date = new Date()
): number {
  if (!lease.expiresAt) return 0;
  return Math.max(0, new Date(lease.expiresAt).getTime() - now.getTime());
}

/**
 * Whether the holder should renew now.
 *
 * Renews once less than `RENEWAL_THRESHOLD` of the TTL remains, so a renewal
 * that fails still leaves time for another attempt before the lease lapses.
 */
export function shouldRenew(
  lease: Pick<WorkerLease, "expiresAt" | "ttlMs">,
  now: Date = new Date()
): boolean {
  const remaining = remainingMs(lease, now);
  if (remaining === 0) return false; // Already lost — reacquire, do not renew.
  return remaining <= lease.ttlMs * RENEWAL_THRESHOLD;
}

/** Recommended heartbeat interval for a given TTL. */
export function renewalIntervalMs(ttlMs: number = DEFAULT_LEASE_TTL_MS): number {
  return Math.max(1_000, Math.floor(ttlMs * RENEWAL_THRESHOLD));
}

/**
 * Whether a write carrying `presentedToken` should be rejected.
 *
 * The receiving side calls this with the token it was handed and the highest
 * token it has seen. Anything not strictly greater than the last accepted token
 * is a stale writer.
 */
export function isFencedOut(presentedToken: number, lastAcceptedToken: number): boolean {
  return presentedToken <= lastAcceptedToken;
}

/** Last heartbeat timestamp for a lease (renewed_at, falling back to acquired_at). */
export function lastHeartbeatAt(
  lease: Pick<WorkerLease, "renewedAt" | "acquiredAt">
): Date | null {
  const raw = lease.renewedAt ?? lease.acquiredAt ?? null;
  if (!raw) return null;
  const t = new Date(raw);
  return isNaN(t.getTime()) ? null : t;
}

/**
 * Whether a held lease is a zombie: owned but with no heartbeat for more
 * than `thresholdMs` (#1269). Unowned leases are never zombies.
 */
export function isZombieLease(
  lease: Pick<WorkerLease, "ownerId" | "renewedAt" | "acquiredAt">,
  now: Date = new Date(),
  thresholdMs: number = LEASE_ZOMBIE_THRESHOLD_MS
): boolean {
  if (!lease.ownerId) return false;
  const hb = lastHeartbeatAt(lease);
  if (!hb) return true; // Owned but never heartbeated — treat as dead.
  return now.getTime() - hb.getTime() > thresholdMs;
}

const map = (r: any): WorkerLease => ({
  leaseKey: r.lease_key,
  ownerId: r.owner_id ?? null,
  fencingToken: Number(r.fencing_token),
  acquiredAt: r.acquired_at ? new Date(r.acquired_at).toISOString() : null,
  renewedAt: r.renewed_at ? new Date(r.renewed_at).toISOString() : null,
  expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
  releasedAt: r.released_at ? new Date(r.released_at).toISOString() : null,
  ttlMs: Number(r.ttl_ms),
  renewalCount: Number(r.renewal_count ?? 0),
  lostCount: Number(r.lost_count ?? 0),
  metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata ?? {}),
});

export class WorkerLeaseService {
  constructor(private readonly db: Knex = getDatabase()) {}

  private async recordEvent(
    tx: Knex,
    input: { leaseKey: string; ownerId: string | null; fencingToken: number; eventType: LeaseEventType; reason?: string }
  ): Promise<void> {
    await tx("worker_lease_events").insert({
      lease_key: input.leaseKey,
      owner_id: input.ownerId,
      fencing_token: input.fencingToken,
      event_type: input.eventType,
      reason: input.reason ?? null,
    });
  }

  /**
   * Acquire a lease, or report that someone else holds it.
   *
   * Serialised with `SELECT ... FOR UPDATE` so two workers racing for the same
   * key cannot both be issued a token. Taking over an expired lease is normal
   * and is recorded as `stolen` rather than `acquired`, because that is the
   * event worth alerting on: it means the previous holder never released.
   */
  async acquire(input: {
    leaseKey: string;
    ownerId: string;
    ttlMs?: number;
    metadata?: Record<string, unknown>;
    now?: Date;
  }): Promise<AcquireResult> {
    const now = input.now ?? new Date();
    const ttlMs = input.ttlMs ?? DEFAULT_LEASE_TTL_MS;

    return this.db.transaction(async (tx) => {
      const current = await tx("worker_leases")
        .where({ lease_key: input.leaseKey })
        .forUpdate()
        .first();

      const heldByOther =
        current &&
        current.owner_id &&
        current.owner_id !== input.ownerId &&
        !isExpired({ expiresAt: current.expires_at }, now);

      if (heldByOther) {
        return { acquired: false, lease: map(current), reason: "held_by_other" as const };
      }

      const tookOverExpired = Boolean(
        current && current.owner_id && current.owner_id !== input.ownerId
      );
      const fencingToken = Number(current?.fencing_token ?? 0) + 1;

      const values = {
        owner_id: input.ownerId,
        fencing_token: fencingToken,
        acquired_at: now,
        renewed_at: now,
        expires_at: new Date(now.getTime() + ttlMs),
        released_at: null,
        ttl_ms: ttlMs,
        renewal_count: 0,
        // A takeover means the previous holder lapsed without releasing.
        lost_count: Number(current?.lost_count ?? 0) + (tookOverExpired ? 1 : 0),
        metadata: JSON.stringify(input.metadata ?? {}),
        updated_at: now,
      };

      const [row] = current
        ? await tx("worker_leases").where({ lease_key: input.leaseKey }).update(values).returning("*")
        : await tx("worker_leases").insert({ lease_key: input.leaseKey, ...values }).returning("*");

      await this.recordEvent(tx, {
        leaseKey: input.leaseKey,
        ownerId: input.ownerId,
        fencingToken,
        eventType: tookOverExpired ? "stolen" : "acquired",
        reason: tookOverExpired ? `previous holder ${current.owner_id} lapsed` : undefined,
      });

      return { acquired: true, lease: map(row) };
    });
  }

  /**
   * Extend a lease the caller still holds.
   *
   * Returns null when the lease was lost — taken over, or lapsed — which the
   * caller must treat as "stop working", not as a retryable error. The fencing
   * token is deliberately *not* bumped: renewal continues the same acquisition,
   * so downstream writes keep the token they were issued.
   */
  async renew(input: {
    leaseKey: string;
    ownerId: string;
    ttlMs?: number;
    now?: Date;
  }): Promise<WorkerLease | null> {
    const now = input.now ?? new Date();

    return this.db.transaction(async (tx) => {
      const current = await tx("worker_leases")
        .where({ lease_key: input.leaseKey })
        .forUpdate()
        .first();

      if (!current) return null;

      // Lost to a takeover, or lapsed and not yet reclaimed. Either way this
      // caller no longer holds it.
      if (current.owner_id !== input.ownerId || isExpired({ expiresAt: current.expires_at }, now)) {
        await this.recordEvent(tx, {
          leaseKey: input.leaseKey,
          ownerId: input.ownerId,
          fencingToken: Number(current.fencing_token),
          eventType: "expired",
          reason:
            current.owner_id !== input.ownerId
              ? `lease now held by ${current.owner_id ?? "nobody"}`
              : "lease lapsed before renewal",
        });
        return null;
      }

      const ttlMs = input.ttlMs ?? Number(current.ttl_ms);
      const [row] = await tx("worker_leases")
        .where({ lease_key: input.leaseKey })
        .update({
          renewed_at: now,
          expires_at: new Date(now.getTime() + ttlMs),
          ttl_ms: ttlMs,
          renewal_count: Number(current.renewal_count ?? 0) + 1,
          updated_at: now,
        })
        .returning("*");

      await this.recordEvent(tx, {
        leaseKey: input.leaseKey,
        ownerId: input.ownerId,
        fencingToken: Number(current.fencing_token),
        eventType: "renewed",
      });

      return map(row);
    });
  }

  /**
   * Release a lease the caller holds.
   *
   * The row is kept with a null owner rather than deleted, so the fencing token
   * never restarts — a fresh row would reissue token 1 and silently
   * re-authorise any stale writer still holding it.
   */
  async release(input: { leaseKey: string; ownerId: string; now?: Date }): Promise<boolean> {
    const now = input.now ?? new Date();

    return this.db.transaction(async (tx) => {
      const current = await tx("worker_leases")
        .where({ lease_key: input.leaseKey })
        .forUpdate()
        .first();

      // Releasing a lease you no longer hold must not clear the current
      // holder's claim.
      if (!current || current.owner_id !== input.ownerId) return false;

      await tx("worker_leases").where({ lease_key: input.leaseKey }).update({
        owner_id: null,
        expires_at: now,
        released_at: now,
        updated_at: now,
      });

      await this.recordEvent(tx, {
        leaseKey: input.leaseKey,
        ownerId: input.ownerId,
        fencingToken: Number(current.fencing_token),
        eventType: "released",
      });

      return true;
    });
  }

  async get(leaseKey: string): Promise<WorkerLease | null> {
    const row = await this.db("worker_leases").where({ lease_key: leaseKey }).first();
    return row ? map(row) : null;
  }

  /** Leases that lapsed without being released — the duplicate-work signal. */
  async findExpired(now: Date = new Date()): Promise<WorkerLease[]> {
    const rows = await this.db("worker_leases")
      .whereNotNull("owner_id")
      .andWhere("expires_at", "<=", now);
    return rows.map(map);
  }

  // ── Heartbeat + zombie eviction (#1269) ────────────────────────────────
  //
  // Workers call `startHeartbeat` after acquiring a ledger-range lease; it
  // renews every LEASE_HEARTBEAT_INTERVAL_MS (10s) so liveness is visible in
  // `renewed_at`. If a pod dies abruptly (OOM / node termination) the
  // heartbeat stops, and the reaper in `ingestionQueueManager` evicts leases
  // with no heartbeat for > LEASE_ZOMBIE_THRESHOLD_MS (30s) and re-queues
  // their unfinished ranges.

  private readonly heartbeats = new Map<string, NodeJS.Timeout>();

  /**
   * Start a 10s periodic renewal for an owned lease. Returns a stop function.
   * Renewal failures are swallowed (the next tick retries); if the lease is
   * lost (renew returns null) the heartbeat stops itself so a dead worker
   * does not spin forever.
   */
  startHeartbeat(input: {
    leaseKey: string;
    ownerId: string;
    ttlMs?: number;
    intervalMs?: number;
    onLost?: (leaseKey: string, ownerId: string) => void;
  }): () => void {
    const key = `${input.leaseKey}:${input.ownerId}`;
    this.stopHeartbeat(input.leaseKey, input.ownerId);

    const intervalMs = input.intervalMs ?? LEASE_HEARTBEAT_INTERVAL_MS;
    const timer = setInterval(async () => {
      try {
        const renewed = await this.renew({
          leaseKey: input.leaseKey,
          ownerId: input.ownerId,
          ttlMs: input.ttlMs,
        });
        if (!renewed) {
          this.stopHeartbeat(input.leaseKey, input.ownerId);
          input.onLost?.(input.leaseKey, input.ownerId);
        }
      } catch {
        // Transient DB blip — next heartbeat tick retries within the TTL.
      }
    }, intervalMs);
    // Don't keep the process alive just for a heartbeat in tests/scripts.
    if (typeof (timer as any)?.unref === "function") (timer as any).unref();
    this.heartbeats.set(key, timer);
    return () => this.stopHeartbeat(input.leaseKey, input.ownerId);
  }

  /** Stop a previously started heartbeat (no-op when none is running). */
  stopHeartbeat(leaseKey: string, ownerId?: string): void {
    if (ownerId) {
      const timer = this.heartbeats.get(`${leaseKey}:${ownerId}`);
      if (timer) {
        clearInterval(timer);
        this.heartbeats.delete(`${leaseKey}:${ownerId}`);
      }
      return;
    }
    for (const [key, timer] of [...this.heartbeats.entries()]) {
      if (key === leaseKey || key.startsWith(`${leaseKey}:`)) {
        clearInterval(timer);
        this.heartbeats.delete(key);
      }
    }
  }

  /** Active heartbeat count (observability for the reaper / health checks). */
  heartbeatCount(): number {
    return this.heartbeats.size;
  }

  /**
   * Leases owned but with no heartbeat for longer than `thresholdMs`.
   * Scans `renewed_at` (falling back to `acquired_at`) so workers that
   * crashed before their first renewal are still caught.
   */
  async findZombieLeases(
    now: Date = new Date(),
    thresholdMs: number = LEASE_ZOMBIE_THRESHOLD_MS
  ): Promise<ZombieLeaseInfo[]> {
    const cutoff = new Date(now.getTime() - thresholdMs);
    const rows = await this.db("worker_leases").whereNotNull("owner_id").andWhere((qb) => {
      qb.where("renewed_at", "<=", cutoff).orWhere((inner) => {
        inner.whereNull("renewed_at").andWhere("acquired_at", "<=", cutoff);
      });
    });
    return rows.map((r) => {
      const lease = map(r);
      const hb = lastHeartbeatAt(lease);
      return {
        lease,
        msSinceHeartbeat: hb ? now.getTime() - hb.getTime() : Number.POSITIVE_INFINITY,
      };
    });
  }

  /**
   * Evict zombie leases: clear the dead owner, bump `lost_count`, stamp
   * `released_at` for audit, and record an `expired` event with the
   * unfinished range in the reason so the caller can re-queue it.
   * Returns the evicted leases (with pre-eviction owner + metadata intact).
   */
  async evictZombieLeases(
    now: Date = new Date(),
    thresholdMs: number = LEASE_ZOMBIE_THRESHOLD_MS
  ): Promise<WorkerLease[]> {
    const zombies = await this.findZombieLeases(now, thresholdMs);
    const evicted: WorkerLease[] = [];
    for (const { lease, msSinceHeartbeat } of zombies) {
      const evictedLease = await this.db.transaction(async (tx) => {
        const current = await tx("worker_leases")
          .where({ lease_key: lease.leaseKey })
          .forUpdate()
          .first();
        if (!current || !current.owner_id) return null;
        // Re-check under the lock — a heartbeat may have landed concurrently.
        const currentLease = map(current);
        if (!isZombieLease(currentLease, now, thresholdMs)) return null;

        const [row] = await tx("worker_leases")
          .where({ lease_key: lease.leaseKey })
          .update({
            owner_id: null,
            expires_at: now,
            released_at: now,
            lost_count: Number(current.lost_count ?? 0) + 1,
            updated_at: now,
          })
          .returning("*");

        await this.recordEvent(tx, {
          leaseKey: lease.leaseKey,
          ownerId: current.owner_id,
          fencingToken: Number(current.fencing_token),
          eventType: "expired",
          reason: `zombie eviction: no heartbeat for ${Math.round(msSinceHeartbeat)}ms; range=${JSON.stringify((currentLease.metadata as any)?.range ?? currentLease.metadata ?? {})}`,
        });
        return map(row);
      });
      if (evictedLease) {
        // Preserve the dead owner + range for the re-queue step.
        evicted.push({ ...evictedLease, ownerId: lease.ownerId, metadata: lease.metadata });
      }
    }
    return evicted;
  }
}

export const workerLeaseService = new WorkerLeaseService();
