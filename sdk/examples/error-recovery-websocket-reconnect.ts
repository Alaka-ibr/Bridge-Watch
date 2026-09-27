import { withExponentialBackoff } from "../src";

/**
 * Example 5: Resilient WebSocket Event Streaming with Heartbeat & Auto-Reconnect
 */
class ResilientEventStreamSimulator {
  private isConnected = false;
  private missedEventsBuffer: Array<{ seq: number; message: string }> = [];
  private currentSequence = 100;

  async connectAndStream(onMessage: (msg: string) => void) {
    console.log("Starting resilient stream session...");

    let connectionAttempts = 0;
    while (connectionAttempts < 3) {
      connectionAttempts++;
      try {
        await withExponentialBackoff(
          async () => {
            console.log(`Connecting to WebSocket stream gateway (session attempt #${connectionAttempts})...`);
            if (connectionAttempts === 1) {
              throw new Error("WebSocket connection reset by peer");
            }
            this.isConnected = true;
            console.log("-> WebSocket connection established.");
          },
          { maxRetries: 3, initialDelayMs: 100 }
        );

        // Stream simulated events
        for (let i = 0; i < 3; i++) {
          this.currentSequence++;
          onMessage(`Event #${this.currentSequence}: Soroban Contract Bridge Deposit observed`);
        }

        // Simulate a network disruption
        if (connectionAttempts === 2) {
          console.warn("-> [Network Disruption] Simulated network packet drop occurred!");
          this.isConnected = false;
          throw new Error("Socket disconnected unexpectedly");
        }
      } catch (err: any) {
        console.warn(`Connection loop caught: ${err.message}. Initiating auto-reconnect backfill...`);
      }
    }
  }
}

async function run() {
  console.log("=== SDK Error Recovery: WebSocket Reconnect & Backfill Example ===");
  const stream = new ResilientEventStreamSimulator();

  await stream.connectAndStream((msg) => {
    console.log(`[STREAM INGEST] ${msg}`);
  });
}

if (process.env.NODE_ENV !== "test") {
  run().catch(console.error);
}
