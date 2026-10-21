# Secret Provider Health Checks

## Overview

Bridge-Watch interacts with multiple external secret management systems (HashiCorp Vault, AWS Secrets Manager, Google Cloud Secret Manager, Azure Key Vault, Kubernetes Secrets, and Environment configurations) to manage critical bridge signing keys, RPC credentials, and webhook secrets.

The **Secret Provider Health Checks** subsystem continuously validates reachability, token/IAM lease validity, read permissions, TLS certificates, and latency across providers. If a primary provider degrades or fails, the subsystem triggers automated zero-downtime failover to secondary hot-standby providers.

---

## Architecture & Health Probes

### 1. Probe Criteria
Each scheduled and on-demand health probe verifies four dimensions:
1. **Network Connectivity & TCP Handshake**: Latency and socket connection to the provider's endpoint.
2. **Authentication Lease & IAM Status**: Confirms that client tokens or assumed IAM roles have not expired.
3. **Read Permission Capability**: Verifies that the provider can decrypt and return test namespaces without permission denial (`403 Forbidden`).
4. **TLS Certificate Expiration**: Tracks certificate validity and issues alerts 30 days prior to expiry.

### 2. Error Classifications
- `CONNECTION_REFUSED`: Target endpoint unreachable or DNS resolution failure.
- `AUTH_EXPIRED`: Client token lease has expired or IAM role was revoked.
- `PERMISSION_DENIED`: Lacks sufficient read/decrypt capabilities.
- `RATE_LIMITED`: Provider HTTP 429 quota exhaustion.
- `TLS_EXPIRED`: Invalid or expired TLS certificate.

### 3. Automated Failover Mechanism
When the `is_primary` secret provider accumulates `consecutive_failures >= 2`:
1. The provider status transitions from `healthy` to `unhealthy`.
2. Traffic resolution automatically switches to `fallback_provider_id`.
3. An active failover signal is emitted to the UI and Prometheus alerts.
4. Background health probes continue pinging the primary provider and automatically fail back once 3 consecutive successful health probes occur.

---

## API Surface

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/secret-providers` | List all registered secret providers and live health |
| `GET` | `/api/v1/secret-providers/summary` | Cluster-wide secret provider health summary and failover state |
| `GET` | `/api/v1/secret-providers/:id` | Provider configuration & details |
| `POST` | `/api/v1/secret-providers` | Register a new external secret provider |
| `PUT` | `/api/v1/secret-providers/:id` | Update secret provider configuration |
| `DELETE` | `/api/v1/secret-providers/:id` | Deregister a provider |
| `POST` | `/api/v1/secret-providers/:id/check` | Trigger immediate health probe on a specific provider |
| `POST` | `/api/v1/secret-providers/check-all` | Run batch health checks across all registered providers |
| `GET` | `/api/v1/secret-providers/:id/history` | Query historical probe logs and latency benchmarks |

---

## Operator Runbook

- **Admin UI**: Accessible under `/admin/secret-provider-health`.
- **Manual Probe**: Click **Run Global Health Probe** or test individual provider cards.
- **Failover Resolution**: Once primary provider issues are resolved upstream, trigger a probe to restore primary status.
