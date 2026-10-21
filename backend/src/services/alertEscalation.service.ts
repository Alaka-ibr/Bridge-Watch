/**
 * Alert Severity Escalation Engine
 * Automatically escalates alert severity based on condition frequency, persistence, and recurrence patterns.
 * Supports escalation rules, frequency tracking, time windows, manual overrides, and metrics collection.
 */

import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { randomBytes } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type EscalationTrigger = "frequency" | "duration" | "recurrence" | "manual";

/**
 * Escalation rule defines how an alert severity should progress
 */
export interface AlertEscalationRule {
  id: string;
  assetCode: string;
  alertType: string;
  fromSeverity: AlertSeverity;
  toSeverity: AlertSeverity;
  triggerType: EscalationTrigger;
  // For frequency-based escalation: how many occurrences within the time window
  frequencyThreshold?: number;
  // For duration-based escalation: how long (minutes) the condition must persist
  durationMinutes?: number;
  // For recurrence-based escalation: how many separate incidents within the time window
  recurrenceCount?: number;
  // Time window to track occurrences/duration (minutes)
  timeWindowMinutes: number;
  // Whether to allow manual override (skip this escalation)
  allowManualOverride: boolean;
  // Notification channels when escalation occurs
  notificationChannels: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tracks condition history for escalation decisions
 */
export interface ConditionHistory {
  id: string;
  alertRuleId: string;
  assetCode: string;
  alertType: string;
  occurrenceCount: number;
  firstOccurrenceAt: Date;
  lastOccurrenceAt: Date;
  totalDurationMinutes: number;
  currentSeverity: AlertSeverity;
  escalatedSeverity: AlertSeverity | null;
  escalationHistory: EscalationEvent[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Individual escalation event
 */
export interface EscalationEvent {
  id: string;
  conditionHistoryId: string;
  fromSeverity: AlertSeverity;
  toSeverity: AlertSeverity;
  trigger: EscalationTrigger;
  reason: string;
  escalatedAt: Date;
  escalatedBy: "system" | "manual";
  manualOverrideBy?: string;
  manualOverrideReason?: string;
}

/**
 * A single step in a previewed escalation policy chain
 */
export interface EscalationPolicyPreviewStep {
  ruleId: string;
  fromSeverity: AlertSeverity;
  toSeverity: AlertSeverity;
  triggerType: EscalationTrigger;
  thresholdDescription: string;
  notificationChannels: string[];
}

/**
 * Result of previewing an alert escalation policy for an asset/alert type,
 * without recording any occurrences or mutating escalation state.
 */
export interface EscalationPolicyPreviewResult {
  assetCode: string;
  alertType: string;
  startingSeverity: AlertSeverity;
  activeConditionHistoryId: string | null;
  steps: EscalationPolicyPreviewStep[];
  projectedFinalSeverity: AlertSeverity;
  warnings: string[];
}

/**
 * Escalation metrics for monitoring
 */
export interface EscalationMetrics {
  totalEscalations: number;
  escalationsBy24h: number;
  averageTimeToEscalate: number;
  escalationsByTrigger: Record<EscalationTrigger, number>;
  escalationsBySeverity: Record<AlertSeverity, number>;
  activeConditions: number;
  manualOverrides: number;
}

type CountRow = { count?: string | number };
type EscalationTimeRow = { minutes_to_escalate?: string | number | null };
type TriggerCountRow = { trigger: EscalationTrigger; count?: string | number };
type SeverityCountRow = { to_severity: AlertSeverity; count?: string | number };

const countValue = (value: string | number | null | undefined): number =>
  Number(value ?? 0);

interface EscalationRuleLike {
  id: string;
  fromSeverity: AlertSeverity;
  toSeverity: AlertSeverity;
  triggerType: EscalationTrigger;
  frequencyThreshold?: number | null;
  durationMinutes?: number | null;
  recurrenceCount?: number | null;
  timeWindowMinutes: number;
  notificationChannels: string[];
}

/** Pure: human-readable description of what triggers a given escalation rule. */
export function describeEscalationThreshold(rule: EscalationRuleLike): string {
  switch (rule.triggerType) {
    case "frequency":
      return `${rule.frequencyThreshold ?? "?"} occurrence(s) within ${rule.timeWindowMinutes}m`;
    case "duration":
      return `condition persists for ${rule.durationMinutes ?? "?"}m`;
    case "recurrence":
      return `${rule.recurrenceCount ?? "?"} recurrence(s) within ${rule.timeWindowMinutes}m`;
    case "manual":
      return "manual escalation only";
    default:
      return "unknown trigger";
  }
}

/**
 * Pure: walks the rule chain starting from `startSeverity`, following each
 * rule's fromSeverity -> toSeverity link, stopping when no further rule
 * applies or a severity is revisited (to guard against misconfigured cycles).
 */
export function buildEscalationChain(
  rules: EscalationRuleLike[],
  startSeverity: AlertSeverity
): EscalationPolicyPreviewStep[] {
  const steps: EscalationPolicyPreviewStep[] = [];
  const visited = new Set<AlertSeverity>([startSeverity]);
  let current = startSeverity;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rule = rules.find((r) => r.fromSeverity === current);
    if (!rule) break;

    steps.push({
      ruleId: rule.id,
      fromSeverity: rule.fromSeverity,
      toSeverity: rule.toSeverity,
      triggerType: rule.triggerType,
      thresholdDescription: describeEscalationThreshold(rule),
      notificationChannels: rule.notificationChannels,
    });

    if (visited.has(rule.toSeverity)) break;
    visited.add(rule.toSeverity);
    current = rule.toSeverity;
  }

  return steps;
}

// ─── Alert Escalation Service ─────────────────────────────────────────────────

export class AlertEscalationService {
  private readonly CHECK_INTERVAL_MS = 60000; // Check escalation conditions every 1 minute
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Start the escalation monitoring loop
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("AlertEscalationService is already running");
      return;
    }

    this.isRunning = true;
    logger.info("Starting AlertEscalationService");

    this.checkInterval = setInterval(async () => {
      try {
        await this.checkPendingEscalations();
      } catch (error) {
        logger.error(
          { error },
          "Error checking pending escalations"
        );
      }
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop the escalation monitoring loop
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    logger.info("AlertEscalationService stopped");
  }

  /**
   * Create an escalation rule
   */
  async createEscalationRule(
    rule: Omit<AlertEscalationRule, "id" | "createdAt" | "updatedAt">
  ): Promise<AlertEscalationRule> {
    const db = getDatabase();
    const id = randomBytes(16).toString("hex");

    try {
      const newRule: AlertEscalationRule = {
        id,
        ...rule,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db("alert_escalation_rules").insert({
        id: newRule.id,
        asset_code: newRule.assetCode,
        alert_type: newRule.alertType,
        from_severity: newRule.fromSeverity,
        to_severity: newRule.toSeverity,
        trigger_type: newRule.triggerType,
        frequency_threshold: newRule.frequencyThreshold,
        duration_minutes: newRule.durationMinutes,
        recurrence_count: newRule.recurrenceCount,
        time_window_minutes: newRule.timeWindowMinutes,
        allow_manual_override: newRule.allowManualOverride,
        notification_channels: JSON.stringify(newRule.notificationChannels),
        is_active: newRule.isActive,
        created_at: newRule.createdAt,
        updated_at: newRule.updatedAt,
      });

      logger.info(
        {
          ruleId: id,
          assetCode: rule.assetCode,
          alertType: rule.alertType,
          escalation: `${rule.fromSeverity} → ${rule.toSeverity}`,
        },
        "Alert escalation rule created"
      );

      return newRule;
    } catch (error) {
      logger.error({ error, rule }, "Failed to create escalation rule");
      throw error;
    }
  }

  /**
   * Record an alert occurrence and track condition history
   */
  async recordAlertOccurrence(
    alertRuleId: string,
    assetCode: string,
    alertType: string,
    severity: AlertSeverity
  ): Promise<ConditionHistory> {
    const db = getDatabase();

    try {
      // Get or create condition history
      let history = await db("alert_condition_history")
        .where({
          alert_rule_id: alertRuleId,
          asset_code: assetCode,
          is_active: true,
        })
        .first();

      const now = new Date();

      if (!history) {
        // Create new history entry
        const historyId = randomBytes(16).toString("hex");
        const newHistory = {
          id: historyId,
          alert_rule_id: alertRuleId,
          asset_code: assetCode,
          alert_type: alertType,
          occurrence_count: 1,
          first_occurrence_at: now,
          last_occurrence_at: now,
          total_duration_minutes: 0,
          current_severity: severity,
          escalated_severity: null,
          escalation_history: JSON.stringify([]),
          is_active: true,
          created_at: now,
          updated_at: now,
        };

        await db("alert_condition_history").insert(newHistory);
        history = newHistory;
      } else {
        // Update existing history
        const timeDiffMinutes = Math.floor(
          (now.getTime() - new Date(history.first_occurrence_at).getTime()) /
            60000
        );

        await db("alert_condition_history")
          .where({ id: history.id })
          .update({
            occurrence_count: history.occurrence_count + 1,
            last_occurrence_at: now,
            total_duration_minutes: timeDiffMinutes,
            current_severity: severity,
            updated_at: now,
          });

        history.occurrence_count += 1;
        history.last_occurrence_at = now;
        history.total_duration_minutes = timeDiffMinutes;
        history.current_severity = severity;
      }

      // Check if escalation should occur
      await this.evaluateEscalationCriteria(history.id, severity);

      return this.formatConditionHistory(history);
    } catch (error) {
      logger.error(
        { error, alertRuleId, assetCode },
        "Failed to record alert occurrence"
      );
      throw error;
    }
  }

  /**
   * Evaluate if an alert should be escalated
   */
  private async evaluateEscalationCriteria(
    conditionHistoryId: string,
    currentSeverity: AlertSeverity
  ): Promise<void> {
    const db = getDatabase();

    try {
      const history = await db("alert_condition_history")
        .where({ id: conditionHistoryId })
        .first();

      if (!history) return;

      // Get applicable escalation rules
      const rules = await db("alert_escalation_rules")
        .where({
          asset_code: history.asset_code,
          alert_type: history.alert_type,
          from_severity: currentSeverity,
          is_active: true,
        });

      for (const rule of rules) {
        let shouldEscalate = false;
        let reason = "";

        const now = new Date();
        const timeWindowStart = new Date(
          now.getTime() - rule.time_window_minutes * 60000
        );

        if (rule.trigger_type === "frequency") {
          // Check if frequency threshold is met
          if (
            rule.frequency_threshold &&
            history.occurrence_count >= rule.frequency_threshold
          ) {
            shouldEscalate = true;
            reason = `Alert triggered ${history.occurrence_count} times (threshold: ${rule.frequency_threshold})`;
          }
        } else if (rule.trigger_type === "duration") {
          // Check if condition persisted long enough
          if (
            rule.duration_minutes &&
            history.total_duration_minutes >= rule.duration_minutes
          ) {
            shouldEscalate = true;
            reason = `Condition persisted for ${history.total_duration_minutes} minutes (threshold: ${rule.duration_minutes})`;
          }
        } else if (rule.trigger_type === "recurrence") {
          // Check for separate recurring incidents
          const recentIncidents = await db("alert_condition_history")
            .where({
              alert_rule_id: history.alert_rule_id,
              asset_code: history.asset_code,
              created_at: { ">=": timeWindowStart },
            })
            .count("id as count")
            .first();

          if (
            rule.recurrence_count &&
            recentIncidents?.count >= rule.recurrence_count
          ) {
            shouldEscalate = true;
            reason = `Condition recurred ${recentIncidents?.count} times (threshold: ${rule.recurrence_count})`;
          }
        }

        if (shouldEscalate) {
          await this.escalateAlert(
            conditionHistoryId,
            currentSeverity,
            rule.to_severity,
            rule.trigger_type as EscalationTrigger,
            reason,
            JSON.parse(rule.notification_channels)
          );
        }
      }
    } catch (error) {
      logger.error(
        { error, conditionHistoryId },
        "Error evaluating escalation criteria"
      );
    }
  }

  /**
   * Execute alert escalation
   */
  private async escalateAlert(
    conditionHistoryId: string,
    fromSeverity: AlertSeverity,
    toSeverity: AlertSeverity,
    trigger: EscalationTrigger,
    reason: string,
    notificationChannels: string[]
  ): Promise<void> {
    const db = getDatabase();

    try {
      const history = await db("alert_condition_history")
        .where({ id: conditionHistoryId })
        .first();

      if (!history) return;

      // Check if already escalated to this severity
      if (history.escalated_severity === toSeverity) {
        logger.debug(
          { conditionHistoryId },
          "Already escalated to this severity"
        );
        return;
      }

      // Create escalation event
      const eventId = randomBytes(16).toString("hex");
      const escalationEvent: EscalationEvent = {
        id: eventId,
        conditionHistoryId,
        fromSeverity,
        toSeverity,
        trigger,
        reason,
        escalatedAt: new Date(),
        escalatedBy: "system",
      };

      // Update history with escalation
      const currentHistory = JSON.parse(history.escalation_history || "[]");
      currentHistory.push(escalationEvent);

      await db("alert_condition_history")
        .where({ id: conditionHistoryId })
        .update({
          escalated_severity: toSeverity,
          escalation_history: JSON.stringify(currentHistory),
          updated_at: new Date(),
        });

      // Record escalation event
      await db("alert_escalation_events").insert({
        id: eventId,
        condition_history_id: conditionHistoryId,
        from_severity: fromSeverity,
        to_severity: toSeverity,
        trigger,
        reason,
        escalated_at: new Date(),
        escalated_by: "system",
      });

      logger.info(
        {
          conditionHistoryId,
          escalation: `${fromSeverity} → ${toSeverity}`,
          trigger,
          reason,
        },
        "Alert escalated"
      );

      // Send notifications
      await this.sendEscalationNotifications(
        history.asset_code,
        history.alert_type,
        toSeverity,
        reason,
        notificationChannels
      );
    } catch (error) {
      logger.error({ error, conditionHistoryId }, "Failed to escalate alert");
      throw error;
    }
  }

  /**
   * Apply manual override to escalation
   */
  async applyManualOverride(
    conditionHistoryId: string,
    overrideBy: string,
    reason: string,
    newSeverity?: AlertSeverity
  ): Promise<void> {
    const db = getDatabase();

    try {
      const history = await db("alert_condition_history")
        .where({ id: conditionHistoryId })
        .first();

      if (!history) {
        throw new Error("Condition history not found");
      }

      // Record manual override event
      const overrideId = randomBytes(16).toString("hex");
      const currentHistory = JSON.parse(history.escalation_history || "[]");

      const overrideEvent: Partial<EscalationEvent> = {
        id: overrideId,
        conditionHistoryId,
        fromSeverity: history.current_severity,
        toSeverity: newSeverity || history.current_severity,
        trigger: "manual" as EscalationTrigger,
        reason,
        escalatedAt: new Date(),
        escalatedBy: "manual",
        manualOverrideBy: overrideBy,
        manualOverrideReason: reason,
      };

      currentHistory.push(overrideEvent);

      // Update history
      const updateData: any = {
        escalation_history: JSON.stringify(currentHistory),
        updated_at: new Date(),
      };

      if (newSeverity) {
        updateData.escalated_severity = newSeverity;
      }

      await db("alert_condition_history")
        .where({ id: conditionHistoryId })
        .update(updateData);

      logger.info(
        {
          conditionHistoryId,
          overrideBy,
          newSeverity: newSeverity || "unchanged",
        },
        "Manual override applied"
      );
    } catch (error) {
      logger.error(
        { error, conditionHistoryId },
        "Failed to apply manual override"
      );
      throw error;
    }
  }

  /**
   * Check pending escalations (called by monitoring loop)
   */
  private async checkPendingEscalations(): Promise<void> {
    const db = getDatabase();

    try {
      const activeConditions = await db("alert_condition_history")
        .where({ is_active: true })
        .select();

      for (const condition of activeConditions) {
        await this.evaluateEscalationCriteria(
          condition.id,
          condition.current_severity
        );
      }
    } catch (error) {
      logger.error({ error }, "Error in checkPendingEscalations");
    }
  }

  /**
   * Get escalation metrics
   */
  async getEscalationMetrics(): Promise<EscalationMetrics> {
    const db = getDatabase();

    try {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [
        totalEscalations,
        escalationsBy24h,
        escalationsByTrigger,
        escalationsBySeverity,
        activeConditions,
        manualOverrides,
      ] = await Promise.all([
        db("alert_escalation_events").count("id as count").first<CountRow>(),
        db("alert_escalation_events")
          .where({ escalated_at: { ">=": oneDayAgo } })
          .count("id as count")
          .first<CountRow>(),
        db("alert_escalation_events")
          .select("trigger")
          .count("id as count")
          .groupBy("trigger") as Promise<TriggerCountRow[]>,
        db("alert_escalation_events")
          .select("to_severity")
          .count("id as count")
          .groupBy("to_severity") as Promise<SeverityCountRow[]>,
        db("alert_condition_history")
          .where({ is_active: true })
          .count("id as count")
          .first<CountRow>(),
        db("alert_escalation_events")
          .where({ escalated_by: "manual" })
          .count("id as count")
          .first<CountRow>(),
      ]);

      // Calculate average time to escalate
      const escalationTimes = (await db("alert_condition_history")
        .select(
          db.raw(
            "EXTRACT(EPOCH FROM (MIN(ae.escalated_at) - ach.created_at))/60 as minutes_to_escalate"
          )
        )
        .join("alert_escalation_events as ae", "ach.id", "ae.condition_history_id")
        .groupBy("ach.id")) as EscalationTimeRow[];

      const avgTimeToEscalate =
        escalationTimes.length > 0
          ? escalationTimes.reduce(
              (sum, row) => sum + countValue(row.minutes_to_escalate),
              0
            ) / escalationTimes.length
          : 0;

      // Build metrics object
      const metrics: EscalationMetrics = {
        totalEscalations: countValue(totalEscalations?.count),
        escalationsBy24h: countValue(escalationsBy24h?.count),
        averageTimeToEscalate: Math.round(avgTimeToEscalate * 100) / 100,
        escalationsByTrigger: {
          frequency: 0,
          duration: 0,
          recurrence: 0,
          manual: 0,
        },
        escalationsBySeverity: {
          low: 0,
          medium: 0,
          high: 0,
          critical: 0,
        },
        activeConditions: countValue(activeConditions?.count),
        manualOverrides: countValue(manualOverrides?.count),
      };

      // Populate trigger counts
      for (const row of escalationsByTrigger) {
        if (row.trigger in metrics.escalationsByTrigger) {
          metrics.escalationsByTrigger[row.trigger] = countValue(row.count);
        }
      }

      // Populate severity counts
      for (const row of escalationsBySeverity) {
        if (row.to_severity in metrics.escalationsBySeverity) {
          metrics.escalationsBySeverity[row.to_severity] = countValue(row.count);
        }
      }

      return metrics;
    } catch (error) {
      logger.error({ error }, "Failed to get escalation metrics");
      throw error;
    }
  }

  /**
   * Close/resolve a condition history
   */
  async closeConditionHistory(conditionHistoryId: string): Promise<void> {
    const db = getDatabase();

    try {
      await db("alert_condition_history")
        .where({ id: conditionHistoryId })
        .update({
          is_active: false,
          updated_at: new Date(),
        });

      logger.info(
        { conditionHistoryId },
        "Condition history closed"
      );
    } catch (error) {
      logger.error(
        { error, conditionHistoryId },
        "Failed to close condition history"
      );
      throw error;
    }
  }

  /**
   * Preview the escalation policy that would apply to an asset/alert type.
   * Walks the configured rule chain from the current (or "low") severity to
   * show every step an alert would pass through, without recording any
   * occurrences or mutating escalation state.
   */
  async previewEscalationPolicy(
    assetCode: string,
    alertType: string
  ): Promise<EscalationPolicyPreviewResult> {
    const db = getDatabase();

    try {
      const [ruleRows, activeHistory] = await Promise.all([
        db("alert_escalation_rules").where({
          asset_code: assetCode,
          alert_type: alertType,
          is_active: true,
        }),
        db("alert_condition_history")
          .where({ asset_code: assetCode, alert_type: alertType, is_active: true })
          .first(),
      ]);

      const rules: EscalationRuleLike[] = ruleRows.map((row: any) => ({
        id: row.id,
        fromSeverity: row.from_severity,
        toSeverity: row.to_severity,
        triggerType: row.trigger_type,
        frequencyThreshold: row.frequency_threshold,
        durationMinutes: row.duration_minutes,
        recurrenceCount: row.recurrence_count,
        timeWindowMinutes: row.time_window_minutes,
        notificationChannels:
          typeof row.notification_channels === "string"
            ? JSON.parse(row.notification_channels || "[]")
            : row.notification_channels ?? [],
      }));

      const startingSeverity: AlertSeverity = activeHistory?.current_severity ?? "low";
      const steps = buildEscalationChain(rules, startingSeverity);

      const projectedFinalSeverity: AlertSeverity =
        steps.length > 0 ? steps[steps.length - 1].toSeverity : startingSeverity;

      const warnings: string[] = [];
      if (rules.length === 0) {
        warnings.push("No active escalation rules configured for this asset/alert type.");
      }
      if (steps.length === 0 && rules.length > 0) {
        warnings.push(`No rule starts from severity "${startingSeverity}".`);
      }

      return {
        assetCode,
        alertType,
        startingSeverity,
        activeConditionHistoryId: activeHistory?.id ?? null,
        steps,
        projectedFinalSeverity,
        warnings,
      };
    } catch (error) {
      logger.error({ error, assetCode, alertType }, "Failed to preview escalation policy");
      throw error;
    }
  }

  /**
   * Send escalation notifications
   */
  private async sendEscalationNotifications(
    assetCode: string,
    alertType: string,
    severity: AlertSeverity,
    reason: string,
    channels: string[]
  ): Promise<void> {
    try {
      // This would integrate with notification services (email, Telegram, Discord, webhooks)
      logger.info(
        {
          assetCode,
          alertType,
          severity,
          channels,
          reason,
        },
        "Sending escalation notification"
      );

      // TODO: Integrate with notification services
      // for (const channel of channels) {
      //   if (channel === 'email') await emailService.send(...);
      //   if (channel === 'telegram') await telegramService.send(...);
      //   if (channel === 'discord') await discordService.send(...);
      //   if (channel === 'webhook') await webhookService.send(...);
      // }
    } catch (error) {
      logger.error({ error }, "Failed to send escalation notifications");
    }
  }

  /**
   * Format condition history for API response
   */
  private formatConditionHistory(history: any): ConditionHistory {
    return {
      id: history.id,
      alertRuleId: history.alert_rule_id,
      assetCode: history.asset_code,
      alertType: history.alert_type,
      occurrenceCount: history.occurrence_count,
      firstOccurrenceAt: new Date(history.first_occurrence_at),
      lastOccurrenceAt: new Date(history.last_occurrence_at),
      totalDurationMinutes: history.total_duration_minutes,
      currentSeverity: history.current_severity,
      escalatedSeverity: history.escalated_severity,
      escalationHistory: JSON.parse(history.escalation_history || "[]"),
      isActive: history.is_active,
      createdAt: new Date(history.created_at),
      updatedAt: new Date(history.updated_at),
    };
  }
}

// ─── Export Singleton ─────────────────────────────────────────────────────────

export const alertEscalationService = new AlertEscalationService();
