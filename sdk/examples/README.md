# Bridge-Watch SDK Error Recovery Examples

This directory contains production-ready error recovery patterns and resilience recipes for developers integrating with the Stellar Bridge-Watch SDK.

## Available Examples

| Example | Purpose | File |
| :--- | :--- | :--- |
| **Exponential Backoff + Jitter** | Handles transient HTTP 429 rate limits, socket timeouts, and network flakiness. | [`error-recovery-exponential-backoff.ts`](./error-recovery-exponential-backoff.ts) |
| **Circuit Breaker** | Isolates downstream service failures and provides graceful fallbacks to local cached snapshots. | [`error-recovery-circuit-breaker.ts`](./error-recovery-circuit-breaker.ts) |
| **Multi-RPC Failover** | Auto-fails over across multiple Soroban/Horizon RPC gateways with health tracking. | [`error-recovery-multi-rpc-failover.ts`](./error-recovery-multi-rpc-failover.ts) |
| **Dead-Letter Queue (DLQ)** | Isolates poison-pill events and provides re-drive/replay capabilities. | [`error-recovery-dead-letter-queue.ts`](./error-recovery-dead-letter-queue.ts) |
| **WebSocket Stream Reconnect** | Reconnects interrupted WebSocket streams and recovers missing event sequences. | [`error-recovery-websocket-reconnect.ts`](./error-recovery-websocket-reconnect.ts) |

## Running Examples

```bash
# In the sdk/ directory:
npx tsx examples/error-recovery-exponential-backoff.ts
npx tsx examples/error-recovery-circuit-breaker.ts
npx tsx examples/error-recovery-multi-rpc-failover.ts
npx tsx examples/error-recovery-dead-letter-queue.ts
npx tsx examples/error-recovery-websocket-reconnect.ts
```

## Quick Reference

### 1. Using Exponential Backoff
```typescript
import { withExponentialBackoff } from "@stellar-bridge-watch/sdk";

const result = await withExponentialBackoff(
  async (attempt) => fetchBridgeData(attempt),
  {
    maxRetries: 4,
    initialDelayMs: 200,
    maxDelayMs: 5000,
    backoffFactor: 2,
    jitter: true,
  }
);
```

### 2. Using Circuit Breaker
```typescript
import { CircuitBreaker } from "@stellar-bridge-watch/sdk";

const breaker = new CircuitBreaker({
  name: "soroban-rpc",
  failureThreshold: 3,
  resetTimeoutMs: 10000,
});

const data = await breaker.execute(
  () => liveRpcQuery(),
  () => cachedFallbackQuery()
);
```
