import { CircuitBreaker, BridgeWatchConnectionError } from "../src";

/**
 * Example 2: Circuit Breaker pattern with graceful degraded fallback
 */
async function callPrimarySorobanRpc(): Promise<string> {
  // Simulate an RPC service outage
  throw new BridgeWatchConnectionError("Soroban primary RPC cluster 503 Service Unavailable");
}

async function getCachedLocalSnapshot(): Promise<string> {
  console.log("-> [Fallback] Returning cached local snapshot from last healthy checkpoint");
  return JSON.stringify({
    status: "cached_snapshot",
    asset: "XLM-ETH",
    lastKnownTvl: "12,500,000 USD",
    timestamp: new Date().toISOString(),
  });
}

async function run() {
  console.log("=== SDK Error Recovery: Circuit Breaker Example ===");

  const breaker = new CircuitBreaker({
    name: "soroban-rpc-breaker",
    failureThreshold: 2,
    resetTimeoutMs: 3000,
    successThreshold: 2,
  });

  console.log(`Initial circuit state: ${breaker.getState()}`);

  // Trigger calls that fail and trip the circuit
  for (let i = 1; i <= 4; i++) {
    console.log(`\nExecution #${i}:`);
    try {
      const response = await breaker.execute(
        () => callPrimarySorobanRpc(),
        () => getCachedLocalSnapshot()
      );
      console.log(`Result:`, response);
    } catch (err: any) {
      console.error(`Execution failed: ${err.message}`);
    }
    console.log(`Current circuit state: ${breaker.getState()}`);
  }
}

if (process.env.NODE_ENV !== "test") {
  run().catch(console.error);
}

export { callPrimarySorobanRpc, getCachedLocalSnapshot };
