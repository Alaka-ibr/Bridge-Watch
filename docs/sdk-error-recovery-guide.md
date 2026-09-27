# Stellar Bridge-Watch SDK Error Recovery Guide

## Overview

The Stellar Bridge-Watch SDK provides client-side resilience patterns to ensure robust, uninterrupted operation when communicating with Soroban RPC nodes, Horizon clusters, and the Bridge-Watch platform API.

---

## Resilience Patterns & Recipes

### 1. Exponential Backoff with Jitter
Handles transient network disruptions, ledger close delays, and HTTP 429 rate limits.

```typescript
import { withExponentialBackoff, BridgeWatchRateLimitError } from "@stellar-bridge-watch/sdk";

const health = await withExponentialBackoff(
  async (attempt) => {
    return await sdk.getContractHealth("USDC");
  },
  {
    maxRetries: 4,
    initialDelayMs: 250,
    maxDelayMs: 5000,
    backoffFactor: 2,
    jitter: true,
  }
);
```

### 2. Circuit Breaker with Cached Snapshot Fallbacks
Protects client applications from hanging or cascading failures when an upstream bridge contract or node is failing.

```typescript
import { CircuitBreaker } from "@stellar-bridge-watch/sdk";

const breaker = new CircuitBreaker({
  name: "soroban-rpc-cluster",
  failureThreshold: 3,
  resetTimeoutMs: 10000,
  successThreshold: 2,
});

const data = await breaker.execute(
  () => sdk.getContractHealth("USDC"),
  () => getCachedLocalSnapshot("USDC")
);
```

### 3. Multi-RPC Failover Pool
Automatically load-balances and fails over queries across an array of primary and secondary Soroban/Horizon RPC endpoints.

```typescript
import { MultiRpcFailover } from "@stellar-bridge-watch/sdk";

const rpcPool = new MultiRpcFailover([
  "https://soroban-rpc-1.stellar.org",
  "https://soroban-rpc-2.stellar.org",
  "https://backup-rpc.stellar.org",
]);

const { result, endpointUsed } = await rpcPool.executeWithFailover(async (rpcUrl) => {
  const client = new BridgeWatchContractSdk({ rpcUrl });
  return await client.connect();
});
```

### 4. Dead-Letter Queue (DLQ) & Poison-Pill Replay
Captures malformed ledger events, unparseable transactions, or schema mismatches into a DLQ for inspection and subsequent redrive.

```typescript
import { DeadLetterQueue } from "@stellar-bridge-watch/sdk";

const dlq = new DeadLetterQueue();

try {
  processEvent(rawEvent);
} catch (error) {
  dlq.enqueue(rawEvent, error);
}

// Redrive after schema upgrade
const summary = await dlq.redrive(async (item) => {
  await processEventWithNewSchema(item);
});
```

### 5. Resilient WebSocket Stream Auto-Reconnect
Automatically reconnects dropped event streams and backfills missed ledger sequence numbers upon reconnect.
