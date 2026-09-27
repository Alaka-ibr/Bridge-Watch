import { MultiRpcFailover } from "../src";

/**
 * Example 3: Automatic Multi-RPC Failover with Node Health Tracking
 */
async function run() {
  console.log("=== SDK Error Recovery: Multi-RPC Failover Example ===");

  const rpcPool = new MultiRpcFailover([
    "https://failing-rpc-1.stellar.org",
    "https://failing-rpc-2.stellar.org",
    "https://healthy-backup-rpc.stellar.org",
  ]);

  console.log(`Initial active RPC: ${rpcPool.getActiveRpcUrl()}`);

  const queryOperation = async (endpoint: string) => {
    console.log(`Attempting query against endpoint: ${endpoint}`);
    if (endpoint.includes("failing")) {
      throw new Error(`Connection timeout on ${endpoint}`);
    }
    return {
      status: "connected",
      latestLedger: 51294820,
      protocolVersion: 21,
    };
  };

  try {
    const { result, endpointUsed } = await rpcPool.executeWithFailover(queryOperation);
    console.log(`\nSuccessfully recovered via: ${endpointUsed}`);
    console.log("Data received:", result);
    console.log(`New active default RPC: ${rpcPool.getActiveRpcUrl()}`);
  } catch (error) {
    console.error("All failover RPC nodes failed:", error);
  }
}

if (process.env.NODE_ENV !== "test") {
  run().catch(console.error);
}
