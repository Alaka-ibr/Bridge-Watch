import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SecretProviderHealthService,
} from "../../src/services/secretProviderHealth.service.js";

describe("SecretProviderHealthService Unit Tests", () => {
  let service: SecretProviderHealthService;

  beforeEach(() => {
    service = new SecretProviderHealthService();
    service.clearMemory();
    vi.clearAllMocks();
  });

  it("should register a new secret provider and execute health probe", async () => {
    const provider = await service.registerProvider({
      provider_type: "vault",
      name: "Staging Vault",
      endpoint: "https://vault-staging.internal:8200",
      is_primary: true,
    });

    expect(provider.id).toBeDefined();
    expect(provider.status).toBe("healthy");

    const probe = await service.checkProviderHealth(provider.id);
    expect(probe.status).toBe("healthy");
    expect(probe.checks.ping.passed).toBe(true);
  });

  it("should identify unreachable provider and set status to unhealthy", async () => {
    const provider = await service.registerProvider({
      provider_type: "vault",
      name: "Bad Vault",
      endpoint: "https://invalid-host-unreachable.internal",
    });

    const probe = await service.checkProviderHealth(provider.id);
    expect(probe.status).toBe("unhealthy");
    expect(probe.error_code).toBe("CONNECTION_REFUSED");
  });

  it("should generate health summary", async () => {
    const summary = await service.getSummary();
    expect(summary.totalProviders).toBeGreaterThan(0);
    expect(summary.primaryProviderHealthy).toBe(true);
  });
});
