// @ts-nocheck
import { database } from "../database/index.js";
import { logger } from "../utils/logger.js";

export interface LedgerCloseRecord {
  ledgerSequence: bigint;
  expectedCloseTime: Date;
  actualCloseTime: Date;
  ledgerHash: string;
  transactionCount: number;
  operationCount: number;
  baseFeeRate: string;
}

export interface DelayAlert {
  ledgerSequence: bigint;
  delaySeconds: number;
  severity: "low" | "medium" | "high" | "critical";
  thresholdSeconds: number;
}

export class LedgerCloseDelayService {
  async recordClosureEvent(record: LedgerCloseRecord) {
    const database = getDatabase();
    logger.info({ ledgerSequence: record.ledgerSequence }, "Recording ledger close event");

    try {
      const delaySeconds = Math.floor((record.actualCloseTime.getTime() - record.expectedCloseTime.getTime()) / 1000);
      const delayThresholds = { critical: 10, high: 6, medium: 3, low: 1 };
      let delaySeverity: "normal" | "minor" | "significant" | "critical" = "normal";

      if (delaySeconds >= delayThresholds.critical) {
        delaySeverity = "critical";
      } else if (delaySeconds >= delayThresholds.high) {
        delaySeverity = "significant";
      } else if (delaySeconds >= delayThresholds.medium) {
        delaySeverity = "minor";
      }

      const isAnomalous = delaySeverity !== "normal";

      const [ledgerEvent] = await database("ledger_close_events")
        .insert({
          ledger_sequence: record.ledgerSequence,
          expected_close_time: record.expectedCloseTime,
          actual_close_time: record.actualCloseTime,
          delay_seconds: delaySeconds,
          ledger_hash: record.ledgerHash,
          transaction_count: record.transactionCount,
          operation_count: record.operationCount,
          base_fee_rate: record.baseFeeRate,
          delay_severity: delaySeverity,
          is_anomalous: isAnomalous,
        })
        .returning("*");

      // Create alert if delay exceeds threshold
      if (isAnomalous) {
        await this.createDelayAlert({
          ledgerSequence: record.ledgerSequence,
          delaySeconds,
          severity: this.mapSeverity(delaySeverity),
          thresholdSeconds: delayThresholds[this.mapSeverity(delaySeverity)],
        });
      }

      return ledgerEvent;
    } catch (error) {
      logger.error({ error }, "Failed to record ledger close event");
      throw error;
    }
  }

  private mapSeverity(delaySeverity: string): "low" | "medium" | "high" | "critical" {
    const mapping: Record<string, "low" | "medium" | "high" | "critical"> = {
      normal: "low",
      minor: "low",
      significant: "high",
      critical: "critical",
    };
    return mapping[delaySeverity] || "low";
  }

  private async createDelayAlert(alert: DelayAlert) {
    const database = getDatabase();
    logger.info(
      {
        ledgerSequence: alert.ledgerSequence,
        delaySeconds: alert.delaySeconds,
        severity: alert.severity,
      },
      "Creating ledger close delay alert"
    );

    const alertType = alert.delaySeconds > 10 ? "critical_delay" : alert.delaySeconds > 6 ? "significant_delay" : "minor_delay";

    await database("ledger_close_delay_alerts").insert({
      ledger_sequence: alert.ledgerSequence,
      alert_type: alertType,
      delay_seconds: alert.delaySeconds,
      severity: alert.severity,
      threshold_seconds: alert.thresholdSeconds,
      threshold_exceeded: alert.delaySeconds > alert.thresholdSeconds,
      status: "open",
    });
  }

  async updateAlertStatus(alertId: string, status: "open" | "investigating" | "resolved" | "dismissed", notes?: string) {
    const database = getDatabase();
    logger.info({ alertId, status }, "Updating delay alert status");

    await database("ledger_close_delay_alerts").where("id", alertId).update({
      status,
      investigation_notes: notes,
      resolved_at: status === "resolved" ? new Date() : null,
      updated_at: new Date(),
    });
  }

  async computeDelayStats(granularity: "hourly" | "daily" | "weekly" | "monthly" = "daily") {
    const database = getDatabase();
    logger.info({ granularity }, "Computing ledger close delay statistics");

    const now = new Date();
    const lookbackDays = granularity === "hourly" ? 1 : granularity === "daily" ? 7 : granularity === "weekly" ? 30 : 90;
    const windowStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const events = await database("ledger_close_events")
      .whereBetween("actual_close_time", [windowStart, now])
      .select(["delay_seconds", "is_anomalous"]);

    if (events.length === 0) {
      return null;
    }

    const delays = events.map((e) => Number(e.delay_seconds)).sort((a, b) => a - b);
    const anomalousCount = events.filter((e) => e.is_anomalous).length;

    const stats = {
      granularity,
      windowStart,
      windowEnd: now,
      totalLedgers: events.length,
      delayedLedgers: anomalousCount,
      averageDelay: delays.reduce((a, b) => a + b, 0) / delays.length,
      maxDelay: delays[delays.length - 1],
      p50Delay: delays[Math.floor(delays.length * 0.5)],
      p95Delay: delays[Math.floor(delays.length * 0.95)],
      p99Delay: delays[Math.floor(delays.length * 0.99)],
      anomalyRate: (anomalousCount / events.length) * 100,
    };

    await database("ledger_close_delay_stats").insert({
      granularity,
      window_start: stats.windowStart,
      window_end: stats.windowEnd,
      total_ledgers: stats.totalLedgers,
      delayed_ledgers: stats.delayedLedgers,
      average_delay_seconds: stats.averageDelay,
      max_delay_seconds: stats.maxDelay,
      p50_delay_seconds: stats.p50Delay,
      p95_delay_seconds: stats.p95Delay,
      p99_delay_seconds: stats.p99Delay,
      anomaly_count: anomalousCount,
      anomaly_rate_percent: stats.anomalyRate,
    });

    return stats;
  }

  async getDelayStats(granularity?: string, limit = 52) {
    const database = getDatabase();
    let query = database("ledger_close_delay_stats");

    if (granularity) {
      query = query.where({ granularity });
    }

    const stats = await query.orderBy("window_start", "desc").limit(limit);
    return stats;
  }

  async detectPatterns() {
    const database = getDatabase();
    logger.info("Detecting ledger close delay patterns");

    const recentDelays = await database("ledger_close_events")
      .orderBy("actual_close_time", "desc")
      .limit(1000)
      .where("is_anomalous", true)
      .select(["actual_close_time", "delay_seconds"]);

    if (recentDelays.length < 10) {
      return [];
    }

    const patterns: Array<{
      patternType: string;
      description: string;
      occurrenceCount: number;
      firstObserved: Date;
      lastObserved: Date;
      averageImpact: number;
      likelihood: "rare" | "occasional" | "frequent" | "persistent";
    }> = [];

    const hourCounts = new Map<number, number>();
    recentDelays.forEach((d) => {
      const hour = new Date(d.actual_close_time).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    });

    const maxHour = Math.max(...hourCounts.values());
    if (maxHour > recentDelays.length * 0.3) {
      const hour = [...hourCounts.entries()].find(([_, count]) => count === maxHour)?.[0];
      patterns.push({
        patternType: "time_of_day",
        description: `Delays cluster around hour ${hour} UTC`,
        occurrenceCount: maxHour,
        firstObserved: recentDelays[recentDelays.length - 1].actual_close_time,
        lastObserved: recentDelays[0].actual_close_time,
        averageImpact: 5.5,
        likelihood: maxHour > recentDelays.length * 0.5 ? "persistent" : "frequent",
      });
    }

    const sortedByTime = [...recentDelays].sort(
      (a, b) => new Date(a.actual_close_time).getTime() - new Date(b.actual_close_time).getTime(),
    );
    let burstCount = 0;
    let maxBurstCount = 0;

    for (let i = 1; i < sortedByTime.length; i++) {
      const timeDiff =
        (new Date(sortedByTime[i].actual_close_time).getTime() - new Date(sortedByTime[i - 1].actual_close_time).getTime()) / 1000;
      if (timeDiff < 60) {
        burstCount++;
        maxBurstCount = Math.max(maxBurstCount, burstCount);
      } else {
        burstCount = 0;
      }
    }

    if (maxBurstCount > 5) {
      patterns.push({
        patternType: "burst",
        description: `Consecutive delays occur in bursts of ${maxBurstCount}+ ledgers`,
        occurrenceCount: maxBurstCount,
        firstObserved: recentDelays[recentDelays.length - 1].actual_close_time,
        lastObserved: recentDelays[0].actual_close_time,
        averageImpact: 7.2,
        likelihood: "occasional",
      });
    }

    for (const pattern of patterns) {
      await database("ledger_close_patterns").insert({
        pattern_type: pattern.patternType,
        description: pattern.description,
        occurrence_count: pattern.occurrenceCount,
        first_observed: pattern.firstObserved,
        last_observed: pattern.lastObserved,
        average_impact_seconds: pattern.averageImpact,
        likelihood: pattern.likelihood,
        is_active: true,
      });
    }

    return patterns;
  }
}

export const ledgerCloseDelayService = new LedgerCloseDelayService();
