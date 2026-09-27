import {
  BridgeWatchSdkError,
  BridgeWatchCircuitBreakerOpenError,
  BridgeWatchRpcUnavailableError,
} from "./errors";

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  jitter?: boolean;
  retryOn?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Execute an async operation with exponential backoff and jitter
 */
export async function withExponentialBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 10000;
  const backoffFactor = options.backoffFactor ?? 2;
  const useJitter = options.jitter ?? true;

  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (error) {
      attempt++;
      if (attempt > maxRetries) {
        throw error;
      }

      const shouldRetry = options.retryOn
        ? options.retryOn(error, attempt)
        : defaultRetryPredicate(error);

      if (!shouldRetry) {
        throw error;
      }

      // Calculate exponential backoff
      let delay = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
      if (useJitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }
      delay = Math.min(delay, maxDelayMs);

      if (options.onRetry) {
        options.onRetry(error, attempt, delay);
      }

      await sleep(delay);
    }
  }
}

function defaultRetryPredicate(error: unknown): boolean {
  if (error instanceof BridgeWatchSdkError) {
    return error.retryable;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("429") ||
      msg.includes("503") ||
      msg.includes("504") ||
      msg.includes("network")
    );
  }
  return true;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  name?: string;
  failureThreshold?: number; // consecutive failures before opening
  resetTimeoutMs?: number; // cooldown period before half-opening
  successThreshold?: number; // successful half-open calls before closing
  fallback?: <T>() => Promise<T>;
}

export class CircuitBreaker {
  public readonly name: string;
  private state: CircuitBreakerState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly successThreshold: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.name = options.name || "default";
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeoutMs = options.resetTimeoutMs || 5000;
    this.successThreshold = options.successThreshold || 2;
  }

  public getState(): CircuitBreakerState {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
      }
    }
    return this.state;
  }

  public async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === "OPEN") {
      if (fallback) {
        return fallback();
      }
      throw new BridgeWatchCircuitBreakerOpenError(this.name, this.resetTimeoutMs);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      if (fallback) {
        return fallback();
      }
      throw error;
    }
  }

  public recordSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = "CLOSED";
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else if (this.state === "CLOSED") {
      this.failureCount = 0;
    }
  }

  public recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === "HALF_OPEN" || this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.successCount = 0;
    }
  }

  public reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }
}

export interface RpcNode {
  url: string;
  weight?: number;
  isHealthy: boolean;
  consecutiveFailures: number;
  lastFailureTime?: number;
}

export class MultiRpcFailover {
  private nodes: RpcNode[];
  private activeIndex = 0;

  constructor(rpcUrls: string[]) {
    if (!rpcUrls || rpcUrls.length === 0) {
      throw new Error("MultiRpcFailover requires at least one RPC URL");
    }
    this.nodes = rpcUrls.map((url) => ({
      url,
      isHealthy: true,
      consecutiveFailures: 0,
    }));
  }

  public getActiveRpcUrl(): string {
    return this.nodes[this.activeIndex].url;
  }

  public getAllNodes(): ReadonlyArray<RpcNode> {
    return [...this.nodes];
  }

  public async executeWithFailover<T>(
    operation: (rpcUrl: string) => Promise<T>
  ): Promise<{ result: T; endpointUsed: string }> {
    const totalNodes = this.nodes.length;
    let lastError: unknown;

    for (let attempt = 0; attempt < totalNodes; attempt++) {
      const nodeIndex = (this.activeIndex + attempt) % totalNodes;
      const node = this.nodes[nodeIndex];

      try {
        const result = await operation(node.url);
        node.isHealthy = true;
        node.consecutiveFailures = 0;
        this.activeIndex = nodeIndex; // Stick with successful node
        return { result, endpointUsed: node.url };
      } catch (error) {
        node.consecutiveFailures++;
        node.lastFailureTime = Date.now();
        if (node.consecutiveFailures >= 2) {
          node.isHealthy = false;
        }
        lastError = error;
      }
    }

    throw new BridgeWatchRpcUnavailableError(
      `All ${totalNodes} RPC endpoints failed. Last error: ${String(lastError)}`,
      lastError
    );
  }
}

export interface DeadLetterItem<T> {
  id: string;
  data: T;
  error: string;
  failedAt: string;
  retryCount: number;
}

export class DeadLetterQueue<T> {
  private queue: DeadLetterItem<T>[] = [];
  private maxItems: number;

  constructor(maxItems = 1000) {
    this.maxItems = maxItems;
  }

  public enqueue(data: T, error: unknown): DeadLetterItem<T> {
    const item: DeadLetterItem<T> = {
      id: `dlq_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      data,
      error: error instanceof Error ? error.message : String(error),
      failedAt: new Date().toISOString(),
      retryCount: 0,
    };

    this.queue.push(item);
    if (this.queue.length > this.maxItems) {
      this.queue.shift();
    }
    return item;
  }

  public getItems(): ReadonlyArray<DeadLetterItem<T>> {
    return [...this.queue];
  }

  public size(): number {
    return this.queue.length;
  }

  public async redrive(
    processor: (data: T) => Promise<void>
  ): Promise<{ reprocessed: number; stillFailing: number }> {
    const items = [...this.queue];
    this.queue = [];
    let reprocessed = 0;
    let stillFailing = 0;

    for (const item of items) {
      try {
        await processor(item.data);
        reprocessed++;
      } catch (err) {
        item.retryCount++;
        item.error = err instanceof Error ? err.message : String(err);
        this.queue.push(item);
        stillFailing++;
      }
    }

    return { reprocessed, stillFailing };
  }

  public clear(): void {
    this.queue = [];
  }
}
