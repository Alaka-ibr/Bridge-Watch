# Bridge-Watch Contract SDK Quick-Start Guide

The `@bridge-watch/contract-sdk` TypeScript library provides client interfaces, type-safe contract wrappers, resilience utilities, and testing harnesses for interacting with Stellar Bridge-Watch smart contracts and monitoring infrastructure.

---

## 1. Installation

```bash
npm install @bridge-watch/contract-sdk @stellar/stellar-sdk
```

---

## 2. Initializing the SDK Client

You can initialize either the base `BridgeWatchContractSdk` for low-level RPC operations or `TypedBridgeWatchContractSdk` for high-level typed contract queries.

```typescript
import { 
  BridgeWatchContractSdk, 
  TypedBridgeWatchContractSdk, 
  BridgeWatchSdkConfig 
} from "@bridge-watch/contract-sdk";

const sdkConfig: BridgeWatchSdkConfig = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  apiUrl: "https://api.testnet.bridgewatch.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  defaultTimeoutSeconds: 30,
};

// Initialize typed SDK wrapper
const sdk = new TypedBridgeWatchContractSdk(sdkConfig);

// Verify connection
const health = await sdk.connect();
console.log(`Connected to Soroban RPC. Latest Ledger: ${health.latestLedger}`);
```

---

## 3. Querying Bridge & Asset Health

Query on-chain health scores, liquidity depth, price stability metrics, and pause statuses:

```typescript
import { TypedBridgeWatchContractSdk, AssetHealth } from "@bridge-watch/contract-sdk";

async function checkAssetStatus(sdk: TypedBridgeWatchContractSdk, assetCode: string) {
  // Query asset health score
  const health: AssetHealth | null = await sdk.getContractHealth(assetCode);

  if (!health) {
    console.log(`Asset ${assetCode} is not registered.`);
    return;
  }

  console.log(`Asset: ${health.asset_code}`);
  console.log(`Composite Health Score: ${health.health_score} / 100`);
  console.log(`Liquidity Score: ${health.liquidity_score}`);
  console.log(`Price Stability Score: ${health.price_stability_score}`);
  console.log(`Paused: ${health.paused}`);
  console.log(`Active: ${health.active}`);
}
```

---

## 4. Subscribing to Contract Events with Exponential Backoff

The SDK provides automatic event polling with built-in jittered exponential backoff and connection retry management:

```typescript
import { BridgeWatchContractSdk, EventSubscription } from "@bridge-watch/contract-sdk";

const client = new BridgeWatchContractSdk(sdkConfig);

const subscription: EventSubscription = client.subscribeToEvents({
  contractId: sdkConfig.contractId,
  pollIntervalMs: 2500,
  maxBackoffMs: 30000,
  startLedger: 1050000,
  onEvent: (event) => {
    console.log("Received Contract Event:", {
      id: event.id,
      ledger: event.ledger,
      topic: event.topic,
      value: event.value,
    });
  },
  onError: (error) => {
    console.error("Event subscription polling error:", error.message);
  },
  onBackoffStateChange: (state) => {
    if (state.isBackingOff) {
      console.warn(
        `Backing off: ${state.consecutiveFailures} consecutive errors. Current interval: ${state.currentBackoffMs}ms`
      );
    } else {
      console.log("Normal polling interval restored.");
    }
  },
});

// To stop listening:
// subscription.unsubscribe();
```

---

## 5. Simulating and Invoking Contract Calls

Simulate execution before submission to inspect return values, gas consumption, and authorization requirements:

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";
import { BridgeWatchContractSdk } from "@bridge-watch/contract-sdk";

const client = new BridgeWatchContractSdk(sdkConfig);

async function simulatePauseCheck(contractId: string) {
  // 1. Prepare simulation query
  const simulationResponse = await client.queryMethod({
    contractId,
    method: "is_paused",
    args: [StellarSdk.xdr.ScVal.scvString("global")],
  });

  // 2. Check simulation success
  if (StellarSdk.rpc.Api.isSimulationSuccess(simulationResponse)) {
    console.log("Simulation succeeded. Transaction cost:", simulationResponse.minResourceFee);
    console.log("Return XDR value:", simulationResponse.result?.retval);
  } else {
    console.error("Simulation failed:", simulationResponse.error);
  }
}
```

---

## 6. Integration Testing with the Test Harness

Use the provided testing utilities to create mock ScVals, mock event payloads, and subscription mocks for Vitest or Jest:

```typescript
import { describe, it, expect } from "vitest";
import { 
  createMockScValString, 
  createMockScValU64, 
  createMockEvent, 
  createMockWatchSubscription 
} from "@bridge-watch/contract-sdk";

describe("Bridge-Watch Integration Test Suite", () => {
  it("creates valid ScVal mock values for testing", () => {
    const stringVal = createMockScValString("XLM");
    const u64Val = createMockScValU64(500000);

    expect(stringVal.str()?.toString()).toBe("XLM");
    expect(u64Val.u64()?.toString()).toBe("500000");
  });

  it("handles mock event dispatching", () => {
    const mockEvent = createMockEvent({
      topic: ["health_update", "USDC"],
      value: { score: 98 },
    });

    expect(mockEvent.contractId).toBe("mock-contract-id");
    expect(mockEvent.type).toBe("contract");
  });

  it("manages mock subscription lifecycle", () => {
    const sub = createMockWatchSubscription();
    expect(sub.isClosed()).toBe(false);

    sub.unsubscribe();
    expect(sub.isClosed()).toBe(true);
  });
});
```
