import { DeadLetterQueue, BridgeWatchSchemaValidationError } from "../src";

interface ContractEventPayload {
  contractId: string;
  topic: string;
  amount: number;
}

/**
 * Example 4: Dead-Letter Queue (DLQ) for Poison Pills and Replay Recovery
 */
async function run() {
  console.log("=== SDK Error Recovery: Dead-Letter Queue (DLQ) Example ===");

  const dlq = new DeadLetterQueue<ContractEventPayload>();

  const incomingEvents: any[] = [
    { contractId: "C123", topic: "deposit", amount: 500 },
    { contractId: "C456", topic: "deposit", amount: "invalid_string_not_number" }, // Poison pill
    { contractId: "C789", topic: "withdraw", amount: 1200 },
  ];

  const processEvent = async (event: ContractEventPayload) => {
    if (typeof event.amount !== "number" || isNaN(event.amount)) {
      throw new BridgeWatchSchemaValidationError("Payload field 'amount' must be a valid number");
    }
    console.log(`[Processed] Contract ${event.contractId} - ${event.topic}: ${event.amount}`);
  };

  // Step 1: Ingestion loop with DLQ capture
  console.log("\n1. Processing incoming event batch:");
  for (const rawEvent of incomingEvents) {
    try {
      await processEvent(rawEvent);
    } catch (err) {
      console.warn(`[DLQ Enqueue] Failed event ${rawEvent.contractId}:`, err);
      dlq.enqueue(rawEvent, err);
    }
  }

  console.log(`\nDLQ currently holds ${dlq.size()} failed events:`);
  console.log(dlq.getItems());

  // Step 2: Schema patch / recovery redrive
  console.log("\n2. Re-driving DLQ after schema sanitizer patch:");
  const patchedProcessor = async (event: ContractEventPayload) => {
    // Sanitize string numbers
    const cleanAmount = typeof event.amount === "number" ? event.amount : parseFloat(String(event.amount)) || 0;
    console.log(`[Re-drive Success] Sanitized contract ${event.contractId} amount to ${cleanAmount}`);
  };

  const { reprocessed, stillFailing } = await dlq.redrive(patchedProcessor);
  console.log(`Re-drive summary: Reprocessed=${reprocessed}, Still failing=${stillFailing}`);
  console.log(`DLQ size after redrive: ${dlq.size()}`);
}

if (process.env.NODE_ENV !== "test") {
  run().catch(console.error);
}
