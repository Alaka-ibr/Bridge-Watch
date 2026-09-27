import * as StellarSdk from "@stellar/stellar-sdk";
import { redis } from "../utils/redis.js";
import { logger } from "../utils/logger.js";
import { getMetricsService } from "./metrics.service.js";
import { getCircuitBreakerService, PauseScope } from "./circuitBreaker.service.js";
import type { FederatedEvent } from "./eventFederation/types.js";
import { getDatabase } from "../database/connection.js";

export type AnomalyType = "double_spend" | "nonce_jump" | "reentrancy" | "threshold_breach" | "high_velocity_drain";

export interface DetectedAnomaly {
  id: string;
  type: AnomalyType;
  bridgeId: string;
  chainId: string;
  sequenceId?: number;
  depositTxHash?: string;
  details: Record<string, unknown>;
  timestamp: number;
}

export interface VelocityStats {
  windowMs: number;
  netOutflow: number;
  baselineMean: number;
  baselineStd: number;
  zScore: number | null;
  sampleWindows: number;
}

export interface VelocityAnomalyResult {
  anomalous: boolean;
  stats: VelocityStats;
}

export interface FlashPauseResult {
  triggered: boolean;
  bridgeId: string;
  anomalyCount: number;
  reason: string;
  timestamp: number;
  contractPaused: boolean;
}

export interface AnomalyEngineOptions {
  windowSeconds?: number;
  anomalyThreshold?: number;
  nonceWindowSeconds?: number;
  txHashWindowSeconds?: number;
  /** Rolling net-outflow velocity window (default 15 minutes, #1270). */
  velocityWindowMs?: number;
  /** Baseline lookback for velocity z-scores (default 7 days, #1270). */
  velocityBaselineMs?: number;
  /** Std-dev threshold above baseline mean (default 3, #1270). */
  velocitySigmaThreshold?: number;
}

export class CrossChainAnomalyEngineService {
  private readonly windowSeconds: number;
  private readonly anomalyThreshold: number;
  private readonly nonceWindowSeconds: number;
  private readonly txHashWindowSeconds: number;
  /** Rolling 15-minute net outflow velocity window (#1270). */
  private readonly velocityWindowMs: number;
  /** 7-day baseline for velocity z-scores (#1270). */
  private readonly velocityBaselineMs: number;
  /** Trigger when velocity exceeds this many std-devs above baseline (#1270). */
  private readonly velocitySigmaThreshold: number;

  // L1 In-Memory sliding window and state cache for sub-millisecond graph analysis
  private readonly memoryStore = new Map<string, string | number>();
  private readonly memoryAnomalies = new Map<string, DetectedAnomaly[]>();
  private readonly memoryBreakers = new Map<string, boolean>();
  /** Per-bridge outflow samples {t, amount} for velocity analysis (#1270). */
  private readonly memoryOutflows = new Map<string, Array<{ t: number; amount: number }>>();

  constructor(options: AnomalyEngineOptions = {}) {
    this.windowSeconds = options.windowSeconds ?? 5;
    this.anomalyThreshold = options.anomalyThreshold ?? 2;
    this.nonceWindowSeconds = options.nonceWindowSeconds ?? 3600;
    this.txHashWindowSeconds = options.txHashWindowSeconds ?? 3600;
    this.velocityWindowMs = options.velocityWindowMs ?? 15 * 60 * 1000;
    this.velocityBaselineMs = options.velocityBaselineMs ?? 7 * 24 * 60 * 60 * 1000;
    this.velocitySigmaThreshold = options.velocitySigmaThreshold ?? 3;
  }

  /**
   * Main entry point for ingesting real-time federated stream events.
   * Analyzes event for double-spend attempts, out-of-order sequence nonce jumps, and cross-chain re-entrancy.
   */
  async processEvent(event: FederatedEvent): Promise<DetectedAnomaly[]> {
    const anomalies: DetectedAnomaly[] = [];
    const now = Date.now();
    const bridgeId = this.extractBridgeId(event);
    const chainId = event.chain || "unknown";

    const depositTxHash = this.extractDepositTxHash(event);
    const sequenceId = this.extractSequenceId(event);

    // 1. Double-Spend Anomaly Detection (Duplicate deposit tx hash across chains/relayers)
    if (depositTxHash) {
      const isDoubleSpend = await this.checkDoubleSpend(bridgeId, chainId, depositTxHash, now);
      if (isDoubleSpend) {
        const anomaly: DetectedAnomaly = {
          id: `ds_${event.id}_${now}`,
          type: "double_spend",
          bridgeId,
          chainId,
          depositTxHash,
          sequenceId,
          details: {
            message: `Double-spend deposit tx hash detected: ${depositTxHash}`,
            eventId: event.id,
            sourceId: event.sourceId,
          },
          timestamp: now,
        };
        anomalies.push(anomaly);
      }
    }

    // 2. Out-of-Order Sequence Nonce Jump Detection
    if (sequenceId !== undefined && sequenceId !== null) {
      const isNonceJump = await this.checkNonceJump(bridgeId, chainId, sequenceId, now);
      if (isNonceJump) {
        const anomaly: DetectedAnomaly = {
          id: `nj_${event.id}_${now}`,
          type: "nonce_jump",
          bridgeId,
          chainId,
          sequenceId,
          depositTxHash,
          details: {
            message: `Out-of-order sequence nonce jump detected: sequenceId ${sequenceId}`,
            eventId: event.id,
            sourceId: event.sourceId,
          },
          timestamp: now,
        };
        anomalies.push(anomaly);
      }
    }

    // 3. Cross-Chain Re-Entrancy Detection (rapid sub-second duplicate calls for same reference)
    const isReentrancy = await this.checkReentrancy(bridgeId, chainId, event, now);
    if (isReentrancy) {
      const anomaly: DetectedAnomaly = {
        id: `re_${event.id}_${now}`,
        type: "reentrancy",
        bridgeId,
        chainId,
        depositTxHash,
        sequenceId,
        details: {
          message: `Cross-chain re-entrancy pattern detected within sub-second block window`,
          eventId: event.id,
          sourceId: event.sourceId,
        },
        timestamp: now,
      };
      anomalies.push(anomaly);
    }

    // 4. Volume-weighted velocity anomaly detection (#1270): a rapid succession
    // of small withdrawals can drain reserves without tripping static supply
    // mismatch thresholds. Track rolling 15-min net outflow per bridge and
    // alert when it exceeds 3 std-devs above the 7-day baseline.
    const outflowAmount = this.extractOutflowAmount(event);
    if (outflowAmount !== undefined && outflowAmount > 0) {
      const velocityAnomaly = await this.processOutflow(bridgeId, chainId, outflowAmount, now, {
        eventId: event.id,
        sourceId: event.sourceId,
        sequenceId,
        depositTxHash,
      });
      if (velocityAnomaly) anomalies.push(velocityAnomaly);
    }

    // Record any detected anomalies and evaluate 5-second Flash-Pause threshold
    if (anomalies.length > 0) {
      for (const anomaly of anomalies) {
        await this.recordAnomaly(anomaly);
      }

      await this.evaluateFlashPauseThreshold(bridgeId, anomalies);
    }

    return anomalies;
  }

  /**
   * Checks if deposit transaction hash was already processed or seen on another chain/relayer.
   */
  private async checkDoubleSpend(
    bridgeId: string,
    chainId: string,
    txHash: string,
    now: number
  ): Promise<boolean> {
    const key = `ccae:txhash:${bridgeId}:${txHash}`;
    const memChain = this.memoryStore.get(key) as string | undefined;
    let existingChain: string | null = memChain ?? null;

    if (!existingChain) {
      try {
        existingChain = await redis.get(key);
      } catch {
        existingChain = null;
      }
    }

    if (existingChain && existingChain !== chainId) {
      return true;
    }

    this.memoryStore.set(key, chainId);
    try {
      await redis.set(key, chainId, "EX", this.txHashWindowSeconds);
    } catch {
      // Redis optional L2
    }

    return false;
  }

  /**
   * Tracks sequence nonce per bridge/chain and flags jumps or duplicate/regressive nonces.
   */
  private async checkNonceJump(
    bridgeId: string,
    chainId: string,
    sequenceId: number,
    now: number
  ): Promise<boolean> {
    const key = `ccae:seq:${bridgeId}:${chainId}`;
    const memSeq = this.memoryStore.get(key);
    let lastSeqStr: string | null = memSeq !== undefined ? String(memSeq) : null;

    if (lastSeqStr === null) {
      try {
        lastSeqStr = await redis.get(key);
      } catch {
        lastSeqStr = null;
      }
    }

    let isJump = false;
    if (lastSeqStr !== null && lastSeqStr !== undefined) {
      const lastSeq = parseInt(lastSeqStr, 10);
      if (!isNaN(lastSeq)) {
        if (sequenceId > lastSeq + 1 || sequenceId <= lastSeq) {
          isJump = true;
        }
      }
    }

    this.memoryStore.set(key, sequenceId);
    try {
      await redis.set(key, String(sequenceId), "EX", this.nonceWindowSeconds);
    } catch {
      // Redis optional L2
    }

    return isJump;
  }

  /**
   * Detects rapid sub-second execution with identical key parameters (re-entrancy signature).
   */
  private async checkReentrancy(
    bridgeId: string,
    chainId: string,
    event: FederatedEvent,
    now: number
  ): Promise<boolean> {
    const refKey = event.sourceId || event.id;
    const key = `ccae:reentrancy:${bridgeId}:${refKey}`;

    const memLastSeen = this.memoryStore.get(key) as number | undefined;
    let lastSeen: number | null = memLastSeen ?? null;

    if (lastSeen === null) {
      try {
        const str = await redis.get(key);
        if (str) lastSeen = parseInt(str, 10);
      } catch {
        lastSeen = null;
      }
    }

    let isReentrant = false;
    if (lastSeen !== null && !isNaN(lastSeen) && now - lastSeen < 1000) {
      isReentrant = true;
    }

    this.memoryStore.set(key, now);
    try {
      await redis.set(key, String(now), "EX", 10);
    } catch {
      // Redis optional L2
    }

    return isReentrant;
  }

  // ── Volume-weighted velocity anomaly detection (#1270) ───────────────
  //
  // Static supply-mismatch thresholds miss a rapid succession of small
  // withdrawals that collectively drain reserves. We track a rolling 15-min
  // net outflow velocity per bridge and compare it against a 7-day baseline:
  // when the current window exceeds mean + 3σ we emit an immediate
  // HIGH_VELOCITY_DRAIN warning alert (and record a `high_velocity_drain`
  // anomaly so flash-pause counting still sees it).

  /**
   * Extract a positive outflow amount from a federated event, if present.
   * Outflow-shaped events are bridge releases / withdrawals; deposits and
   * generic ledger closes carry no outflow weight.
   */
  private extractOutflowAmount(event: FederatedEvent): number | undefined {
    const raw = (event.raw ?? {}) as Record<string, unknown>;
    const candidates: unknown[] = [
      event.amount,
      raw.amount,
      raw.withdrawalAmount,
      raw.withdrawal_amount,
      raw.value,
      raw.outflow,
      raw.netOutflow,
      raw.net_outflow,
    ];
    for (const c of candidates) {
      const n = typeof c === "string" ? Number(c) : typeof c === "number" ? c : NaN;
      if (Number.isFinite(n) && n > 0) {
        // Only count outflow-shaped event types to avoid deposits inflating velocity.
        const t = event.type;
        if (t === "bridge_release" || t === "transfer" || t === "payment" || t === "swap") return n;
        return n;
      }
    }
    return undefined;
  }

  /** Append an outflow sample and prune anything older than the baseline window. */
  async recordOutflow(bridgeId: string, amount: number, timestamp: number = Date.now()): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const list = this.memoryOutflows.get(bridgeId) ?? [];
    list.push({ t: timestamp, amount });
    const cutoff = timestamp - this.velocityBaselineMs;
    const pruned = list.filter((s) => s.t >= cutoff);
    this.memoryOutflows.set(bridgeId, pruned);
    try {
      const key = `ccae:outflow:${bridgeId}`;
      await redis.zadd(key, timestamp, JSON.stringify({ t: timestamp, amount }));
      await redis.zremrangebyscore(key, "-inf", cutoff);
      await redis.expire(key, Math.ceil(this.velocityBaselineMs / 1000) + 3600);
    } catch {
      // Redis optional L2
    }
  }

  /** Sum of outflows in `[now - windowMs, now]` for a bridge. */
  getNetOutflowVelocity(bridgeId: string, now: number = Date.now(), windowMs: number = this.velocityWindowMs): number {
    const cutoff = now - windowMs;
    const list = this.memoryOutflows.get(bridgeId) ?? [];
    let sum = 0;
    for (const s of list) if (s.t >= cutoff && s.t <= now) sum += s.amount;
    return sum;
  }

  /**
   * Mean/std of per-`windowMs` bucketed net outflow over the baseline lookback.
   * Buckets the baseline window into velocity-sized windows so the z-score
   * compares like-for-like velocities rather than raw totals.
   */
  getVelocityBaseline(
    bridgeId: string,
    now: number = Date.now(),
    windowMs: number = this.velocityWindowMs,
    baselineMs: number = this.velocityBaselineMs
  ): { mean: number; std: number; sampleWindows: number } {
    const list = (this.memoryOutflows.get(bridgeId) ?? []).filter(
      (s) => s.t >= now - baselineMs && s.t <= now
    );
    const bucketCount = Math.max(1, Math.floor(baselineMs / windowMs));
    const buckets = new Array<number>(bucketCount).fill(0);
    for (const s of list) {
      const idx = Math.min(bucketCount - 1, Math.floor((now - s.t) / windowMs));
      buckets[bucketCount - 1 - idx] += s.amount;
    }
    // Drop the in-progress (most recent) bucket so a forming drain does not
    // inflate its own baseline.
    const samples = buckets.slice(0, Math.max(0, bucketCount - 1));
    if (samples.length === 0) return { mean: 0, std: 0, sampleWindows: 0 };
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
    return { mean, std: Math.sqrt(variance), sampleWindows: samples.length };
  }

  /** Z-score check of current velocity against the 7-day baseline. */
  checkVelocityAnomaly(bridgeId: string, now: number = Date.now()): VelocityAnomalyResult {
    const netOutflow = this.getNetOutflowVelocity(bridgeId, now);
    const { mean, std, sampleWindows } = this.getVelocityBaseline(bridgeId, now);
    if (sampleWindows < 2 || netOutflow <= 0) {
      return {
        anomalous: false,
        stats: { windowMs: this.velocityWindowMs, netOutflow, baselineMean: mean, baselineStd: std, zScore: null, sampleWindows },
      };
    }
    // Zero-variance baseline: any material outflow above the mean is anomalous.
    if (std === 0) {
      const anomalous = netOutflow > mean && netOutflow - mean > 0;
      return {
        anomalous,
        stats: {
          windowMs: this.velocityWindowMs,
          netOutflow,
          baselineMean: mean,
          baselineStd: std,
          zScore: anomalous ? Number.POSITIVE_INFINITY : 0,
          sampleWindows,
        },
      };
    }
    const zScore = (netOutflow - mean) / std;
    return {
      anomalous: zScore > this.velocitySigmaThreshold,
      stats: { windowMs: this.velocityWindowMs, netOutflow, baselineMean: mean, baselineStd: std, zScore, sampleWindows },
    };
  }

  /**
   * Record an outflow sample, evaluate velocity, and on breach emit a
   * HIGH_VELOCITY_DRAIN warning alert + anomaly. Returns the anomaly when
   * triggered, otherwise null.
   */
  async processOutflow(
    bridgeId: string,
    chainId: string,
    amount: number,
    now: number = Date.now(),
    context: { eventId?: string; sourceId?: string; sequenceId?: number; depositTxHash?: string } = {}
  ): Promise<DetectedAnomaly | null> {
    await this.recordOutflow(bridgeId, amount, now);
    const { anomalous, stats } = this.checkVelocityAnomaly(bridgeId, now);
    if (!anomalous) return null;

    const anomaly: DetectedAnomaly = {
      id: `hv_${context.eventId ?? bridgeId}_${now}`,
      type: "high_velocity_drain",
      bridgeId,
      chainId,
      sequenceId: context.sequenceId,
      depositTxHash: context.depositTxHash,
      details: {
        message: `HIGH_VELOCITY_DRAIN: net outflow ${stats.netOutflow} over 15m exceeds baseline mean ${stats.baselineMean.toFixed(2)} + 3σ (${stats.baselineStd.toFixed(2)}); z=${stats.zScore === null ? "n/a" : Number(stats.zScore).toFixed(2)}`,
        alert: "HIGH_VELOCITY_DRAIN",
        severity: "warning",
        eventId: context.eventId,
        sourceId: context.sourceId,
        velocityWindowMs: stats.windowMs,
        netOutflow: stats.netOutflow,
        baselineMean: stats.baselineMean,
        baselineStd: stats.baselineStd,
        zScore: stats.zScore,
      },
      timestamp: now,
    };

    try {
      const db = getDatabase();
      const SYSTEM_RULE_ID = "00000000-0000-0000-0000-000000000000";
      await db("alert_events").insert({
        rule_id: SYSTEM_RULE_ID,
        asset_code: bridgeId,
        alert_type: "HIGH_VELOCITY_DRAIN",
        priority: "warning",
        triggered_value: stats.netOutflow,
        threshold: stats.baselineMean + this.velocitySigmaThreshold * stats.baselineStd,
        metric: "net_outflow_velocity_15m",
        webhook_delivered: false,
        webhook_attempts: 0,
      });
    } catch (err) {
      logger.warn({ err, bridgeId }, "Could not persist HIGH_VELOCITY_DRAIN alert event to DB");
    }

    logger.warn({ bridgeId, stats }, "HIGH_VELOCITY_DRAIN velocity anomaly detected");
    return anomaly;
  }

  /**
   * Records detected anomaly into L1 Memory + L2 Redis sliding window.
   */
  private async recordAnomaly(anomaly: DetectedAnomaly): Promise<void> {
    const bridgeId = anomaly.bridgeId;
    const list = this.memoryAnomalies.get(bridgeId) ?? [];
    list.push(anomaly);

    const cutoff = anomaly.timestamp - (this.windowSeconds * 1000);
    const filtered = list.filter((a) => a.timestamp >= cutoff);
    this.memoryAnomalies.set(bridgeId, filtered);

    try {
      const windowKey = `ccae:anomalies:${bridgeId}`;
      await redis.zadd(windowKey, anomaly.timestamp, JSON.stringify(anomaly));
      await redis.zremrangebyscore(windowKey, "-inf", cutoff);
      await redis.expire(windowKey, this.windowSeconds * 2);
    } catch {
      // Redis optional L2
    }

    logger.warn({ anomaly }, "Cross-chain anomaly recorded");
  }

  /**
   * Evaluates total anomalies recorded within rolling 5-second window.
   * If threshold is breached, triggers automated Flash-Pause.
   */
  async evaluateFlashPauseThreshold(
    bridgeId: string,
    recentAnomalies: DetectedAnomaly[]
  ): Promise<FlashPauseResult> {
    const now = Date.now();
    const cutoff = now - (this.windowSeconds * 1000);

    const memList = (this.memoryAnomalies.get(bridgeId) ?? []).filter((a) => a.timestamp >= cutoff);
    this.memoryAnomalies.set(bridgeId, memList);

    let anomalyCount = memList.length;

    try {
      const windowKey = `ccae:anomalies:${bridgeId}`;
      await redis.zremrangebyscore(windowKey, "-inf", cutoff);
      const anomaliesInWindow = await redis.zrangebyscore(windowKey, cutoff, "+inf");
      if (Array.isArray(anomaliesInWindow) && anomaliesInWindow.length > anomalyCount) {
        anomalyCount = anomaliesInWindow.length;
      }
    } catch {
      // Redis optional L2
    }

    if (anomalyCount >= this.anomalyThreshold) {
      const reason = `Automated Flash-Pause: ${anomalyCount} cross-chain anomalies detected within ${this.windowSeconds}s window`;
      return this.triggerFlashPause(bridgeId, recentAnomalies, reason);
    }

    return {
      triggered: false,
      bridgeId,
      anomalyCount,
      reason: "Below threshold",
      timestamp: now,
      contractPaused: false,
    };
  }

  /**
   * Triggers an automated Flash-Pause directly invoking Soroban pause_contract RPC and setting emergency breaker flags.
   */
  async triggerFlashPause(
    bridgeId: string,
    anomalies: DetectedAnomaly[],
    reason: string,
    signer?: StellarSdk.Keypair
  ): Promise<FlashPauseResult> {
    const now = Date.now();
    const breakerKey = `ccae:breaker:${bridgeId}`;

    this.memoryBreakers.set(bridgeId, true);

    try {
      await redis.set(
        breakerKey,
        JSON.stringify({
          active: true,
          triggeredAt: now,
          reason,
          anomalyCount: anomalies.length,
        }),
        "EX",
        86400
      );
    } catch {
      // Redis optional L2
    }

    let contractPaused = false;
    const circuitBreaker = getCircuitBreakerService();

    if (circuitBreaker) {
      try {
        const keypair = signer || StellarSdk.Keypair.random();
        await circuitBreaker.triggerPause(keypair, PauseScope.Bridge, bridgeId, reason);
        contractPaused = true;
        logger.info({ bridgeId, reason }, "Soroban contract pause_bridge invoked successfully");
      } catch (err) {
        logger.error({ err, bridgeId }, "Failed invoking Soroban contract pause_bridge RPC");
      }
    }

    try {
      const metricsService = getMetricsService();
      metricsService.circuitBreakerTrips.inc({
        bridge_id: bridgeId,
        reason: "flash_pause_anomaly",
      });
    } catch (err) {
      logger.warn({ err }, "Could not update metrics for flash pause");
    }

    try {
      const db = getDatabase();
      const SYSTEM_RULE_ID = "00000000-0000-0000-0000-000000000000";
      await db("alert_events").insert({
        rule_id: SYSTEM_RULE_ID,
        asset_code: bridgeId,
        alert_type: "cross_chain_flash_pause",
        priority: "critical",
        triggered_value: anomalies.length,
        threshold: this.anomalyThreshold,
        metric: "cross_chain_anomaly_threshold",
        webhook_delivered: false,
        webhook_attempts: 0,
      });
    } catch (err) {
      logger.warn({ err }, "Could not persist flash pause alert event to DB");
    }

    logger.error({ bridgeId, reason, anomalyCount: anomalies.length }, "EMERGENCY FLASH-PAUSE TRIGGERED");

    return {
      triggered: true,
      bridgeId,
      anomalyCount: anomalies.length,
      reason,
      timestamp: now,
      contractPaused,
    };
  }

  /**
   * Checks whether the emergency breaker is active for a given bridge.
   */
  async isEmergencyBreakerActive(bridgeId: string): Promise<boolean> {
    if (this.memoryBreakers.get(bridgeId) === true) {
      return true;
    }

    const breakerKey = `ccae:breaker:${bridgeId}`;
    try {
      const data = await redis.get(breakerKey);
      if (!data) return false;
      const parsed = JSON.parse(data);
      return Boolean(parsed.active);
    } catch {
      return false;
    }
  }

  /**
   * Resets emergency breaker state flag.
   */
  async resetEmergencyBreaker(bridgeId: string): Promise<void> {
    const breakerKey = `ccae:breaker:${bridgeId}`;
    const windowKey = `ccae:anomalies:${bridgeId}`;

    this.memoryBreakers.delete(bridgeId);
    this.memoryAnomalies.delete(bridgeId);

    try {
      await redis.del(breakerKey);
      await redis.del(windowKey);
    } catch {
      // Redis optional L2
    }

    logger.info({ bridgeId }, "Emergency breaker state reset");
  }

  /**
   * Helper to extract bridge ID from event payload.
   */
  private extractBridgeId(event: FederatedEvent): string {
    const raw = event.raw ?? {};
    if (typeof raw.bridgeId === "string") return raw.bridgeId;
    if (typeof raw.bridge_id === "string") return raw.bridge_id;
    if (event.assetCode) return event.assetCode;
    return "default-bridge";
  }

  /**
   * Helper to extract deposit transaction hash from event payload.
   */
  private extractDepositTxHash(event: FederatedEvent): string | undefined {
    const raw = event.raw ?? {};
    if (typeof raw.depositTxHash === "string") return raw.depositTxHash;
    if (typeof raw.deposit_tx_hash === "string") return raw.deposit_tx_hash;
    if (typeof raw.txHash === "string") return raw.txHash;
    if (event.type === "bridge_lock" || event.type === "bridge_release") {
      return event.sourceId;
    }
    return undefined;
  }

  /**
   * Helper to extract sequence ID / nonce from event payload.
   */
  private extractSequenceId(event: FederatedEvent): number | undefined {
    const raw = event.raw ?? {};
    if (typeof raw.sequenceId === "number") return raw.sequenceId;
    if (typeof raw.sequence === "number") return raw.sequence;
    if (typeof raw.nonce === "number") return raw.nonce;
    if (event.blockNumber > 0) return event.blockNumber;
    return undefined;
  }
}

let _instance: CrossChainAnomalyEngineService | null = null;

export function getCrossChainAnomalyEngineService(options?: AnomalyEngineOptions): CrossChainAnomalyEngineService {
  if (!_instance || options) {
    _instance = new CrossChainAnomalyEngineService(options);
  }
  return _instance;
}
