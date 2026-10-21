import { withExponentialBackoff, BridgeWatchRateLimitError, BridgeWatchConnectionError } from "../src";

/**
 * Example 1: Handling transient HTTP 429 Rate Limits and Network Drops with Exponential Backoff + Jitter
 */
async function simulateBridgeQuery(attempt: number): Promise<{ asset: string; healthScore: number }> {
  console.log(`[Attempt ${attempt + 1}] Querying bridge health status...`);

  // Simulate transient 429 rate limit on initial calls
  if (attempt < 2) {
    console.warn(`[Attempt ${attempt + 1}] Received HTTP 429 Too Many Requests. Backing off...`);
    throw new BridgeWatchRateLimitError("Rate limit exceeded on RPC gateway", 500);
  }

  // Simulated successful response
  return {
    asset: "USDC-XLM",
    healthScore: 98,
  };
}

async function run() {
  console.log("=== SDK Error Recovery: Exponential Backoff Example ===");

  try {
    const result = await withExponentialBackoff(
      async (attempt) => simulateBridgeQuery(attempt),
      {
        maxRetries: 4,
        initialDelayMs: 250,
        maxDelayMs: 2000,
        backoffFactor: 2,
        jitter: true,
        onRetry: (error, attempt, delayMs) => {
          console.log(`-> Retry handler invoked: Waiting ${Math.round(delayMs)}ms before retry #${attempt}...`);
        },
      }
    );

    console.log("Query succeeded with result:", result);
  } catch (error) {
    console.error("All retries exhausted:", error);
  }
}

if (process.env.NODE_ENV !== "test") {
  run().catch(console.error);
}

export { simulateBridgeQuery };
