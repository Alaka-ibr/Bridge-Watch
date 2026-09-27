import { describe, expect, it, vi } from "vitest";
import {
  withExponentialBackoff,
  CircuitBreaker,
  MultiRpcFailover,
  DeadLetterQueue,
} from "./resilience";
import {
  BridgeWatchRateLimitError,
  BridgeWatchCircuitBreakerOpenError,
  BridgeWatchRpcUnavailableError,
} from "./errors";

describe("SDK Resilience Utilities", () => {
  describe("withExponentialBackoff", () => {
    it("should return immediately when the operation succeeds on first attempt", async () => {
      const fn = vi.fn().mockResolvedValue("success");
      const result = await withExponentialBackoff(fn, { maxRetries: 3, initialDelayMs: 10 });

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry transient failures and succeed", async () => {
      let attempts = 0;
      const fn = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new BridgeWatchRateLimitError("Rate limited", 10);
        }
        return "recovered";
      });

      const result = await withExponentialBackoff(fn, {
        maxRetries: 4,
        initialDelayMs: 5,
        backoffFactor: 1.5,
        jitter: false,
      });

      expect(result).toBe("recovered");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should throw after exhausting maxRetries", async () => {
      const fn = vi.fn().mockRejectedValue(new BridgeWatchRateLimitError("Always fails", 10));

      await expect(
        withExponentialBackoff(fn, { maxRetries: 2, initialDelayMs: 5, jitter: false })
      ).rejects.toThrow(BridgeWatchRateLimitError);

      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe("CircuitBreaker", () => {
    it("should allow calls when closed", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });
      const res = await breaker.execute(async () => 42);
      expect(res).toBe(42);
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("should trip to OPEN when failures exceed threshold", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });

      // Failure 1
      await expect(breaker.execute(async () => { throw new Error("fail 1"); })).rejects.toThrow("fail 1");
      expect(breaker.getState()).toBe("CLOSED");

      // Failure 2 -> Trips breaker
      await expect(breaker.execute(async () => { throw new Error("fail 2"); })).rejects.toThrow("fail 2");
      expect(breaker.getState()).toBe("OPEN");

      // Subsequent call should fail fast with BridgeWatchCircuitBreakerOpenError
      await expect(breaker.execute(async () => "never called")).rejects.toThrow(
        BridgeWatchCircuitBreakerOpenError
      );
    });

    it("should execute fallback when circuit is open or throws", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1 });
      const fallbackFn = vi.fn().mockResolvedValue("fallback_data");

      const res = await breaker.execute(
        async () => { throw new Error("primary failed"); },
        fallbackFn
      );

      expect(res).toBe("fallback_data");
      expect(fallbackFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("MultiRpcFailover", () => {
    it("should query first RPC if healthy", async () => {
      const pool = new MultiRpcFailover(["https://rpc-1.test", "https://rpc-2.test"]);
      const query = vi.fn().mockResolvedValue({ ledger: 100 });

      const { result, endpointUsed } = await pool.executeWithFailover(query);

      expect(result).toEqual({ ledger: 100 });
      expect(endpointUsed).toBe("https://rpc-1.test");
      expect(query).toHaveBeenCalledTimes(1);
    });

    it("should automatically fail over to secondary node if primary fails", async () => {
      const pool = new MultiRpcFailover(["https://failing-rpc.test", "https://healthy-rpc.test"]);
      const query = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("failing")) throw new Error("Timeout");
        return { ledger: 200 };
      });

      const { result, endpointUsed } = await pool.executeWithFailover(query);

      expect(result).toEqual({ ledger: 200 });
      expect(endpointUsed).toBe("https://healthy-rpc.test");
      expect(query).toHaveBeenCalledTimes(2);
    });

    it("should throw BridgeWatchRpcUnavailableError if all nodes fail", async () => {
      const pool = new MultiRpcFailover(["https://failing-1.test", "https://failing-2.test"]);
      const query = vi.fn().mockRejectedValue(new Error("Down"));

      await expect(pool.executeWithFailover(query)).rejects.toThrow(
        BridgeWatchRpcUnavailableError
      );
      expect(query).toHaveBeenCalledTimes(2);
    });
  });

  describe("DeadLetterQueue", () => {
    it("should enqueue failed items and report size", () => {
      const dlq = new DeadLetterQueue<{ id: string }>();
      expect(dlq.size()).toBe(0);

      const item = dlq.enqueue({ id: "evt_1" }, new Error("Corrupted payload"));
      expect(dlq.size()).toBe(1);
      expect(item.data.id).toBe("evt_1");
      expect(item.error).toBe("Corrupted payload");
    });

    it("should redrive failed items and empty on success", async () => {
      const dlq = new DeadLetterQueue<{ id: string }>();
      dlq.enqueue({ id: "evt_1" }, new Error("Error"));
      dlq.enqueue({ id: "evt_2" }, new Error("Error"));

      const processor = vi.fn().mockResolvedValue(undefined);
      const summary = await dlq.redrive(processor);

      expect(summary.reprocessed).toBe(2);
      expect(summary.stillFailing).toBe(0);
      expect(dlq.size()).toBe(0);
      expect(processor).toHaveBeenCalledTimes(2);
    });
  });
});
