import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { contractEventSubscriptionRegistryRoutes } from "../../src/api/routes/contractEventSubscriptionRegistry.routes.js";
import { contractEventSubscriptionRegistryService } from "../../src/services/contractEventSubscriptionRegistry.service.js";

describe("Contract Event Subscription Registry API Routes (#1199)", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify();
    await server.register(contractEventSubscriptionRegistryRoutes, {
      prefix: "/api/v1/contract-subscriptions",
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("POST /api/v1/contract-subscriptions creates a subscription", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/contract-subscriptions",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Test Registry Sub",
        contract_address: "CA12345",
        network: "stellar-mainnet",
        event_topics: ["deposit", "withdraw"],
        delivery_target: "websocket",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.subscription).toHaveProperty("id");
    expect(body.subscription.name).toBe("Test Registry Sub");
  });

  it("GET /api/v1/contract-subscriptions lists subscriptions", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/contract-subscriptions",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.subscriptions)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/v1/contract-subscriptions/stats/summary returns summary stats", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/contract-subscriptions/stats/summary",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("totalSubscriptions");
    expect(body).toHaveProperty("activeSubscriptions");
  });

  it("POST /api/v1/contract-subscriptions/:id/pause and /resume changes status", async () => {
    const list = await contractEventSubscriptionRegistryService.listSubscriptions();
    const subId = list.subscriptions[0].id;

    const pauseRes = await server.inject({
      method: "POST",
      url: `/api/v1/contract-subscriptions/${subId}/pause`,
    });
    expect(pauseRes.statusCode).toBe(200);
    expect(JSON.parse(pauseRes.body).subscription.status).toBe("paused");

    const resumeRes = await server.inject({
      method: "POST",
      url: `/api/v1/contract-subscriptions/${subId}/resume`,
    });
    expect(resumeRes.statusCode).toBe(200);
    expect(JSON.parse(resumeRes.body).subscription.status).toBe("active");
  });

  it("POST /api/v1/contract-subscriptions/:id/test-event performs dry run evaluation", async () => {
    const list = await contractEventSubscriptionRegistryService.listSubscriptions();
    const subId = list.subscriptions[0].id;

    const res = await server.inject({
      method: "POST",
      url: `/api/v1/contract-subscriptions/${subId}/test-event`,
      headers: { "content-type": "application/json" },
      payload: {
        id: "evt_test",
        contract_address: "CA12345",
        network: "stellar-mainnet",
        topic: "deposit",
        data: { amount: 100 },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.matches).toBe(true);
  });
});
