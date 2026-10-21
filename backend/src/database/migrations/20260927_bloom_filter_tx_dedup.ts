/**
 * Bloom Filter Transaction Deduplication Setup (Issue #1267)
 * 
 * No database schema changes needed - this migration documents the Redis setup.
 * Bloom filter is managed entirely in Redis using RedisBloom module.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // No-op migration: Bloom filter lives in Redis
  // 
  // Redis setup (manual):
  // 1. Ensure Redis has RedisBloom module installed
  // 2. Bloom filter key: bridge:tx:bloom
  // 3. Parameters: error_rate=0.01, capacity=1,000,000
  // 4. TTL: 7 days (managed by application)
  //
  // Verification:
  //   redis-cli BF.INFO bridge:tx:bloom
  //
  // If RedisBloom not available:
  //   docker run -p 6379:6379 redislabs/rebloom:latest
  //   OR
  //   Install module: https://redis.io/docs/stack/bloom/
  
  await knex.raw('-- Bloom filter deduplication configured in Redis');
}

export async function down(knex: Knex): Promise<void> {
  // No-op: Bloom filter is in Redis, not PostgreSQL
  await knex.raw('-- No database changes to revert');
}
