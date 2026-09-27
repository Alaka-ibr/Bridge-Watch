# Contract Event Subscription Registry

## Overview

The **Contract Event Subscription Registry** allows operators, downstream monitoring microservices, and external integrations to subscribe to real-time smart contract events emitted on the Stellar network (Soroban smart contracts) and cross-chain bridge contracts.

Subscribers can define fine-grained event filtering conditions, select delivery targets (Webhooks, WebSockets, Message Queues, Kafka), configure retry and rate-limiting policies, and perform dry-run rule simulations.

---

## Data Model

### `contract_event_subscriptions`

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `VARCHAR` (PK) | Unique subscription identifier (`sub_<uuid>`) |
| `name` | `VARCHAR` | Human-readable subscription name |
| `description` | `TEXT` | Optional description of subscription intent |
| `contract_address` | `VARCHAR` | Target Stellar/Soroban contract ID or EVM bridge address |
| `network` | `VARCHAR` | Network (`stellar-mainnet`, `stellar-testnet`) |
| `event_topics` | `TEXT[]` | List of event topics to capture (`deposit`, `mint`, `burn`, `*`) |
| `filter_rules` | `JSONB` | Structured rule conditions (AND/OR, field comparisons) |
| `delivery_target` | `VARCHAR` | Delivery channel: `webhook`, `websocket`, `queue`, `kafka`, `alert` |
| `delivery_config` | `JSONB` | Destination config (e.g. `webhookUrl`, auth headers) |
| `status` | `VARCHAR` | Current lifecycle state: `active`, `paused`, `disabled`, `errored` |
| `rate_limit_per_min` | `INTEGER` | Maximum dispatches allowed per minute (default: 60) |
| `retry_limit` | `INTEGER` | Maximum delivery retry attempts (default: 3) |
| `batch_size` | `INTEGER` | Delivery batching size (default: 1) |
| `delivered_count` | `INTEGER` | Cumulative successful event deliveries |
| `failed_count` | `INTEGER` | Cumulative delivery failures |
| `last_delivered_at` | `TIMESTAMP` | Timestamp of last successful dispatch |
| `last_failure_reason` | `TEXT` | Error message from last failed delivery attempt |
| `created_at` / `updated_at` | `TIMESTAMP` | Record creation and modification timestamps |

### `contract_event_delivery_logs`

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `VARCHAR` (PK) | Delivery log identifier (`del_<uuid>`) |
| `subscription_id` | `VARCHAR` | Foreign key referencing subscription |
| `event_id` | `VARCHAR` | Ledger event identifier or transaction hash |
| `contract_address` | `VARCHAR` | Contract address |
| `topic` | `VARCHAR` | Event topic |
| `payload` | `JSONB` | Event payload transmitted |
| `delivery_status` | `VARCHAR` | `delivered`, `retrying`, `failed`, `filtered` |
| `status_code` | `INTEGER` | HTTP response code or target ack code |
| `latency_ms` | `INTEGER` | Dispatch latency in milliseconds |
| `error_message` | `TEXT` | Failure error message if applicable |
| `attempt` | `INTEGER` | Attempt number (1 to `retry_limit`) |
| `created_at` | `TIMESTAMP` | Dispatch log timestamp |

---

## API Surface

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/contract-subscriptions` | List subscriptions with filters (`network`, `status`, `contract_address`, `search`) |
| `POST` | `/api/v1/contract-subscriptions` | Register a new contract event subscription |
| `GET` | `/api/v1/contract-subscriptions/stats/summary` | Aggregate subscription and delivery metrics |
| `GET` | `/api/v1/contract-subscriptions/:id` | Get single subscription details |
| `PUT` | `/api/v1/contract-subscriptions/:id` | Update subscription configuration |
| `DELETE` | `/api/v1/contract-subscriptions/:id` | Remove subscription |
| `POST` | `/api/v1/contract-subscriptions/:id/pause` | Pause event delivery |
| `POST` | `/api/v1/contract-subscriptions/:id/resume` | Resume event delivery |
| `POST` | `/api/v1/contract-subscriptions/:id/test-event` | Dry-run evaluate incoming event against subscription filters |
| `GET` | `/api/v1/contract-subscriptions/:id/deliveries` | Query delivery logs for subscription |

---

## Filter Evaluation Engine

Filter rules support recursive structured criteria:
- **Operators**: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, `exists`.
- **Logical Groups**: `AND` / `OR`.
- **Nested JSONPath fields**: e.g., `data.amount`, `data.sender`, `data.assetCode`.

```json
{
  "operator": "AND",
  "rules": [
    { "field": "amount", "operator": "gte", "value": 10000 },
    { "field": "asset", "operator": "eq", "value": "USDC" }
  ]
}
```

---

## Rollout & Rollback Plan

### Rollout
1. Apply database migration `20260927000001_contract_event_subscription_registry.ts`.
2. Deploy backend service and verify route registration via `GET /api/v1/contract-subscriptions/stats/summary`.
3. Deploy frontend bundle containing the Contract Event Subscriptions page under `/contract-subscriptions`.

### Rollback
1. Revert deployment binary to previous release.
2. If necessary, execute migration down: `knex migrate:rollback`.
