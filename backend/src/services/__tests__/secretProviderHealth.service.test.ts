import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SecretProviderHealthService,
} from "../secretProviderHealth.service.js";

vi.mock("../../database/connection.js", () => {
  const mockDb: any = vi.fn().mockImplementation(() => mockDb);
  mockDb.schema = { hasTable: vi.fn().mockResolvedValue(true) };
  mockDb.where = vi.fn().mockReturnValue(mockDb);
  mockDb.whereNot = vi.fn().mockReturnValue(mockDb);
  mockDb.update = vi.fn().mockResolvedValue(1);
  mockDb.insert = vi.fn().mockResolvedValue([1]);
  mockDb.delete = vi.fn().mockResolvedValue(1);
  mockDb.select = vi.fn().mockResolvedValue([]);
  mockDb.first = vi.fn().mockResolvedValue(null);
  mockDb.orderBy = vi.fn().mockReturnValue(mockDb);
  mockDb.limit = vi.fn().mockReturnValue(mockDb);
  mockDb.offset = vi.fn().mockResolvedValue([]);
  mockDb.count = vi.fn().mockReturnValue(mockDb);
  mockDb.raw = vi.fn((str) => str);
  return { getDatabase: () => mockDb };
});

describe("SecretProviderHealthService", () => {
  let service: SecretProviderHealthService;

  beforeEach(() => {
    service = new SecretProviderHealthService();
    service.clearMemory();
    vi.clearAllMocks();
  });

  describe("Provider Registration & Management", () => {
    it("should register a new secret provider", async () => {
      const provider = await service.registerProvider({
        provider_type: "vault",
        name: "Staging Vault",
        endpoint: "https://vault-staging.internal:8200",
        is_primary: true,
        config: { vaultNamespace: "bridge/staging" },
      });

      expect(provider.id).toBeDefined();
      expect(provider.name).toBe("Staging Vault");
      expect(provider.is_primary).toBe(true);
      expect(provider.status).toBe("healthy");
    });

    it("should list registered providers", async () => {
      const list = await service.listProviders();
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.some((p) => p.provider_type === "vault")).toBe(true);
    });

    it("should update secret provider config", async () => {
      const provider = await service.registerProvider({
        provider_type: "gcp_secret_manager",
        name: "GCP Provider",
        endpoint: "https://secretmanager.googleapis.com",
      });

      const updated = await service.updateProvider(provider.id, {
        name: "GCP Provider (Updated)",
        config: { projectId: "stellar-bridge-prod" },
      });

      expect(updated.name).toBe("GCP Provider (Updated)");
      expect(updated.config.projectId).toBe("stellar-bridge-prod");
    });

    it("should delete provider", async () => {
      const provider = await service.registerProvider({
        provider_type: "azure_key_vault",
        name: "Azure KV",
        endpoint: "https://kv.vault.azure.net",
      });

      const deleted = await service.deleteProvider(provider.id);
      expect(deleted).toBe(true);

      const found = await service.getProvider(provider.id);
      expect(found).toBeNull();
    });
  });

  describe("Health Probing & Error Classification", () => {
    it("should execute health check on provider and produce structured check details", async () => {
      const provider = await service.registerProvider({
        provider_type: "vault",
        name: "Vault Prod",
        endpoint: "https://vault.internal:8200",
      });

      const log = await service.checkProviderHealth(provider.id);
      expect(log.provider_id).toBe(provider.id);
      expect(log.status).toBe("healthy");
      expect(log.checks.ping.passed).toBe(true);
      expect(log.checks.auth.passed).toBe(true);
      expect(log.latency_ms).toBeGreaterThan(0);
    });

    it("should classify unreachable hosts with CONNECTION_REFUSED", async () => {
      const provider = await service.registerProvider({
        provider_type: "vault",
        name: "Unreachable Vault",
        endpoint: "https://invalid-host-unreachable.internal",
      });

      const log = await service.checkProviderHealth(provider.id);
      expect(log.status).toBe("unhealthy");
      expect(log.error_code).toBe("CONNECTION_REFUSED");
      expect(log.checks.ping.passed).toBe(false);
    });

    it("should classify expired tokens with AUTH_EXPIRED", async () => {
      const provider = await service.registerProvider({
        provider_type: "vault",
        name: "Expired Token Vault",
        endpoint: "https://vault.internal:8200",
        config: { vaultNamespace: "expired-token-scope" },
      });

      const log = await service.checkProviderHealth(provider.id);
      expect(log.status).toBe("unhealthy");
      expect(log.error_code).toBe("AUTH_EXPIRED");
    });

    it("should batch check all providers and return summary", async () => {
      const { results, summary } = await service.checkAllProviders();
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(summary.totalProviders).toBeGreaterThanOrEqual(1);
      expect(summary.lastCheckTimestamp).toBeDefined();
    });
  });
});
