/**
 * Migration Examples - Converting Existing Event Producers to Outbox Pattern
 * 
 * This file demonstrates how to migrate all existing event producers identified
 * in the reconnaissance to use the transactional outbox pattern.
 */

import type { Knex } from "knex";
import { OutboxProducer } from "./eventProducer.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

// Example 1: Alert Service Migration
// BEFORE: Direct webhook dispatch (non-transactional)
export class LegacyAlertService {
  async dispatchWebhook(url: string, event: any, rule: any): Promise<void> {
    const payload = {
      ruleId: rule.id,
      ruleName: rule.name,
      assetCode: event.assetCode,
      alertType: event.alertType,
      priority: event.priority,
      metric: event.metric,
      triggeredValue: event.triggeredValue,
      threshold: event.threshold,
      timestamp: event.time.toISOString(),
    };

    // PROBLEM: Direct HTTP call - not transactional, no retry logic
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Webhook responded ${response.status}`);
    }
  }
}

// AFTER: Outbox-integrated alert service
export class OutboxAlertServiceExample {
  constructor(
    private db: Knex,
    private outboxProducer: OutboxProducer
  ) {}

  async evaluateAssetWithOutbox(snapshot: any): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Business logic: persist alert event
      const [alertEvent] = await tx("alert_events").insert({
        rule_id: "rule-123",
        asset_code: snapshot.assetCode,
        alert_type: "price_deviation",
        priority: "high",
        triggered_value: snapshot.price,
        threshold: 1.02,
        metric: "price",
        time: new Date(),
      }).returning("*");

      // Outbox: publish alert event transactionally
      await this.outboxProducer.publishTransactional(tx, {
        aggregateType: "Alert",
        aggregateId: alertEvent.rule_id,
        eventType: "alert.triggered",
        payload: {
          ruleId: alertEvent.rule_id,
          assetCode: alertEvent.asset_code,
          alertType: alertEvent.alert_type,
          priority: alertEvent.priority,
          triggeredValue: alertEvent.triggered_value,
          threshold: alertEvent.threshold,
          timestamp: alertEvent.time.toISOString(),
        },
        metadata: {
          traceId: `alert-${alertEvent.rule_id}-${Date.now()}`,
          source: "alert-service",
        },
      });

      // If webhook URL configured, publish webhook delivery event
      const [rule] = await tx("alert_rules")
        .select("webhook_url")
        .where({ id: alertEvent.rule_id });

      if (rule?.webhook_url) {
        await this.outboxProducer.publishTransactional(tx, {
          aggregateType: "Webhook",
          aggregateId: `${alertEvent.rule_id}-${Date.now()}`,
          eventType: "webhook.delivery",
          payload: {
            url: rule.webhook_url,
            eventType: "alert.triggered",
            payload: {
              ruleId: alertEvent.rule_id,
              assetCode: alertEvent.asset_code,
              alertType: alertEvent.alert_type,
              priority: alertEvent.priority,
              triggeredValue: alertEvent.triggered_value,
              threshold: alertEvent.threshold,
              timestamp: alertEvent.time.toISOString(),
            },
          },
          metadata: {
            traceId: `webhook-${alertEvent.rule_id}-${Date.now()}`,
            source: "alert-service",
          },
        });
      }
    });
  }
}

// Example 2: Incident Service Migration
// BEFORE: Direct database insert without events
export class LegacyIncidentService {
  async createIncident(incidentData: any): Promise<void> {
    const db = this.getDatabase();
    
    // PROBLEM: No event emission, external systems not notified
    await db("bridge_incidents").insert({
      bridge_id: incidentData.bridgeId,
      severity: incidentData.severity,
      description: incidentData.description,
      status: "open",
      created_at: new Date(),
    });
  }

  private getDatabase(): Knex {
    // Implementation
    return {} as Knex;
  }
}

// AFTER: Outbox-integrated incident service
export class OutboxIncidentServiceExample {
  constructor(
    private db: Knex,
    private outboxProducer: OutboxProducer
  ) {}

  async createIncident(incidentData: {
    bridgeId: string;
    severity: "critical" | "high" | "medium" | "low";
    description: string;
    metadata?: any;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Business logic: create incident
      const [incident] = await tx("bridge_incidents").insert({
        bridge_id: incidentData.bridgeId,
        severity: incidentData.severity,
        description: incidentData.description,
        status: "open",
        metadata: JSON.stringify(incidentData.metadata || {}),
        created_at: new Date(),
      }).returning("*");

      // Outbox: publish incident created event
      await this.outboxProducer.publishTransactional(tx, {
        aggregateType: "Incident",
        aggregateId: incident.id,
        eventType: "incident.created",
        payload: {
          incidentId: incident.id,
          bridgeId: incident.bridge_id,
          severity: incident.severity,
          description: incident.description,
          status: incident.status,
          metadata: incidentData.metadata,
          createdAt: incident.created_at.toISOString(),
        },
        metadata: {
          traceId: `incident-${incident.id}`,
          source: "incident-service",
        },
      });

      // For critical incidents, also publish alert
      if (incidentData.severity === "critical") {
        await this.outboxProducer.publishTransactional(tx, {
          aggregateType: "Alert",
          aggregateId: `incident-alert-${incident.id}`,
          eventType: "alert.triggered",
          payload: {
            alertType: "bridge_incident",
            priority: "critical",
            assetCode: "ALL", // Bridge-wide incident
            bridgeId: incidentData.bridgeId,
            incidentId: incident.id,
            description: `Critical incident: ${incidentData.description}`,
            timestamp: incident.created_at.toISOString(),
          },
          metadata: {
            traceId: `incident-alert-${incident.id}`,
            source: "incident-service",
            triggeredBy: "incident.created",
          },
        });
      }
    });
  }
}

// Example 3: Admin Rotation Service Migration
// BEFORE: Direct database insert with separate event logging
export class LegacyAdminRotationService {
  async addAdmin(actorId: string, targetId: string, role: string): Promise<void> {
    const db = this.getDatabase();
    
    // PROBLEM: Two separate operations, not atomic
    await db("admin_users").insert({
      user_id: targetId,
      role,
      added_by: actorId,
      added_at: new Date(),
    });

    // Separate event logging - could fail independently
    await db("admin_rotation_events").insert({
      action: "added",
      actor_id: actorId,
      target_id: targetId,
      metadata: JSON.stringify({ role }),
      created_at: new Date(),
    });
  }

  private getDatabase(): Knex {
    return {} as Knex;
  }
}

// AFTER: Outbox-integrated admin rotation service
export class OutboxAdminRotationServiceExample {
  constructor(
    private db: Knex,
    private outboxProducer: OutboxProducer
  ) {}

  async addAdmin(actorId: string, targetId: string, role: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Business logic: add admin user
      await tx("admin_users").insert({
        user_id: targetId,
        role,
        added_by: actorId,
        added_at: new Date(),
      });

      // Audit log: record rotation event
      await tx("admin_rotation_events").insert({
        action: "added",
        actor_id: actorId,
        target_id: targetId,
        metadata: JSON.stringify({ role }),
        created_at: new Date(),
      });

      // Outbox: publish admin rotation event
      await this.outboxProducer.publishTransactional(tx, {
        aggregateType: "Admin",
        aggregateId: targetId,
        eventType: "admin.rotation",
        payload: {
          action: "added",
          actorId,
          targetId,
          role,
          timestamp: new Date().toISOString(),
        },
        metadata: {
          traceId: `admin-rotation-${targetId}-${Date.now()}`,
          source: "admin-rotation-service",
        },
      });

      // For sensitive roles, also trigger security alert
      if (role === "super_admin" || role === "security_admin") {
        await this.outboxProducer.publishTransactional(tx, {
          aggregateType: "Security",
          aggregateId: `security-event-${Date.now()}`,
          eventType: "security.admin_added" as any,
          payload: {
            eventType: "privileged_admin_added",
            actorId,
            targetId,
            role,
            severity: "high",
            timestamp: new Date().toISOString(),
          },
          metadata: {
            traceId: `security-admin-${targetId}-${Date.now()}`,
            source: "admin-rotation-service",
            securityLevel: "high",
          },
        });
      }
    });
  }
}

// Example 4: Discord Service Migration
// BEFORE: Direct Discord API call
export class LegacyDiscordService {
  async sendAlertEmbed(channelId: string, embed: any, alertData: any): Promise<void> {
    // PROBLEM: Direct API call, no retry logic, not transactional
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${config.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }
  }
}

// AFTER: Outbox-integrated Discord service
export class OutboxDiscordServiceExample {
  constructor(
    private db: Knex,
    private outboxProducer: OutboxProducer
  ) {}

  async sendAlertEmbedWithOutbox(
    channelId: string,
    embed: any,
    alertData: any,
    tx?: Knex.Transaction
  ): Promise<void> {
    const executeInTransaction = async (transaction: Knex.Transaction) => {
      // Outbox: publish Discord message event
      await this.outboxProducer.publishTransactional(transaction, {
        aggregateType: "Discord",
        aggregateId: `${channelId}-${Date.now()}`,
        eventType: "discord.alert",
        payload: {
          channelId,
          embed,
          alertData,
          messageType: "alert_embed",
        },
        metadata: {
          traceId: `discord-${alertData.ruleId || "unknown"}-${Date.now()}`,
          source: "discord-service",
        },
      });
    };

    if (tx) {
      // Use existing transaction
      await executeInTransaction(tx);
    } else {
      // Create new transaction
      await this.db.transaction(executeInTransaction);
    }
  }
}

// Example 5: Digest Scheduler Migration
// BEFORE: Direct BullMQ job scheduling
export class LegacyDigestSchedulerService {
  async scheduleDigest(userId: string, digestType: string, timezone: string): Promise<void> {
    const { Queue } = await import("bullmq");
    
    // PROBLEM: Direct queue scheduling, not transactional with user preferences
    const digestQueue = new Queue("digest-delivery");
    
    await digestQueue.add("send-digest", {
      userId,
      digestType,
      timezone,
      scheduledAt: new Date().toISOString(),
    });
  }
}

// AFTER: Outbox-integrated digest scheduler
export class OutboxDigestSchedulerServiceExample {
  constructor(
    private db: Knex,
    private outboxProducer: OutboxProducer
  ) {}

  async scheduleDigest(
    userId: string,
    digestType: "daily" | "weekly",
    timezone: string,
    preferences?: any
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Business logic: update user digest preferences if provided
      if (preferences) {
        await tx("user_preferences")
          .where({ user_id: userId })
          .update({
            digest_preferences: JSON.stringify(preferences),
            updated_at: new Date(),
          });
      }

      // Outbox: publish digest scheduled event
      await this.outboxProducer.publishTransactional(tx, {
        aggregateType: "User",
        aggregateId: userId,
        eventType: "digest.scheduled",
        payload: {
          userId,
          digestType,
          timezone,
          preferences,
          scheduledAt: new Date().toISOString(),
        },
        metadata: {
          traceId: `digest-${userId}-${digestType}-${Date.now()}`,
          source: "digest-scheduler-service",
        },
      });
    });
  }
}

// Example 6: WebSocket Event Broadcasting Migration
// BEFORE: Direct WebSocket broadcast
export class LegacyWebSocketService {
  async broadcastTransactionUpdate(transactionId: string, status: string, blockHeight: number): Promise<void> {
    // PROBLEM: Direct broadcast, no persistence, clients may miss updates
    const wsServer = this.getWebSocketServer();
    
    wsServer.broadcast("transaction_update", {
      transactionId,
      status,
      blockHeight,
      timestamp: new Date().toISOString(),
    });
  }

  private getWebSocketServer(): any {
    return {
      broadcast: (event: string, data: any) => {
        // WebSocket broadcast implementation
      }
    };
  }
}

// AFTER: Outbox-integrated WebSocket service (with persistence)
export class OutboxWebSocketServiceExample {
  constructor(
    private db: Knex,
    private outboxProducer: OutboxProducer
  ) {}

  async broadcastTransactionUpdateWithOutbox(
    transactionId: string,
    status: string,
    blockHeight: number,
    tx?: Knex.Transaction
  ): Promise<void> {
    const executeInTransaction = async (transaction: Knex.Transaction) => {
      // Business logic: persist transaction update
      await transaction("bridge_transactions")
        .where({ id: transactionId })
        .update({
          status,
          block_height: blockHeight,
          updated_at: new Date(),
        });

      // Outbox: publish transaction update event
      await this.outboxProducer.publishTransactional(transaction, {
        aggregateType: "Transaction",
        aggregateId: transactionId,
        eventType: "transaction.update",
        payload: {
          transactionId,
          status,
          blockHeight,
          timestamp: new Date().toISOString(),
        },
        metadata: {
          traceId: `transaction-${transactionId}`,
          source: "websocket-service",
          broadcast: true, // Flag for immediate WebSocket dispatch
        },
      });
    };

    if (tx) {
      await executeInTransaction(tx);
    } else {
      await this.db.transaction(executeInTransaction);
    }
  }
}

// Migration Utility Functions
export class OutboxMigrationUtils {
  static async migrateExistingEvents(
    db: Knex,
    outboxProducer: OutboxProducer,
    tableName: string,
    eventMapping: {
      aggregateType: string;
      aggregateIdColumn: string;
      eventType: string;
      payloadMapper: (row: any) => any;
    }
  ): Promise<void> {
    logger.info(`Starting migration of existing events from ${tableName}`);

    const batchSize = 1000;
    let offset = 0;
    let processedCount = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = await db(tableName)
        .select("*")
        .orderBy("created_at", "asc")
        .limit(batchSize)
        .offset(offset);

      if (rows.length === 0) {
        break;
      }

      await db.transaction(async (tx) => {
        for (const row of rows) {
          await outboxProducer.publishTransactional(tx, {
            aggregateType: eventMapping.aggregateType,
            aggregateId: row[eventMapping.aggregateIdColumn],
            eventType: eventMapping.eventType as any,
            payload: eventMapping.payloadMapper(row),
            metadata: {
              migratedFrom: tableName,
              originalCreatedAt: row.created_at,
              migrationTimestamp: new Date().toISOString(),
            },
          });
        }
      });

      processedCount += rows.length;
      offset += batchSize;

      logger.info(`Migrated ${processedCount} events from ${tableName}`);
    }

    logger.info(`Completed migration of ${processedCount} events from ${tableName}`);
  }

  static async validateMigration(
    db: Knex,
    tableName: string,
    eventType: string
  ): Promise<{
    originalCount: number;
    migratedCount: number;
    isComplete: boolean;
  }> {
    const [originalResult] = await db(tableName).count("* as count");
    const originalCount = parseInt(originalResult.count as string);

    const [migratedResult] = await db("outbox_events")
      .where("event_type", eventType)
      .where("metadata", "like", `%"migratedFrom":"${tableName}"%`)
      .count("* as count");
    const migratedCount = parseInt(migratedResult.count as string);

    return {
      originalCount,
      migratedCount,
      isComplete: originalCount === migratedCount,
    };
  }
}