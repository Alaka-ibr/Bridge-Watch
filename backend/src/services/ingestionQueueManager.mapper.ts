import type { UnconfirmedEventRow } from "../types/ingestion.types.js";
import type { UnconfirmedEvent } from "./ingestionQueueManager.service.js";

/**
 * Map a database `unconfirmed_events` row to the runtime `UnconfirmedEvent` shape.
 * Exported as a pure function so it can be tested independently from the class.
 */
export function mapUnconfirmedEventRow(row: UnconfirmedEventRow): UnconfirmedEvent {
  return {
    id: row.id,
    sourceChain: row.source_chain,
    eventType: row.event_type,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload as string) : (row.payload as Record<string, unknown>),
    txHash: row.tx_hash,
    ledgerSequence: Number(row.ledger_sequence),
    observedLedger: Number(row.observed_ledger),
    confirmations: Number(row.confirmations),
    requiredConfirmations: Number(row.required_confirmations),
    isConfirmed: row.is_confirmed,
    isRolledBack: row.is_rolled_back,
  };
}
