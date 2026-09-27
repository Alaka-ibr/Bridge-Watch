import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ContractEventSubscriptionRegistryService,
} from "../../src/services/contractEventSubscriptionRegistry.service.js";
import type { IncomingContractEvent } from "../../src/types/contractEventSubscription.js";

describe("ContractEventSubscriptionRegistryService Unit Tests", () => {
  let service: ContractEventSubscriptionRegistryService;

  beforeEach(() => {
    service = new ContractEventSubscriptionRegistryService();
    service.clearMemory();
    vi.clearAllMocks();
  });

  it("should create and retrieve a subscription", async () => {
    const sub = await service.createSubscription({
      name: "Stellar Deposit Monitor",
      contract_address: "CAAA111",
      network: "stellar-mainnet",
      event_topics: ["deposit"],
      delivery_target: "webhook",
      delivery_config: { webhookUrl: "https://api.test/webhook" },
    });

    expect(sub.id).toBeDefined();
    expect(sub.name).toBe("Stellar Deposit Monitor");

    const fetched = await service.getSubscription(sub.id);
    expect(fetched?.id).toBe(sub.id);
  });

  it("should filter events accurately by topic and amount thresholds", async () => {
    const sub = await service.createSubscription({
      name: "Large Mint Monitor",
      contract_address: "CMINT123",
      event_topics: ["mint"],
      filter_rules: {
        rules: [{ field: "amount", operator: "gte", value: 1000 }],
      },
      delivery_target: "websocket",
    });

    const passEvent: IncomingContractEvent = {
      id: "evt_p",
      contract_address: "CMINT123",
      network: "stellar-mainnet",
      topic: "mint",
      data: { amount: 2500 },
    };

    const failEvent: IncomingContractEvent = {
      id: "evt_f",
      contract_address: "CMINT123",
      network: "stellar-mainnet",
      topic: "mint",
      data: { amount: 500 },
    };

    expect(service.matchEvent(sub, passEvent)).toBe(true);
    expect(service.matchEvent(sub, failEvent)).toBe(false);
  });

  it("should record delivery logs and compute stats", async () => {
    const sub = await service.createSubscription({
      name: "Delivery Test Sub",
      contract_address: "CDEL123",
      event_topics: ["transfer"],
      delivery_target: "websocket",
    });

    await service.recordDelivery(sub.id, {
      subscription_id: sub.id,
      event_id: "evt_100",
      contract_address: "CDEL123",
      topic: "transfer",
      payload: { value: 100 },
      delivery_status: "delivered",
      latency_ms: 15,
      attempt: 1,
    });

    const { logs, total } = await service.getDeliveryLogs(sub.id);
    expect(total).toBe(1);
    expect(logs[0].delivery_status).toBe("delivered");

    const stats = await service.getStats();
    expect(stats.totalDeliveries).toBe(1);
  });
});
