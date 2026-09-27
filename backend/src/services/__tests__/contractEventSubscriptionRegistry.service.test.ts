import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ContractEventSubscriptionRegistryService,
} from "../contractEventSubscriptionRegistry.service.js";
import type { IncomingContractEvent } from "../../types/contractEventSubscription.js";

vi.mock("../../database/connection.js", () => {
  const mockDb: any = vi.fn().mockImplementation(() => mockDb);
  mockDb.schema = { hasTable: vi.fn().mockResolvedValue(true) };
  mockDb.where = vi.fn().mockReturnValue(mockDb);
  mockDb.whereILike = vi.fn().mockReturnValue(mockDb);
  mockDb.andWhere = vi.fn().mockReturnValue(mockDb);
  mockDb.update = vi.fn().mockResolvedValue(1);
  mockDb.insert = vi.fn().mockResolvedValue([1]);
  mockDb.delete = vi.fn().mockResolvedValue(1);
  mockDb.select = vi.fn().mockResolvedValue([]);
  mockDb.first = vi.fn().mockResolvedValue(null);
  mockDb.orderBy = vi.fn().mockReturnValue(mockDb);
  mockDb.limit = vi.fn().mockReturnValue(mockDb);
  mockDb.offset = vi.fn().mockResolvedValue([]);
  mockDb.clone = vi.fn().mockReturnValue(mockDb);
  mockDb.count = vi.fn().mockReturnValue(mockDb);
  mockDb.raw = vi.fn((str) => str);
  return { getDatabase: () => mockDb };
});

describe("ContractEventSubscriptionRegistryService", () => {
  let service: ContractEventSubscriptionRegistryService;

  beforeEach(() => {
    service = new ContractEventSubscriptionRegistryService();
    service.clearMemory();
    vi.clearAllMocks();
  });

  describe("Validation and Creation", () => {
    it("should create a valid contract event subscription", async () => {
      const sub = await service.createSubscription({
        name: "USDC Bridge Deposits",
        description: "Monitors deposit events for USDC bridge contract",
        contract_address: "CA3D5KRYMCMV244BH7AVWDTNO",
        network: "stellar-mainnet",
        event_topics: ["deposit", "mint"],
        delivery_target: "webhook",
        delivery_config: { webhookUrl: "https://example.com/webhooks/bridge" },
      });

      expect(sub.id).toBeDefined();
      expect(sub.name).toBe("USDC Bridge Deposits");
      expect(sub.status).toBe("active");
      expect(sub.event_topics).toEqual(["deposit", "mint"]);
    });

    it("should throw validation error when name or contract_address is missing", async () => {
      await expect(
        service.createSubscription({
          name: "",
          contract_address: "CA123",
          event_topics: ["deposit"],
          delivery_target: "webhook",
          delivery_config: { webhookUrl: "https://example.com" },
        })
      ).rejects.toThrow("Subscription name is required");

      await expect(
        service.createSubscription({
          name: "Test",
          contract_address: "",
          event_topics: ["deposit"],
          delivery_target: "webhook",
          delivery_config: { webhookUrl: "https://example.com" },
        })
      ).rejects.toThrow("Contract address is required");
    });

    it("should validate webhook delivery URL", async () => {
      await expect(
        service.createSubscription({
          name: "Test Sub",
          contract_address: "CA123",
          event_topics: ["deposit"],
          delivery_target: "webhook",
          delivery_config: { webhookUrl: "invalid-url" },
        })
      ).rejects.toThrow("A valid HTTP/HTTPS webhook URL is required");
    });
  });

  describe("Lifecycle and Management", () => {
    it("should update, pause and resume subscriptions", async () => {
      const sub = await service.createSubscription({
        name: "ETH Bridge Monitor",
        contract_address: "CETH123",
        event_topics: ["lock", "burn"],
        delivery_target: "websocket",
      });

      const updated = await service.updateSubscription(sub.id, {
        name: "ETH Bridge Monitor (Updated)",
        rate_limit_per_min: 120,
      });
      expect(updated.name).toBe("ETH Bridge Monitor (Updated)");
      expect(updated.rate_limit_per_min).toBe(120);

      const paused = await service.pauseSubscription(sub.id);
      expect(paused.status).toBe("paused");

      const resumed = await service.resumeSubscription(sub.id);
      expect(resumed.status).toBe("active");
    });

    it("should delete subscription", async () => {
      const sub = await service.createSubscription({
        name: "Temporary Sub",
        contract_address: "CTEMP123",
        event_topics: ["test"],
        delivery_target: "websocket",
      });

      const deleted = await service.deleteSubscription(sub.id);
      expect(deleted).toBe(true);

      const fetched = await service.getSubscription(sub.id);
      expect(fetched).toBeNull();
    });
  });

  describe("Event Filtering and Matching Rules", () => {
    it("should match events on contract address and topic", async () => {
      const sub = await service.createSubscription({
        name: "Filter Sub",
        contract_address: "CAAAA1111",
        network: "stellar-mainnet",
        event_topics: ["deposit"],
        delivery_target: "websocket",
      });

      const matchingEvent: IncomingContractEvent = {
        id: "evt_1",
        contract_address: "CAAAA1111",
        network: "stellar-mainnet",
        topic: "deposit",
        data: { amount: 1000, sender: "GUSER1" },
      };

      expect(service.matchEvent(sub, matchingEvent)).toBe(true);

      const nonMatchingTopic: IncomingContractEvent = {
        id: "evt_2",
        contract_address: "CAAAA1111",
        network: "stellar-mainnet",
        topic: "withdraw",
        data: { amount: 1000 },
      };

      expect(service.matchEvent(sub, nonMatchingTopic)).toBe(false);
    });

    it("should evaluate complex rule conditions (operators: gt, eq, in)", async () => {
      const sub = await service.createSubscription({
        name: "Whale Deposit Alert",
        contract_address: "CAAAA1111",
        network: "stellar-mainnet",
        event_topics: ["deposit"],
        filter_rules: {
          operator: "AND",
          rules: [
            { field: "amount", operator: "gt", value: 50000 },
            { field: "asset", operator: "eq", value: "USDC" },
          ],
        },
        delivery_target: "websocket",
      });

      const whaleEvent: IncomingContractEvent = {
        id: "evt_whale",
        contract_address: "CAAAA1111",
        network: "stellar-mainnet",
        topic: "deposit",
        data: { amount: 100000, asset: "USDC" },
      };

      const smallEvent: IncomingContractEvent = {
        id: "evt_small",
        contract_address: "CAAAA1111",
        network: "stellar-mainnet",
        topic: "deposit",
        data: { amount: 1000, asset: "USDC" },
      };

      expect(service.matchEvent(sub, whaleEvent)).toBe(true);
      expect(service.matchEvent(sub, smallEvent)).toBe(false);
    });

    it("should dry-run testEvent with evaluated rules diagnostics", async () => {
      const sub = await service.createSubscription({
        name: "Test Sub",
        contract_address: "CABC123",
        event_topics: ["mint"],
        filter_rules: {
          rules: [{ field: "amount", operator: "gte", value: 100 }],
        },
        delivery_target: "websocket",
      });

      const testRes = await service.testEvent(sub.id, {
        id: "test_1",
        contract_address: "CABC123",
        network: "stellar-mainnet",
        topic: "mint",
        data: { amount: 150 },
      });

      expect(testRes.matches).toBe(true);
      expect(testRes.evaluatedRules).toHaveLength(1);
      expect(testRes.evaluatedRules[0].passed).toBe(true);
    });
  });

  describe("Delivery Logging & Metrics", () => {
    it("should record delivery logs and aggregate stats", async () => {
      const sub = await service.createSubscription({
        name: "Stats Sub",
        contract_address: "CSTATS",
        event_topics: ["burn"],
        delivery_target: "websocket",
      });

      await service.recordDelivery(sub.id, {
        subscription_id: sub.id,
        event_id: "evt_001",
        contract_address: "CSTATS",
        topic: "burn",
        payload: { amount: 50 },
        delivery_status: "delivered",
        status_code: 200,
        latency_ms: 35,
        error_message: null,
        attempt: 1,
      });

      const deliveryHistory = await service.getDeliveryLogs(sub.id);
      expect(deliveryHistory.total).toBe(1);
      expect(deliveryHistory.logs[0].delivery_status).toBe("delivered");

      const stats = await service.getStats();
      expect(stats.totalSubscriptions).toBe(1);
      expect(stats.successfulDeliveries).toBe(1);
    });
  });
});
