import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { secretProviderHealthRoutes } from "../../src/api/routes/secretProviderHealth.routes.js";

describe("Secret Provider Health API Routes (#1190)", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify();
    await server.register(secretProviderHealthRoutes, {
      prefix: "/api/v1/secret-providers",
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("GET /api/v1/secret-providers returns list of providers", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/secret-providers",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.providers.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/v1/secret-providers/summary returns health overview", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/secret-providers/summary",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("totalProviders");
    expect(body).toHaveProperty("healthyCount");
    expect(body).toHaveProperty("averageLatencyMs");
  });

  it("POST /api/v1/secret-providers registers a new provider", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/secret-providers",
      headers: { "content-type": "application/json" },
      payload: {
        provider_type: "aws_secrets_manager",
        name: "Secondary AWS SM",
        endpoint: "https://secretsmanager.us-west-2.amazonaws.com",
        is_primary: false,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.provider.name).toBe("Secondary AWS SM");
    expect(body.provider.status).toBe("healthy");
  });

  it("POST /api/v1/secret-providers/:id/check triggers on-demand probe", async () => {
    const listRes = await server.inject({ method: "GET", url: "/api/v1/secret-providers" });
    const providerId = JSON.parse(listRes.body).providers[0].id;

    const res = await server.inject({
      method: "POST",
      url: `/api/v1/secret-providers/${providerId}/check`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.log).toHaveProperty("status");
    expect(body.log).toHaveProperty("checks");
  });
});
