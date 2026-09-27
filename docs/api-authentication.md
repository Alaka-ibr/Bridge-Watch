# Bridge-Watch API Authentication & Access Control Guide

This guide describes the authentication architecture, permission model, rate limiting tiers, and operational key management workflows for the Stellar Bridge-Watch platform.

---

## Overview

Bridge-Watch supports dual authentication mechanisms:
1. **API Keys (`x-api-key`)**: Cryptographically hashed tokens (`bwk_live_...`) designed for backend integrations, daemon services, cron workers, and automated monitoring pipelines.
2. **OAuth2 / Bearer Tokens (`Authorization: Bearer <jwt>`)**: Short-lived JSON Web Tokens for user sessions and OAuth2 client-credential workflows.

All incoming requests are evaluated by the authentication middleware ([backend/src/api/middleware/auth.ts](file:///Users/user/Documents/Code/Bridge-Watch/backend/src/api/middleware/auth.ts)) prior to route dispatching.

---

## API Key Format & Storage

- **Format**: All generated production API keys use the standard prefix `bwk_live_` followed by a high-entropy 64-character hexadecimal payload:
  ```text
  bwk_live_a1b2c3d4e5f60718293a4b5c6d7e8f90...
  ```
- **Hashing**: Raw API keys are never stored in plaintext. They are salted with a 16-byte random salt and hashed using `scrypt` (N=16384, r=8, p=1, 64-byte key length).
- **Lookup**: Fast lookup uses the key prefix (`bwk_live_` + leading identifier), followed by constant-time verification (`timingSafeEqual`) against candidate hashes to prevent timing attacks.

---

## API Key Creation Flow

API keys are provisioned through the administrative API endpoint `POST /api/v1/api-keys` (requiring `admin:api-keys` scope) or the administrative web console.

### Request Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | string | Yes | - | Human-readable label for the integration (e.g. `indexer-worker-prod`). |
| `scopes` | string[] | No | `["jobs:read", "jobs:trigger"]` | Array of specific capability strings granted to the key. |
| `template` | string | No | - | Pre-configured scope template (e.g. `read-only`, `worker`, `super-admin`). |
| `rateLimitPerMinute` | number | No | `120` | Maximum allowed requests per minute on a sliding window. |
| `expiresInDays` | number | No | `null` (never) | Number of days until the key automatically expires. |
| `enableOAuth` | boolean | No | `false` | Enables client credentials flow with assigned `clientId` and secret. |

### Creation Example (cURL)

```bash
curl -X POST https://api.bridgewatch.stellar.org/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -H "x-api-key: bwk_live_admin_bootstrap_key" \
  -d '{
    "name": "soroban-indexer-service",
    "scopes": ["jobs:read", "jobs:trigger", "events:subscribe", "metrics:read"],
    "rateLimitPerMinute": 300,
    "expiresInDays": 90
  }'
```

### Response Example

> **Warning**: The `rawKey` is only returned once upon creation. Store it in a secure secret manager immediately.

```json
{
  "key": {
    "id": "c6a1e948c27943dca5b2a09b3e1f0e44",
    "name": "soroban-indexer-service",
    "prefix": "bwk_live_c6a1e9",
    "scopes": [
      "jobs:read",
      "jobs:trigger",
      "events:subscribe",
      "metrics:read"
    ],
    "rateLimitPerMinute": 300,
    "usageCount": 0,
    "expiresAt": "2026-12-26T14:00:00.000Z",
    "revokedAt": null,
    "lastUsedAt": null,
    "lastUsedIp": null,
    "createdBy": "admin",
    "createdAt": "2026-09-27T14:00:00.000Z",
    "updatedAt": "2026-09-27T14:00:00.000Z"
  },
  "rawKey": "bwk_live_c6a1e948c27943dca5b2a09b3e1f0e4418d3c509e8634e7da1048b94f0e9b621"
}
```

---

## Scope & Permission Model

Bridge-Watch implements role and scope-based access control (RBAC). Routes specify required scopes; keys must possess either the specific scope or the administrative wildcard (`*`).

### Common Scopes

| Scope Category | Scope Identifier | Description |
| :--- | :--- | :--- |
| **Wildcard** | `*` | Full super-admin access across all resources. |
| **Jobs** | `jobs:read` | Inspect scheduled background jobs and pipeline status. |
| | `jobs:trigger` | Manually dispatch or replay pipeline jobs. |
| **Alerts** | `alerts:read` | Retrieve alert triggers, evaluation rules, and silence lists. |
| | `alerts:write` | Create or update alert configurations and threshold rules. |
| **Circuit Breakers** | `circuit:read` | Check circuit breaker status, bridge pauses, and whitelist. |
| | `circuit:operator` | Trigger emergency pause or resume flows (requires multisig). |
| **Subscriptions** | `events:subscribe` | Register and manage contract event subscription streams. |
| **Metrics & Telemetry** | `metrics:read` | Fetch Prometheus metrics and container resource telemetry. |
| **Admin** | `admin:api-keys` | Provision, rotate, and revoke API keys and audit logs. |
| | `admin:secrets` | Execute secret provider health checks and probe triggers. |

---

## Rate Limit Tiers

Bridge-Watch enforces rate limits per minute per authenticated key using a sliding window counter algorithm ([backend/src/services/slidingWindowRateLimit.service.ts](file:///Users/user/Documents/Code/Bridge-Watch/backend/src/services/slidingWindowRateLimit.service.ts)).

| Tier Level | Default Rate Limit | Recommended Use Case |
| :--- | :--- | :--- |
| **Standard (Default)** | 120 req / min | General monitoring clients, dashboards, query scripts. |
| **High Throughput** | 600 req / min | Real-time event indexers, relayers, and ingestion daemons. |
| **Internal Daemon** | 1,200 req / min | Core node sidecars and bridge validator agents. |
| **Admin** | 2,400 req / min | Automated platform orchestrators and CI/CD pipelines. |

### Rate Limit Response Headers

All API responses return the following rate limit tracking headers:
- `X-RateLimit-Limit`: Maximum permitted requests in the current 60-second window.
- `X-RateLimit-Remaining`: Number of requests remaining in the current window.
- `X-RateLimit-Reset`: Unix timestamp (in seconds) when the current window resets.

When limits are exceeded, the API responds with `429 Too Many Requests`:
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Try again in 24 seconds.",
  "retryAfter": 24
}
```

---

## Key Rotation Procedure

To prevent service downtime during credential updates, Bridge-Watch supports zero-downtime key rotation.

```mermaid
sequenceDiagram
    participant Client as External Service
    participant Admin as Security Admin
    participant API as Bridge-Watch API
    participant DB as Postgres Datastore

    Admin->>API: POST /api/v1/api-keys/:id/rotate
    API->>DB: Generate new hash/salt, retain old key in grace window
    API-->>Admin: Returns new raw key (bwk_live_...)
    Admin->>Client: Deploy new raw key to secret store
    Client->>API: Authenticate with new key
    API-->>Client: 200 OK (Updates lastUsedAt on new key)
    Admin->>API: POST /api/v1/api-keys/:id/revoke (or automatic grace expiry)
    API->>DB: Set revokedAt timestamp on old key
```

### 1. Trigger Rotation

```bash
curl -X POST https://api.bridgewatch.stellar.org/api/v1/api-keys/c6a1e948c27943dca5b2a09b3e1f0e44/rotate \
  -H "x-api-key: bwk_live_admin_bootstrap_key"
```

### 2. Immediate Revocation

If an API key is suspected of being compromised, immediately revoke it:

```bash
curl -X POST https://api.bridgewatch.stellar.org/api/v1/api-keys/c6a1e948c27943dca5b2a09b3e1f0e44/revoke \
  -H "x-api-key: bwk_live_admin_bootstrap_key"
```

---

## Authenticated Request Examples

### 1. API Key in Header

```bash
curl -X GET https://api.bridgewatch.stellar.org/api/v1/circuit-breaker/status?scope=global \
  -H "x-api-key: bwk_live_c6a1e948c27943dca5b2a09b3e1f0e4418d3c509e8634e7da1048b94f0e9b621"
```

### 2. Bearer Token (OAuth2 / JWT)

```bash
curl -X GET https://api.bridgewatch.stellar.org/api/v1/metrics \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 3. Error Responses

#### Missing or Invalid Key (`401 Unauthorized`)
```json
{
  "error": "Unauthorized",
  "message": "Invalid API key or token"
}
```

#### Insufficient Scope (`403 Forbidden`)
```json
{
  "error": "Forbidden",
  "message": "API key lacks required scope: admin:api-keys"
}
```
