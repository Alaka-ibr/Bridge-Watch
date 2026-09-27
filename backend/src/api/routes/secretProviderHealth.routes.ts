import type { FastifyInstance } from "fastify";
import {
  secretProviderHealthService,
} from "../../services/secretProviderHealth.service.js";
import type {
  RegisterSecretProviderInput,
  UpdateSecretProviderInput,
} from "../../types/secretProvider.js";

const providerSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    provider_type: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    endpoint: { type: "string" },
    status: { type: "string" },
    is_primary: { type: "boolean" },
    fallback_provider_id: { type: ["string", "null"] },
    token_ttl_seconds: { type: ["number", "null"] },
    consecutive_failures: { type: "number" },
    last_latency_ms: { type: ["number", "null"] },
    last_error: { type: ["string", "null"] },
    tls_expiry_date: { type: ["string", "null"] },
    last_checked_at: { type: ["string", "null"] },
    config: { type: "object", additionalProperties: true },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

export async function secretProviderHealthRoutes(server: FastifyInstance) {
  // GET /api/v1/secret-providers - List all secret providers
  server.get(
    "/",
    {
      schema: {
        tags: ["Secret Providers"],
        summary: "List all registered secret providers with live health status",
        response: {
          200: {
            type: "object",
            properties: {
              providers: { type: "array", items: providerSchema },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const providers = await secretProviderHealthService.listProviders();
      return reply.send({ providers });
    }
  );

  // GET /api/v1/secret-providers/summary - Overview stats
  server.get(
    "/summary",
    {
      schema: {
        tags: ["Secret Providers"],
        summary: "Get overall health summary, latency stats, and failover status",
        response: {
          200: {
            type: "object",
            properties: {
              totalProviders: { type: "number" },
              healthyCount: { type: "number" },
              degradedCount: { type: "number" },
              unhealthyCount: { type: "number" },
              primaryProviderHealthy: { type: "boolean" },
              primaryProviderId: { type: "string" },
              activeFailover: { type: "boolean" },
              averageLatencyMs: { type: "number" },
              lastCheckTimestamp: { type: "string" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const summary = await secretProviderHealthService.getSummary();
      return reply.send(summary);
    }
  );

  // GET /api/v1/secret-providers/:id - Single provider details
  server.get<{
    Params: { id: string };
  }>(
    "/:id",
    {
      schema: {
        tags: ["Secret Providers"],
        summary: "Get secret provider configuration and health details",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { provider: providerSchema } },
          404: {
            type: "object",
            properties: { error: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const provider = await secretProviderHealthService.getProvider(request.params.id);
      if (!provider) {
        return reply.status(404).send({ error: "NotFound", message: `Secret provider ${request.params.id} not found` });
      }
      return reply.send({ provider });
    }
  );

  // POST /api/v1/secret-providers - Register provider
  server.post<{
    Body: RegisterSecretProviderInput;
  }>(
    "/",
    {
      schema: {
        tags: ["Secret Providers"],
        summary: "Register a new external secret provider",
        body: {
          type: "object",
          required: ["name", "provider_type", "endpoint"],
          properties: {
            name: { type: "string", minLength: 1 },
            description: { type: "string" },
            provider_type: {
              type: "string",
              enum: [
                "vault",
                "aws_secrets_manager",
                "gcp_secret_manager",
                "azure_key_vault",
                "kubernetes_secrets",
                "environment",
              ],
            },
            endpoint: { type: "string", minLength: 1 },
            is_primary: { type: "boolean" },
            fallback_provider_id: { type: "string" },
            config: { type: "object", additionalProperties: true },
          },
        },
        response: {
          201: { type: "object", properties: { provider: providerSchema } },
          400: {
            type: "object",
            properties: { error: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const provider = await secretProviderHealthService.registerProvider(request.body);
        return reply.status(201).send({ provider });
      } catch (err: any) {
        return reply.status(400).send({ error: "BadRequest", message: err.message });
      }
    }
  );

  // PUT /api/v1/secret-providers/:id - Update provider
  server.put<{
    Params: { id: string };
    Body: UpdateSecretProviderInput;
  }>(
    "/:id",
    {
      schema: {
        tags: ["Secret Providers"],
        summary: "Update secret provider configuration",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            endpoint: { type: "string" },
            is_primary: { type: "boolean" },
            fallback_provider_id: { type: ["string", "null"] },
            config: { type: "object", additionalProperties: true },
            status: { type: "string", enum: ["healthy", "degraded", "unhealthy", "unknown"] },
          },
        },
        response: {
          200: { type: "object", properties: { provider: providerSchema } },
          404: {
            type: "object",
            properties: { error: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const updated = await secretProviderHealthService.updateProvider(request.params.id, request.body);
        return reply.send({ provider: updated });
      } catch (err: any) {
        return reply.status(404).send({ error: "NotFound", message: err.message });
      }
    }
  );

  // DELETE /api/v1/secret-providers/:id - Delete provider
  server.delete<{
    Params: { id: string };
  }>(
    "/:id",
    {
      schema: {
        tags: ["Secret Providers"],
        summary: "Deregister a secret provider",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { success: { type: "boolean" } } },
          404: {
            type: "object",
            properties: { error: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const deleted = await secretProviderHealthService.deleteProvider(request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: "NotFound", message: `Secret provider ${request.params.id} not found` });
      }
      return reply.send({ success: true });
    }
  );

  // POST /api/v1/secret-providers/:id/check - Trigger on-demand health probe
  server.post<{
    Params: { id: string };
  }>(
    "/:id/check",
    {
      schema: {
        tags: ["Secret Providers"],
        summary: "Trigger immediate health probe on specific secret provider",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              log: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  provider_id: { type: "string" },
                  status: { type: "string" },
                  latency_ms: { type: "number" },
                  error_code: { type: ["string", "null"] },
                  error_message: { type: ["string", "null"] },
                  checks: { type: "object", additionalProperties: true },
                  timestamp: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const log = await secretProviderHealthService.checkProviderHealth(request.params.id);
        return reply.send({ log });
      } catch (err: any) {
        return reply.status(404).send({ error: "NotFound", message: err.message });
      }
    }
  );

  // POST /api/v1/secret-providers/check-all - Check all providers
  server.post(
    "/check-all",
    {
      schema: {
        tags: ["Secret Providers"],
        summary: "Run health probe across all registered secret providers",
        response: {
          200: {
            type: "object",
            properties: {
              results: { type: "array", items: { type: "object", additionalProperties: true } },
              summary: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const result = await secretProviderHealthService.checkAllProviders();
      return reply.send(result);
    }
  );

  // GET /api/v1/secret-providers/:id/history - Health probe history
  server.get<{
    Params: { id: string };
    Querystring: { limit?: number; offset?: number };
  }>(
    "/:id/history",
    {
      schema: {
        tags: ["Secret Providers"],
        summary: "Get historical health check logs for provider",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "number", default: 20 },
            offset: { type: "number", default: 0 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              logs: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    provider_id: { type: "string" },
                    status: { type: "string" },
                    latency_ms: { type: "number" },
                    error_code: { type: ["string", "null"] },
                    error_message: { type: ["string", "null"] },
                    checks: { type: "object", additionalProperties: true },
                    timestamp: { type: "string" },
                  },
                },
              },
              total: { type: "number" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const history = await secretProviderHealthService.getHealthLogs(
        request.params.id,
        request.query.limit,
        request.query.offset
      );
      return reply.send(history);
    }
  );
}
