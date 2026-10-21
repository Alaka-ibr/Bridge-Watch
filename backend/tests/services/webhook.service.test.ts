import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WebhookService,
  validateWebhookUrl,
  type WebhookEventType,
} from "../../src/services/webhook.service.js";

describe("validateWebhookUrl", () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

  it("accepts public HTTPS destinations", async () => {
    await expect(
      validateWebhookUrl("https://hooks.example.com/events", {
        nodeEnv: "production",
        lookupAddresses: publicLookup,
      })
    ).resolves.toBeInstanceOf(URL);
  });

  it.each([
    "https://127.0.0.1/hook",
    "https://10.0.0.1/hook",
    "https://172.16.0.1/hook",
    "https://192.168.1.1/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/hook",
  ])("blocks private or metadata destination %s", async (url) => {
    await expect(validateWebhookUrl(url, { nodeEnv: "production" })).rejects.toThrow(
      /public address/
    );
  });

  it("blocks hostnames when any DNS answer is private", async () => {
    await expect(
      validateWebhookUrl("https://rebind.example/hook", {
        nodeEnv: "production",
        lookupAddresses: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.7", family: 4 },
        ],
      })
    ).rejects.toThrow(/public addresses/);
  });

  it("requires HTTPS in production and rejects credentials", async () => {
    await expect(
      validateWebhookUrl("http://hooks.example.com", {
        nodeEnv: "production",
        lookupAddresses: publicLookup,
      })
    ).rejects.toThrow(/HTTPS/);
    await expect(
      validateWebhookUrl("https://user:pass@hooks.example.com", {
        nodeEnv: "production",
        lookupAddresses: publicLookup,
      })
    ).rejects.toThrow(/credentials/);
  });
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("bullmq", () => {
  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    Queue: vi.fn(() => mockQueue),
    Worker: vi.fn(),
  };
});

vi.mock("../../src/database/connection.js", () => {
  const rows: Record<string, unknown>[] = [];

  const builder = (returnRows: unknown[] = rows) => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.where = vi.fn().mockReturnValue(b);
    b.whereNotNull = vi.fn().mockReturnValue(b);
    b.whereNot = vi.fn().mockReturnValue(b);
    b.orderBy = vi.fn().mockReturnValue(b);
    b.limit = vi.fn().mockResolvedValue(returnRows);
    b.first = vi.fn().mockResolvedValue(returnRows[0] ?? null);
    b.insert = vi.fn().mockReturnValue(b);
    b.update = vi.fn().mockResolvedValue(1);
    b.delete = vi.fn().mockResolvedValue(1);
    b.returning = vi.fn().mockResolvedValue(returnRows);
    return b;
  };

  return {
    getDatabase: vi.fn(() => {
      const fn = (table: string) => builder();
      fn.raw = vi.fn((v: string) => v);
      fn.fn = { now: () => new Date() };
      return fn;
    }),
  };
});

vi.mock("../../src/config/index.js", () => ({
  config: {
    REDIS_HOST: "localhost",
    REDIS_PORT: 6379,
    REDIS_PASSWORD: undefined,
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEndpointRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ep-1",
    owner_address: "GABC",
    url: "https://example.com/hook",
    name: "Test Endpoint",
    description: null,
    secret: "secret-abc",
    secret_rotated_at: null,
    is_active: true,
    rate_limit_per_minute: 60,
    custom_headers: "{}",
    filter_event_types: "[]",
    is_batch_delivery_enabled: false,
    batch_window_ms: 5000,
    consecutive_failures: 0,
    circuit_breaker_status: "closed",
    circuit_breaker_tripped_at: null,
    circuit_breaker_reset_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebhookService — HMAC signing", () => {
  let service: WebhookService;

  beforeEach(() => {
    // Reset singleton for isolated tests
    (WebhookService as any).instance = undefined;
    service = WebhookService.getInstance();
  });

  it("generates a 64-char hex secret", () => {
    const secret = service.generateSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signPayload produces consistent HMAC for same inputs", () => {
    const secret = "test-secret";
    const payload = '{"event":"test"}';
    const ts = 1700000000000;
    const sig1 = service.signPayload(payload, secret, ts);
    const sig2 = service.signPayload(payload, secret, ts);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signPayload produces different HMAC for different timestamps", () => {
    const secret = "test-secret";
    const payload = '{"event":"test"}';
    const sig1 = service.signPayload(payload, secret, 1000);
    const sig2 = service.signPayload(payload, secret, 2000);
    expect(sig1).not.toBe(sig2);
  });

  it("generateSignatureHeaders returns required headers", () => {
    const headers = service.generateSignatureHeaders('{"test":true}', "my-secret");
    expect(headers).toHaveProperty("X-Webhook-Signature");
    expect(headers).toHaveProperty("X-Webhook-Timestamp");
    expect(headers).toHaveProperty("X-Webhook-Event-Id");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("verifySignature rejects stale timestamps", () => {
    const secret = "my-secret";
    const payload = '{"data":1}';
    const oldTimestamp = (Date.now() - 600_000).toString(); // 10 min ago
    const sig = service.signPayload(payload, secret, parseInt(oldTimestamp, 10));
    const valid = service.verifySignature(payload, sig, oldTimestamp, secret);
    expect(valid).toBe(false);
  });

  it("verifySignature accepts fresh signatures", () => {
    const secret = "my-secret";
    const payload = '{"data":1}';
    const ts = Date.now();
    const sig = service.signPayload(payload, secret, ts);
    const valid = service.verifySignature(payload, sig, ts.toString(), secret);
    expect(valid).toBe(true);
  });
});

describe("WebhookService — rate limiting", () => {
  let service: WebhookService;

  beforeEach(() => {
    (WebhookService as any).instance = undefined;
    service = WebhookService.getInstance();
    // Clear internal map
    (service as any).rateLimitMap.clear();
  });

  it("allows requests up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(service.checkRateLimit("ep-1", 5)).toBe(true);
    }
  });

  it("rejects requests beyond the limit", () => {
    for (let i = 0; i < 5; i++) {
      service.checkRateLimit("ep-1", 5);
    }
    expect(service.checkRateLimit("ep-1", 5)).toBe(false);
  });

  it("tracks rate limits independently per endpoint", () => {
    for (let i = 0; i < 5; i++) {
      service.checkRateLimit("ep-1", 5);
    }
    expect(service.checkRateLimit("ep-2", 5)).toBe(true);
  });
});

describe("WebhookService — endpoint filtering", () => {
  let service: WebhookService;

  beforeEach(() => {
    (WebhookService as any).instance = undefined;
    service = WebhookService.getInstance();
  });

  it("mapToEndpoint parses JSON fields correctly", () => {
    const row = makeEndpointRow({
      custom_headers: JSON.stringify({ "X-Custom": "value" }),
      filter_event_types: JSON.stringify(["alert.triggered"]),
    });
    const endpoint = (service as any).mapToEndpoint(row);
    expect(endpoint.customHeaders).toEqual({ "X-Custom": "value" });
    expect(endpoint.filterEventTypes).toEqual(["alert.triggered"]);
  });

  it("mapToEndpoint handles already-parsed JSONB objects", () => {
    const row = makeEndpointRow({
      custom_headers: { "X-Test": "1" },
      filter_event_types: ["bridge.status_changed"],
    });
    const endpoint = (service as any).mapToEndpoint(row);
    expect(endpoint.customHeaders["X-Test"]).toBe("1");
    expect(endpoint.filterEventTypes[0]).toBe("bridge.status_changed");
  });
});

describe("WebhookService — singleton", () => {
  it("getInstance returns the same instance", () => {
    (WebhookService as any).instance = undefined;
    const a = WebhookService.getInstance();
    const b = WebhookService.getInstance();
    expect(a).toBe(b);
  });
});

describe("WebhookService — circuit breaker", () => {
  let service: WebhookService;

  beforeEach(() => {
    (WebhookService as any).instance = undefined;
    service = WebhookService.getInstance();
    service.removeAllListeners();
  });

  it("getCircuitBreakerState returns correct state for a closed breaker", () => {
    const endpoint = (service as any).mapToEndpoint(makeEndpointRow({
      consecutive_failures: 0,
      circuit_breaker_status: "closed",
    }));
    const state = service.getCircuitBreakerState(endpoint);
    expect(state.status).toBe("closed");
    expect(state.consecutiveFailures).toBe(0);
    expect(state.threshold).toBe(10);
    expect(state.trippedAt).toBeNull();
    expect(state.resetAt).toBeNull();
  });

  it("getCircuitBreakerState returns correct state for an open breaker", () => {
    const trippedAt = new Date();
    const endpoint = (service as any).mapToEndpoint(makeEndpointRow({
      consecutive_failures: 10,
      circuit_breaker_status: "open",
      circuit_breaker_tripped_at: trippedAt,
    }));
    const state = service.getCircuitBreakerState(endpoint);
    expect(state.status).toBe("open");
    expect(state.consecutiveFailures).toBe(10);
    expect(state.trippedAt).toBe(trippedAt);
  });

  it("mapToEndpoint parses new circuit breaker fields", () => {
    const trippedAt = new Date();
    const resetAt = new Date();
    const row = makeEndpointRow({
      consecutive_failures: 5,
      circuit_breaker_status: "half_open",
      circuit_breaker_tripped_at: trippedAt,
      circuit_breaker_reset_at: resetAt,
    });
    const endpoint = (service as any).mapToEndpoint(row);
    expect(endpoint.consecutiveFailures).toBe(5);
    expect(endpoint.circuitBreakerStatus).toBe("half_open");
    expect(endpoint.circuitBreakerTrippedAt).toBe(trippedAt);
    expect(endpoint.circuitBreakerResetAt).toBe(resetAt);
  });

  it("mapToEndpoint defaults circuit breaker fields when missing", () => {
    const row = makeEndpointRow({
      consecutive_failures: undefined,
      circuit_breaker_status: undefined,
      circuit_breaker_tripped_at: undefined,
      circuit_breaker_reset_at: undefined,
    });
    const endpoint = (service as any).mapToEndpoint(row);
    expect(endpoint.consecutiveFailures).toBe(0);
    expect(endpoint.circuitBreakerStatus).toBe("closed");
    expect(endpoint.circuitBreakerTrippedAt).toBeNull();
    expect(endpoint.circuitBreakerResetAt).toBeNull();
  });
});
