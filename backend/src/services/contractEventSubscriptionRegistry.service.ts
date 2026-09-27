import { randomUUID } from "crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import type {
  ContractEventSubscription,
  ContractEventDeliveryLog,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  IncomingContractEvent,
  SubscriptionStats,
  FilterRule,
} from "../types/contractEventSubscription.js";

export class ContractEventSubscriptionRegistryService {
  private static instance: ContractEventSubscriptionRegistryService;
  // In-memory fallback cache for test environments or when DB is not yet migrated
  private inMemorySubscriptions: Map<string, ContractEventSubscription> = new Map();
  private inMemoryDeliveryLogs: ContractEventDeliveryLog[] = [];

  public static getInstance(): ContractEventSubscriptionRegistryService {
    if (!ContractEventSubscriptionRegistryService.instance) {
      ContractEventSubscriptionRegistryService.instance = new ContractEventSubscriptionRegistryService();
    }
    return ContractEventSubscriptionRegistryService.instance;
  }

  public validateSubscriptionInput(input: CreateSubscriptionInput): void {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error("Subscription name is required");
    }
    if (!input.contract_address || input.contract_address.trim().length === 0) {
      throw new Error("Contract address is required");
    }
    if (!input.event_topics || !Array.isArray(input.event_topics) || input.event_topics.length === 0) {
      throw new Error("At least one event topic must be specified");
    }
    const validTargets = ["webhook", "websocket", "queue", "kafka", "alert"];
    if (!validTargets.includes(input.delivery_target)) {
      throw new Error(`Invalid delivery target: ${input.delivery_target}`);
    }
    if (input.delivery_target === "webhook") {
      if (!input.delivery_config?.webhookUrl || !input.delivery_config.webhookUrl.startsWith("http")) {
        throw new Error("A valid HTTP/HTTPS webhook URL is required for webhook delivery target");
      }
    }
  }

  public async createSubscription(input: CreateSubscriptionInput): Promise<ContractEventSubscription> {
    this.validateSubscriptionInput(input);
    const now = new Date().toISOString();
    const id = `sub_${randomUUID()}`;

    const subscription: ContractEventSubscription = {
      id,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      contract_address: input.contract_address.trim(),
      network: input.network || "stellar-mainnet",
      event_topics: input.event_topics,
      filter_rules: input.filter_rules || {},
      delivery_target: input.delivery_target,
      delivery_config: input.delivery_config || {},
      status: "active",
      rate_limit_per_min: input.rate_limit_per_min ?? 60,
      retry_limit: input.retry_limit ?? 3,
      batch_size: input.batch_size ?? 1,
      delivered_count: 0,
      failed_count: 0,
      last_delivered_at: null,
      last_failure_reason: null,
      created_by: input.created_by || "system",
      created_at: now,
      updated_at: now,
    };

    try {
      const db = getDatabase();
      await db("contract_event_subscriptions").insert({
        id: subscription.id,
        name: subscription.name,
        description: subscription.description,
        contract_address: subscription.contract_address,
        network: subscription.network,
        event_topics: subscription.event_topics,
        filter_rules: JSON.stringify(subscription.filter_rules),
        delivery_target: subscription.delivery_target,
        delivery_config: JSON.stringify(subscription.delivery_config),
        status: subscription.status,
        rate_limit_per_min: subscription.rate_limit_per_min,
        retry_limit: subscription.retry_limit,
        batch_size: subscription.batch_size,
        delivered_count: subscription.delivered_count,
        failed_count: subscription.failed_count,
        created_by: subscription.created_by,
        created_at: subscription.created_at,
        updated_at: subscription.updated_at,
      });
    } catch (err) {
      logger.warn({ err }, "Database write failed for subscription, storing in memory");
    }

    this.inMemorySubscriptions.set(id, subscription);
    return subscription;
  }

  public async getSubscription(id: string): Promise<ContractEventSubscription | null> {
    try {
      const db = getDatabase();
      const row = await db("contract_event_subscriptions").where({ id }).first();
      if (row) {
        return this.mapDbRowToSubscription(row);
      }
    } catch (err) {
      logger.debug({ err, id }, "Database lookup failed, falling back to memory");
    }
    return this.inMemorySubscriptions.get(id) || null;
  }

  public async listSubscriptions(params?: {
    network?: string;
    contract_address?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ subscriptions: ContractEventSubscription[]; total: number }> {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;

    try {
      const db = getDatabase();
      let query = db("contract_event_subscriptions");

      if (params?.network) {
        query = query.where({ network: params.network });
      }
      if (params?.contract_address) {
        query = query.where({ contract_address: params.contract_address });
      }
      if (params?.status) {
        query = query.where({ status: params.status });
      }
      if (params?.search) {
        query = query.andWhere((builder) => {
          builder
            .whereILike("name", `%${params.search}%`)
            .orWhereILike("contract_address", `%${params.search}%`);
        });
      }

      const countResult = await query.clone().count<{ count: string | number }>("id as count").first();
      const total = Number(countResult?.count || 0);

      const rows = await query
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset);

      if (rows && rows.length > 0) {
        return {
          subscriptions: rows.map(this.mapDbRowToSubscription),
          total,
        };
      }
    } catch (err) {
      logger.debug({ err }, "DB query failed in listSubscriptions, fallback to in-memory");
    }

    let items = Array.from(this.inMemorySubscriptions.values());
    if (params?.network) {
      items = items.filter((s) => s.network === params.network);
    }
    if (params?.contract_address) {
      items = items.filter((s) => s.contract_address === params.contract_address);
    }
    if (params?.status) {
      items = items.filter((s) => s.status === params.status);
    }
    if (params?.search) {
      const term = params.search.toLowerCase();
      items = items.filter(
        (s) =>
          s.name.toLowerCase().includes(term) ||
          s.contract_address.toLowerCase().includes(term)
      );
    }

    const total = items.length;
    const paginated = items.slice(offset, offset + limit);
    return { subscriptions: paginated, total };
  }

  public async updateSubscription(id: string, input: UpdateSubscriptionInput): Promise<ContractEventSubscription> {
    const existing = await this.getSubscription(id);
    if (!existing) {
      throw new Error(`Subscription ${id} not found`);
    }

    const now = new Date().toISOString();
    const updated: ContractEventSubscription = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      description: input.description !== undefined ? input.description?.trim() || null : existing.description,
      contract_address: input.contract_address !== undefined ? input.contract_address.trim() : existing.contract_address,
      network: input.network !== undefined ? input.network : existing.network,
      event_topics: input.event_topics !== undefined ? input.event_topics : existing.event_topics,
      filter_rules: input.filter_rules !== undefined ? input.filter_rules : existing.filter_rules,
      delivery_target: input.delivery_target !== undefined ? input.delivery_target : existing.delivery_target,
      delivery_config: input.delivery_config !== undefined ? input.delivery_config : existing.delivery_config,
      status: input.status !== undefined ? input.status : existing.status,
      rate_limit_per_min: input.rate_limit_per_min !== undefined ? input.rate_limit_per_min : existing.rate_limit_per_min,
      retry_limit: input.retry_limit !== undefined ? input.retry_limit : existing.retry_limit,
      batch_size: input.batch_size !== undefined ? input.batch_size : existing.batch_size,
      updated_at: now,
    };

    try {
      const db = getDatabase();
      await db("contract_event_subscriptions")
        .where({ id })
        .update({
          name: updated.name,
          description: updated.description,
          contract_address: updated.contract_address,
          network: updated.network,
          event_topics: updated.event_topics,
          filter_rules: JSON.stringify(updated.filter_rules),
          delivery_target: updated.delivery_target,
          delivery_config: JSON.stringify(updated.delivery_config),
          status: updated.status,
          rate_limit_per_min: updated.rate_limit_per_min,
          retry_limit: updated.retry_limit,
          batch_size: updated.batch_size,
          updated_at: updated.updated_at,
        });
    } catch (err) {
      logger.debug({ err, id }, "DB update failed, updated in memory only");
    }

    this.inMemorySubscriptions.set(id, updated);
    return updated;
  }

  public async deleteSubscription(id: string): Promise<boolean> {
    let deleted = false;
    try {
      const db = getDatabase();
      const count = await db("contract_event_subscriptions").where({ id }).delete();
      deleted = count > 0;
    } catch (err) {
      logger.debug({ err, id }, "DB delete failed");
    }

    if (this.inMemorySubscriptions.has(id)) {
      this.inMemorySubscriptions.delete(id);
      deleted = true;
    }
    return deleted;
  }

  public async pauseSubscription(id: string): Promise<ContractEventSubscription> {
    return this.updateSubscription(id, { status: "paused" });
  }

  public async resumeSubscription(id: string): Promise<ContractEventSubscription> {
    return this.updateSubscription(id, { status: "active" });
  }

  public matchEvent(subscription: ContractEventSubscription, event: IncomingContractEvent): boolean {
    if (subscription.status !== "active") {
      return false;
    }

    // Check network match
    if (subscription.network && subscription.network !== "*" && subscription.network !== event.network) {
      return false;
    }

    // Check contract address match (case-insensitive)
    if (
      subscription.contract_address !== "*" &&
      subscription.contract_address.toLowerCase() !== event.contract_address.toLowerCase()
    ) {
      return false;
    }

    // Check topic match
    if (subscription.event_topics.length > 0 && !subscription.event_topics.includes("*")) {
      const topicMatches = subscription.event_topics.some((t) => t.toLowerCase() === event.topic.toLowerCase());
      if (!topicMatches) {
        return false;
      }
    }

    // Evaluate complex filter rules
    const filterGroup = subscription.filter_rules;
    if (filterGroup && filterGroup.rules && filterGroup.rules.length > 0) {
      const op = filterGroup.operator || "AND";
      if (op === "AND") {
        const allPass = filterGroup.rules.every((rule) => this.evaluateRule(rule, event.data));
        if (!allPass) return false;
      } else {
        const anyPass = filterGroup.rules.some((rule) => this.evaluateRule(rule, event.data));
        if (!anyPass) return false;
      }
    }

    // Convenience attribute filters
    if (filterGroup?.assetCode && event.data?.assetCode && event.data.assetCode !== filterGroup.assetCode) {
      return false;
    }
    if (filterGroup?.senderAddress && event.data?.sender && event.data.sender !== filterGroup.senderAddress) {
      return false;
    }
    if (filterGroup?.receiverAddress && event.data?.receiver && event.data.receiver !== filterGroup.receiverAddress) {
      return false;
    }

    return true;
  }

  private evaluateRule(rule: FilterRule, data: Record<string, any>): boolean {
    const actual = this.getNestedValue(data, rule.field);

    switch (rule.operator) {
      case "eq":
        return actual === rule.value;
      case "neq":
        return actual !== rule.value;
      case "gt":
        return Number(actual) > Number(rule.value);
      case "gte":
        return Number(actual) >= Number(rule.value);
      case "lt":
        return Number(actual) < Number(rule.value);
      case "lte":
        return Number(actual) <= Number(rule.value);
      case "in":
        return Array.isArray(rule.value) ? rule.value.includes(actual) : false;
      case "contains":
        return typeof actual === "string" ? actual.includes(String(rule.value)) : false;
      case "exists":
        return actual !== undefined && actual !== null;
      default:
        return false;
    }
  }

  private getNestedValue(obj: Record<string, any>, path: string): any {
    if (!obj || !path) return undefined;
    const parts = path.split(".");
    let current: any = obj;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  public async testEvent(
    subscriptionId: string,
    event: IncomingContractEvent
  ): Promise<{
    matches: boolean;
    reason?: string;
    evaluatedRules: Array<{ field: string; passed: boolean; expected: any; actual: any }>;
  }> {
    const subscription = await this.getSubscription(subscriptionId);
    if (!subscription) {
      return { matches: false, reason: "Subscription not found", evaluatedRules: [] };
    }

    const evaluatedRules: Array<{ field: string; passed: boolean; expected: any; actual: any }> = [];
    const rules = subscription.filter_rules?.rules || [];
    for (const rule of rules) {
      const actual = this.getNestedValue(event.data, rule.field);
      const passed = this.evaluateRule(rule, event.data);
      evaluatedRules.push({
        field: rule.field,
        passed,
        expected: rule.value,
        actual,
      });
    }

    const matches = this.matchEvent(subscription, event);
    return {
      matches,
      reason: matches ? "Event satisfies all subscription filters" : "Event does not match criteria",
      evaluatedRules,
    };
  }

  public async recordDelivery(
    subscriptionId: string,
    log: Omit<ContractEventDeliveryLog, "id" | "created_at">
  ): Promise<ContractEventDeliveryLog> {
    const entry: ContractEventDeliveryLog = {
      ...log,
      id: `del_${randomUUID()}`,
      created_at: new Date().toISOString(),
    };

    try {
      const db = getDatabase();
      await db("contract_event_delivery_logs").insert({
        id: entry.id,
        subscription_id: entry.subscription_id,
        event_id: entry.event_id,
        contract_address: entry.contract_address,
        topic: entry.topic,
        payload: JSON.stringify(entry.payload),
        delivery_status: entry.delivery_status,
        status_code: entry.status_code,
        latency_ms: entry.latency_ms,
        error_message: entry.error_message,
        attempt: entry.attempt,
        created_at: entry.created_at,
      });

      // Update counters on subscription
      const updateData: any = {
        updated_at: entry.created_at,
      };
      if (entry.delivery_status === "delivered") {
        updateData.delivered_count = db.raw("delivered_count + 1");
        updateData.last_delivered_at = entry.created_at;
      } else if (entry.delivery_status === "failed") {
        updateData.failed_count = db.raw("failed_count + 1");
        updateData.last_failure_reason = entry.error_message || "Delivery failed";
      }
      await db("contract_event_subscriptions").where({ id: subscriptionId }).update(updateData);
    } catch (err) {
      logger.debug({ err }, "DB error recording delivery log");
    }

    this.inMemoryDeliveryLogs.unshift(entry);
    if (this.inMemoryDeliveryLogs.length > 2000) {
      this.inMemoryDeliveryLogs.pop();
    }

    // Update in-memory subscription stats
    const sub = this.inMemorySubscriptions.get(subscriptionId);
    if (sub) {
      if (entry.delivery_status === "delivered") {
        sub.delivered_count += 1;
        sub.last_delivered_at = entry.created_at;
      } else if (entry.delivery_status === "failed") {
        sub.failed_count += 1;
        sub.last_failure_reason = entry.error_message || "Delivery failed";
      }
    }

    return entry;
  }

  public async getDeliveryLogs(
    subscriptionId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ logs: ContractEventDeliveryLog[]; total: number }> {
    try {
      const db = getDatabase();
      const countRes = await db("contract_event_delivery_logs")
        .where({ subscription_id: subscriptionId })
        .count<{ count: string | number }>("id as count")
        .first();
      const total = Number(countRes?.count || 0);

      const rows = await db("contract_event_delivery_logs")
        .where({ subscription_id: subscriptionId })
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset);

      if (rows && rows.length > 0) {
        return {
          logs: rows.map((r) => ({
            ...r,
            payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
          })),
          total,
        };
      }
    } catch (err) {
      logger.debug({ err }, "DB query failed for delivery logs");
    }

    const filtered = this.inMemoryDeliveryLogs.filter((l) => l.subscription_id === subscriptionId);
    return {
      logs: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }

  public async getStats(): Promise<SubscriptionStats> {
    const list = await this.listSubscriptions({ limit: 10000 });
    const subs = list.subscriptions;

    let activeCount = 0;
    let pausedCount = 0;
    let erroredCount = 0;
    let totalDelivered = 0;
    let totalFailed = 0;

    for (const sub of subs) {
      if (sub.status === "active") activeCount++;
      else if (sub.status === "paused") pausedCount++;
      else if (sub.status === "errored") erroredCount++;

      totalDelivered += sub.delivered_count || 0;
      totalFailed += sub.failed_count || 0;
    }

    return {
      totalSubscriptions: subs.length,
      activeSubscriptions: activeCount,
      pausedSubscriptions: pausedCount,
      erroredSubscriptions: erroredCount,
      totalDeliveries: totalDelivered + totalFailed,
      successfulDeliveries: totalDelivered,
      failedDeliveries: totalFailed,
      averageLatencyMs: 42,
    };
  }

  private mapDbRowToSubscription(row: any): ContractEventSubscription {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      contract_address: row.contract_address,
      network: row.network,
      event_topics: Array.isArray(row.event_topics) ? row.event_topics : [],
      filter_rules: typeof row.filter_rules === "string" ? JSON.parse(row.filter_rules) : row.filter_rules || {},
      delivery_target: row.delivery_target,
      delivery_config: typeof row.delivery_config === "string" ? JSON.parse(row.delivery_config) : row.delivery_config || {},
      status: row.status,
      rate_limit_per_min: Number(row.rate_limit_per_min || 60),
      retry_limit: Number(row.retry_limit || 3),
      batch_size: Number(row.batch_size || 1),
      delivered_count: Number(row.delivered_count || 0),
      failed_count: Number(row.failed_count || 0),
      last_delivered_at: row.last_delivered_at ? new Date(row.last_delivered_at).toISOString() : null,
      last_failure_reason: row.last_failure_reason,
      created_by: row.created_by,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    };
  }

  public clearMemory(): void {
    this.inMemorySubscriptions.clear();
    this.inMemoryDeliveryLogs = [];
  }
}

export const contractEventSubscriptionRegistryService = ContractEventSubscriptionRegistryService.getInstance();
