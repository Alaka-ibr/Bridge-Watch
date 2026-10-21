/**
 * Bloom Filter Deduplication Service (Issue #1267)
 * 
 * Maintains a Redis Bloom filter for transaction hash deduplication.
 * Reduces database read contention by checking Bloom filter before querying PostgreSQL.
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export class BloomFilterCacheService {
  private client: RedisClientType | null = null;
  private connected = false;
  private readonly filterKey = 'bridge:tx:bloom';
  private readonly ttlSeconds = 7 * 24 * 60 * 60; // 7 days

  // Bloom filter parameters
  private readonly errorRate = 0.01; // 1% false positive rate
  private readonly capacity = 1_000_000; // Expected tx count over 7 days

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      this.client = createClient({
        socket: {
          host: config.REDIS_HOST,
          port: config.REDIS_PORT,
        },
        password: config.REDIS_PASSWORD || undefined,
      });

      this.client.on('error', (err) => {
        logger.error({ err }, 'Bloom filter Redis client error');
        this.connected = false;
      });

      this.client.on('connect', () => {
        logger.info('Bloom filter Redis client connected');
        this.connected = true;
      });

      await this.client.connect();
      await this.ensureBloomFilter();
    } catch (err) {
      logger.error({ err }, 'Failed to connect Bloom filter Redis client');
      this.connected = false;
    }
  }

  /**
   * Ensure Bloom filter exists with correct parameters
   */
  private async ensureBloomFilter(): Promise<void> {
    if (!this.client) return;

    try {
      // Try to get filter info
      await this.client.sendCommand(['BF.INFO', this.filterKey]);
    } catch {
      // Filter doesn't exist, create it
      try {
        await this.client.sendCommand([
          'BF.RESERVE',
          this.filterKey,
          String(this.errorRate),
          String(this.capacity),
        ]);
        logger.info(
          { errorRate: this.errorRate, capacity: this.capacity },
          'Created Bloom filter for transaction deduplication'
        );
      } catch (err) {
        logger.error({ err }, 'Failed to create Bloom filter');
      }
    }
  }

  /**
   * Check if transaction hash exists in Bloom filter
   * 
   * @param txHash - Transaction hash to check
   * @returns true if hash MIGHT exist (check DB), false if definitely doesn't exist
   */
  async exists(txHash: string): Promise<boolean> {
    if (!this.connected || !this.client) {
      // Graceful degradation: if Redis unavailable, assume exists (check DB)
      logger.warn('Bloom filter unavailable, falling back to database check');
      return true;
    }

    try {
      const result = await this.client.sendCommand(['BF.EXISTS', this.filterKey, txHash]);
      return result === 1;
    } catch (err) {
      logger.error({ err, txHash }, 'Bloom filter EXISTS failed');
      return true; // Fail open: check database
    }
  }

  /**
   * Add transaction hash to Bloom filter
   * 
   * @param txHash - Transaction hash to add
   */
  async add(txHash: string): Promise<void> {
    if (!this.connected || !this.client) {
      logger.debug('Bloom filter unavailable, skipping add');
      return;
    }

    try {
      await this.client.sendCommand(['BF.ADD', this.filterKey, txHash]);
    } catch (err) {
      logger.error({ err, txHash }, 'Bloom filter ADD failed');
    }
  }

  /**
   * Check multiple transaction hashes at once
   * 
   * @param txHashes - Array of transaction hashes
   * @returns Array of booleans indicating existence (same order as input)
   */
  async existsMulti(txHashes: string[]): Promise<boolean[]> {
    if (!this.connected || !this.client || txHashes.length === 0) {
      return txHashes.map(() => true); // Fail open
    }

    try {
      const results = await this.client.sendCommand([
        'BF.MEXISTS',
        this.filterKey,
        ...txHashes,
      ]);
      return (results as number[]).map((r) => r === 1);
    } catch (err) {
      logger.error({ err, count: txHashes.length }, 'Bloom filter MEXISTS failed');
      return txHashes.map(() => true);
    }
  }

  /**
   * Add multiple transaction hashes at once
   * 
   * @param txHashes - Array of transaction hashes to add
   */
  async addMulti(txHashes: string[]): Promise<void> {
    if (!this.connected || !this.client || txHashes.length === 0) {
      return;
    }

    try {
      await this.client.sendCommand(['BF.MADD', this.filterKey, ...txHashes]);
    } catch (err) {
      logger.error({ err, count: txHashes.length }, 'Bloom filter MADD failed');
    }
  }

  /**
   * Get Bloom filter statistics
   */
  async getStats(): Promise<BloomFilterStats | null> {
    if (!this.connected || !this.client) {
      return null;
    }

    try {
      const info = (await this.client.sendCommand([
        'BF.INFO',
        this.filterKey,
      ])) as string[];

      // Parse Redis response (alternating keys and values)
      const stats: Record<string, string> = {};
      for (let i = 0; i < info.length; i += 2) {
        stats[info[i]] = info[i + 1];
      }

      return {
        capacity: parseInt(stats.Capacity || '0', 10),
        size: parseInt(stats.Size || '0', 10),
        numFilters: parseInt(stats['Number of filters'] || '1', 10),
        numItems: parseInt(stats['Number of items inserted'] || '0', 10),
        expansionRate: parseInt(stats['Expansion rate'] || '2', 10),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get Bloom filter stats');
      return null;
    }
  }

  /**
   * Clear the Bloom filter (use with caution)
   */
  async clear(): Promise<void> {
    if (!this.connected || !this.client) {
      return;
    }

    try {
      await this.client.del(this.filterKey);
      await this.ensureBloomFilter();
      logger.warn('Bloom filter cleared and recreated');
    } catch (err) {
      logger.error({ err }, 'Failed to clear Bloom filter');
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
    }
  }
}

export interface BloomFilterStats {
  capacity: number;
  size: number;
  numFilters: number;
  numItems: number;
  expansionRate: number;
}

// Singleton instance
let instance: BloomFilterCacheService | null = null;

export function getBloomFilterService(): BloomFilterCacheService {
  if (!instance) {
    instance = new BloomFilterCacheService();
  }
  return instance;
}
