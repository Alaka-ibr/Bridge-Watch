import { describe, it, expect } from 'vitest';
import type { UnconfirmedEventRow } from '../../types/ingestion.types.js';
import { mapUnconfirmedEventRow } from '../ingestionQueueManager.mapper.js';

describe('ingestionQueueManager.mapper', () => {
  it('maps UnconfirmedEventRow to UnconfirmedEvent correctly', () => {
    const row: UnconfirmedEventRow = {
      id: 'evt-1',
      source_chain: 'stellar',
      event_type: 'transfer',
      payload: { a: 1 },
      tx_hash: 'tx-1',
      ledger_sequence: 100,
      observed_ledger: 102,
      confirmations: 2,
      required_confirmations: 3,
      is_confirmed: false,
      is_rolled_back: false,
      observed_at: new Date(),
      confirmed_at: null,
      rolled_back_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mapped = mapUnconfirmedEventRow(row);
    expect(mapped.id).toBe('evt-1');
    expect(mapped.sourceChain).toBe('stellar');
    expect(typeof mapped.ledgerSequence).toBe('number');
    expect(mapped.payload).toEqual({ a: 1 });
  });
});
