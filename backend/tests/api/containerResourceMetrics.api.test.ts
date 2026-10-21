import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { containerResourceMetricsRoutes } from "../../src/api/routes/containerResourceMetrics.routes.js";

describe("Container Resource Metrics API Routes (#1191)", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify();
    await server.register(containerResourceMetricsRoutes, {
      prefix: "/api/v1/container-metrics",
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("GET /api/v1/container-metrics/live returns full overview with containers & alerts", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/container-metrics/live",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("totalContainers");
    expect(body).toHaveProperty("totalCpuCapacityMillicores");
    expect(body).toHaveProperty("totalMemoryCapacityBytes");
    expect(Array.isArray(body.containers)).toBe(true);
    expect(body.containers.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/container-metrics/history returns time-series metrics", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/container-metrics/history?container_name=bridge-watch-api&range_hours=12",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.metrics)).toBe(true);
    expect(body.metrics.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/container-metrics/recommendations returns right-sizing analysis", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/v1/container-metrics/recommendations",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.recommendations)).toBe(true);
    expect(body.recommendations.length).toBeGreaterThan(0);
    expect(body.recommendations[0]).toHaveProperty("recommended_cpu_limit_millicores");
  });

  it("POST /api/v1/container-metrics/sample ingests telemetry sample", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/container-metrics/sample",
      headers: { "content-type": "application/json" },
      payload: {
        container_id: "test_telemetry_1",
        container_name: "bridge-watch-custom-worker",
        service_name: "worker",
        cpu_usage_millicores: 350,
        cpu_limit_millicores: 1000,
        memory_usage_bytes: 450000000,
        memory_limit_bytes: 1073741824,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body).toHaveProperty("sampleId");
  });
});
