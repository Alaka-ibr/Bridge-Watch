/**
 * Ingestion-related row shapes returned by Knex queries.
 *
 * These interfaces mirror the database migration column names and types
 * so that query results can be strongly-typed when passed into the
 * ingestion queue manager.
 */
export interface IngestionJobRow {
  id: string;
  type: string; // IngestionJobType (string union in service)
  priority: number;
  payload: string | Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
  created_at: Date;
  updated_at: Date;
  next_retry_at: Date | null;
  status: string;
  last_error?: string | null;
}

export interface UnconfirmedEventRow {
  id: string;
  source_chain: string;
  event_type: string;
  payload: unknown; // jsonb in DB
  tx_hash: string;
  ledger_sequence: number | string;
  observed_ledger: number | string;
  confirmations: number;
  required_confirmations: number;
  is_confirmed: boolean;
  is_rolled_back: boolean;
  observed_at: Date;
  confirmed_at: Date | null;
  rolled_back_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
