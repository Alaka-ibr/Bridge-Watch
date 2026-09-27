export type SubscriptionStatus = "active" | "paused" | "disabled" | "errored";
export type DeliveryTargetType = "webhook" | "websocket" | "queue" | "kafka" | "alert";

export interface DeliveryConfig {
  webhookUrl?: string;
  secretHeader?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  queueName?: string;
  topic?: string;
}

export interface FilterRule {
  field: string;
  operator: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "in" | "contains" | "exists";
  value: any;
}

export interface FilterRulesGroup {
  operator?: "AND" | "OR";
  rules?: FilterRule[];
  minAmount?: string;
  maxAmount?: string;
  senderAddress?: string;
  receiverAddress?: string;
  assetCode?: string;
}

export interface ContractEventSubscription {
  id: string;
  name: string;
  description?: string | null;
  contract_address: string;
  network: string;
  event_topics: string[];
  filter_rules: FilterRulesGroup;
  delivery_target: DeliveryTargetType;
  delivery_config: DeliveryConfig;
  status: SubscriptionStatus;
  rate_limit_per_min: number;
  retry_limit: number;
  batch_size: number;
  delivered_count: number;
  failed_count: number;
  last_delivered_at?: string | null;
  last_failure_reason?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContractEventDeliveryLog {
  id: string;
  subscription_id: string;
  event_id: string;
  contract_address: string;
  topic: string;
  payload: Record<string, any>;
  delivery_status: "delivered" | "retrying" | "failed" | "filtered";
  status_code?: number | null;
  latency_ms?: number | null;
  error_message?: string | null;
  attempt: number;
  created_at: string;
}

export interface CreateSubscriptionInput {
  name: string;
  description?: string;
  contract_address: string;
  network?: string;
  event_topics: string[];
  filter_rules?: FilterRulesGroup;
  delivery_target: DeliveryTargetType;
  delivery_config?: DeliveryConfig;
  rate_limit_per_min?: number;
  retry_limit?: number;
  batch_size?: number;
  created_by?: string;
}

export interface UpdateSubscriptionInput {
  name?: string;
  description?: string;
  contract_address?: string;
  network?: string;
  event_topics?: string[];
  filter_rules?: FilterRulesGroup;
  delivery_target?: DeliveryTargetType;
  delivery_config?: DeliveryConfig;
  status?: SubscriptionStatus;
  rate_limit_per_min?: number;
  retry_limit?: number;
  batch_size?: number;
}

export interface IncomingContractEvent {
  id: string;
  contract_address: string;
  network: string;
  topic: string;
  data: Record<string, any>;
  ledger_sequence?: number;
  tx_hash?: string;
  timestamp?: string;
}

export interface SubscriptionStats {
  totalSubscriptions: number;
  activeSubscriptions: number;
  pausedSubscriptions: number;
  erroredSubscriptions: number;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  averageLatencyMs: number;
}
