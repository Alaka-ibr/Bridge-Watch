/**
 * Bridge Transaction Worker with Bloom Filter Deduplication (Issue #1267)
 * 
 * Processes incoming transaction batches from Horizon streams.
 * Uses Redis Bloom filter to skip duplicate transactions before querying PostgreSQL.
 */

import { Worker, Queue } from 'bullmq';
import { config } from '../config/index.js';
import { BridgeTransactionService } from '../services/bridgeTransaction.service.js';
import { getBloomFilterService } from '../services/bloomFilterCache.service.js';
import { logger } from '../utils/logger.js';
import type { NewBridgeTransaction } from '../database/types.js';

const QUEUE_NAME = 'bridge-transaction';

const connection = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
};

export const bridgeTransactionQueue = new Queue(QUEUE_NAME, { connection });

interface TransactionBatch {
  bridgeName: string;
  transactions: NewBridgeTransaction[];
}

/**
 * Process a batch of transactions with Bloom filter deduplication
 */
export async function processBridgeTransactionBatch(job: {
  id?: string;
  data: TransactionBatch;
}) {
  const { bridgeName, transactions } = job.data;
  const bloomFilter = getBloomFilterService();
  const transactionService = new BridgeTransactionService();

  logger.info(
    { jobId: job.id, bridgeName, count: transactions.length },
    'Processing bridge transaction batch'
  );

  let bloomHits = 0;
  let bloomMisses = 0;
  let dbChecks = 0;
  let created = 0;
  let skipped = 0;

  // Extract transaction hashes for batch Bloom filter check
  const txHashes = transactions.map((tx) => tx.tx_hash);

  // Batch check Bloom filter for all hashes
  const existsResults = await bloomFilter.existsMulti(txHashes);

  // Process each transaction
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const txHash = txHashes[i];
    const maybeExists = existsResults[i];

    if (!maybeExists) {
      // Bloom filter says: definitely new (never seen before)
      bloomMisses++;

      try {
        await transactionService.createTransaction(tx);
        await bloomFilter.add(txHash);
        created++;

        logger.debug({ txHash, bridgeName }, 'New transaction created (BF miss)');
      } catch (err: any) {
        // Could be a race condition where another worker created it
        if (err.code === '23505' || err.constraint?.includes('unique')) {
          logger.debug({ txHash }, 'Transaction already exists (race condition)');
          await bloomFilter.add(txHash); // Add to BF to prevent future checks
          skipped++;
        } else {
          throw err;
        }
      }
    } else {
      // Bloom filter says: MIGHT exist (check database to confirm)
      bloomHits++;

      // Check database to confirm (Bloom filter has false positives)
      dbChecks++;
      const existing = await transactionService.getTransactionByHash(
        bridgeName,
        txHash
      );

      if (!existing) {
        // False positive: Bloom filter said exists, but DB says no
        try {
          await transactionService.createTransaction(tx);
          await bloomFilter.add(txHash);
          created++;

          logger.debug({ txHash }, 'New transaction created (BF false positive)');
        } catch (err: any) {
          if (err.code === '23505' || err.constraint?.includes('unique')) {
            await bloomFilter.add(txHash);
            skipped++;
          } else {
            throw err;
          }
        }
      } else {
        // True positive: transaction already exists
        skipped++;
        logger.debug({ txHash }, 'Transaction already exists (BF hit)');
      }
    }
  }

  const stats = {
    total: transactions.length,
    bloomHits,
    bloomMisses,
    dbChecks,
    created,
    skipped,
    dbLoadReduction: transactions.length > 0
      ? ((1 - dbChecks / transactions.length) * 100).toFixed(1)
      : '0',
  };

  logger.info(
    { ...stats, bridgeName },
    'Bridge transaction batch processed'
  );

  return { success: true, ...stats };
}

/**
 * Worker that processes bridge transactions from Horizon streams
 */
export const bridgeTransactionWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    try {
      return await processBridgeTransactionBatch(job);
    } catch (error) {
      logger.error(
        { error, bridgeName: job.data?.bridgeName },
        'Bridge transaction batch failed'
      );
      throw error;
    }
  },
  { connection, concurrency: 10 }
);

bridgeTransactionWorker.on('completed', (job, result) => {
  logger.debug(
    { jobId: job?.id, result },
    'Bridge transaction batch completed'
  );
});

bridgeTransactionWorker.on('failed', (job, error) => {
  logger.error(
    { jobId: job?.id, error: error.message },
    'Bridge transaction batch failed'
  );
});

// Initialize Bloom filter on worker startup
(async () => {
  const bloomFilter = getBloomFilterService();
  await bloomFilter.connect();
  logger.info('Bloom filter initialized for transaction deduplication');
})();
