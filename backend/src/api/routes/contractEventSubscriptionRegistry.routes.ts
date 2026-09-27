import type { FastifyInstance } from "fastify";
import {
  contractEventSubscriptionRegistryService,
} from "../../services/contractEventSubscriptionRegistry.service.js";
import type {
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  IncomingContractEvent,
} from "../../types/contractEventSubscription.js";

const subscriptionSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    contract_address: { type: "string" },
    network: { type: "string" },
    event_topics: { type: "array", items: { type: "string" } },
    filter_rules: { type: "object", additionalProperties: true },
    delivery_target: { type: "string" },
    delivery_config: { type: "object", additionalProperties: true },
    status: { type: "string" },
    rate_limit_per_min: { type: "number" },
    retry_limit: { type: "number" },
    batch_size: { type: "number" },
    delivered_count: { type: "number" },
    failed_count: { type: "number" },
    last_delivered_at: { type: ["string", "null"] },
    last_failure_reason: { type: ["string", "null"] },
    created_by: { type: "string" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

export async function contractEventSubscriptionRegistryRoutes(server: FastifyInstance) {
  // GET /api/v1/contract-subscriptions - List with filters and pagination
  server.get<{
    Querystring: {
      network?: string;
      contract_address?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
    };
  }>(
    "/",
    {
      schema: {
        tags: ["Contract Event Subscriptions"],
        summary: "List all contract event subscriptions with filtering",
        querystring: {
          type: "object",
          properties: {
            network: { type: "string" },
            contract_address: { type: "string" },
            status: { type: "string" },
            search: { type: "string" },
            limit: { type: "number", default: 50 },
            offset: { type: "number", default: 0 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              subscriptions: { type: "array", items: subscriptionSchema },
              total: { type: "number" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await contractEventSubscriptionRegistryService.listSubscriptions(request.query);
      return reply.send(result);
    }
  );

  // GET /api/v1/contract-subscriptions/stats/summary - Overview statistics
  server.get(
    "/stats/summary",
    {
      schema: {
        tags: ["Contract Event Subscriptions"],
        summary: "Get aggregate subscription metrics and delivery counts",
        response: {
          200: {
            type: "object",
            properties: {
              totalSubscriptions: { type: "number" },
              activeSubscriptions: { type: "number" },
              pausedSubscriptions: { type: "number" },
              erroredSubscriptions: { type: "number" },
              totalDeliveries: { type: "number" },
              successfulDeliveries: { type: "number" },
              failedDeliveries: { type: "number" },
              averageLatencyMs: { type: "number" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const stats = await contractEventSubscriptionRegistryService.getStats();
      return reply.send(stats);
    }
  );

  // GET /api/v1/contract-subscriptions/:id - Get single subscription
  server.get<{
    Params: { id: string };
  }>(
    "/:id",
    {
      schema: {
        tags: ["Contract Event Subscriptions"],
        summary: "Get details of a contract event subscription",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { subscription: subscriptionSchema } },
          404: {
            type: "object",
            properties: { error: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const subscription = await contractEventSubscriptionRegistryService.getSubscription(request.params.id);
      if (!subscription) {
        return reply.status(404).send({ error: "NotFound", message: `Subscription ${request.params.id} not found` });
      }
      return reply.send({ subscription });
    }
  );

  // POST /api/v1/contract-subscriptions - Create subscription
  server.post<{
    Body: CreateSubscriptionInput;
  }>(
    "/",
    {
      schema: {
        tags: ["Contract Event Subscriptions"],
        summary: "Register a new contract event subscription",
        body: {
          type: "object",
          required: ["name", "contract_address", "event_topics", "delivery_target"],
          properties: {
            name: { type: "string", minLength: 1 },
            description: { type: "string" },
            contract_address: { type: "string", minLength: 1 },
            network: { type: "string", default: "stellar-mainnet" },
            event_topics: { type: "array", items: { type: "string" }, minItems: 1 },
            filter_rules: { type: "object", additionalProperties: true },
            delivery_target: { type: "string", enum: ["webhook", "websocket", "queue", "kafka", "alert"] },
            delivery_config: { type: "object", additionalProperties: true },
            rate_limit_per_min: { type: "number", default: 60 },
            retry_limit: { type: "number", default: 3 },
            batch_size: { type: "number", default: 1 },
            created_by: { type: "string" },
          },
        },
        response: {
          201: { type: "object", properties: { subscription: subscriptionSchema } },
          400: {
            type: "object",
            properties: { error: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const subscription = await contractEventSubscriptionRegistryService.createSubscription(request.body);
        return reply.status(201).send({ subscription });
      } catch (err: any) {
        return reply.status(400).send({ error: "BadRequest", message: err.message || "Failed to create subscription" });
      }
    }
  );

  // PUT /api/v1/contract-subscriptions/:id - Update subscription
  server.put<{
    Params: { id: string };
    Body: UpdateSubscriptionInput;
  }>(
    "/:id",
    {
      schema: {
        tags: ["Contract Event Subscriptions"],
        summary: "Update an existing contract event subscription",
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
            contract_address: { type: "string" },
            network: { type: "string" },
            event_topics: { type: "array", items: { type: "string" } },
            filter_rules: { type: "object", additionalProperties: true },
            delivery_target: { type: "string" },
            delivery_config: { type: "object", additionalProperties: true },
            status: { type: "string", enum: ["active", "paused", "disabled", "errored"] },
            rate_limit_per_min: { type: "number" },
            retry_limit: { type: "number" },
            batch_size: { type: "number" },
          },
        },
        response: {
          200: { type: "object", properties: { subscription: subscriptionSchema } },
          404: {
            type: "object",
            properties: { error: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const updated = await contractEventSubscriptionRegistryService.updateSubscription(
          request.params.id,
          request.body
        );
        return reply.send({ subscription: updated });
      } catch (err: any) {
        return reply.status(404).send({ error: "NotFound", message: err.message });
      }
    }
  );

  // DELETE /api/v1/contract-subscriptions/:id - Delete subscription
  server.delete<{
    Params: { id: string };
  }>(
    "/:id",
    {
      schema: {
        tags: ["Contract Event Subscriptions"],
        summary: "Delete a contract event subscription",
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
      const deleted = await contractEventSubscriptionRegistryService.deleteSubscription(request.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: "NotFound", message: `Subscription ${request.params.id} not found` });
      }
      return reply.send({ success: true });
    }
  );

  // POST /api/v1/contract-subscriptions/:id/pause - Pause subscription
  server.post<{
    Params: { id: string };
  }>(
    "/:id/pause",
    {
      schema: {
        tags: ["Contract Event Subscriptions"],
        summary: "Pause event delivery for a subscription",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { subscription: subscriptionSchema } },
        },
      },
    },
    async (request, reply) => {
      try {
        const updated = await contractEventSubscriptionRegistryService.pauseSubscription(request.params.id);
        return reply.send({ subscription: updated });
      } catch (err: any) {
        return reply.status(404).send({ error: "NotFound", message: err.message });
      }
    }
  );

  // POST /api/v1/contract-subscriptions/:id/resume - Resume subscription
  server.post<{
    Params: { id: string };
  }>(
    "/:id/resume",
    {
      schema: {
        tags: ["Contract Event Subscriptions"],
        summary: "Resume event delivery for a paused subscription",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { subscription: subscriptionSchema } },
        },
      },
    },
    async (request, reply) => {
      try {
        const updated = await contractEventSubscriptionRegistryService.resumeSubscription(request.params.id);
        return reply.send({ subscription: updated });
      } catch (err: any) {
        return reply.status(404).send({ error: "NotFound", message: err.message });
      }
    }
  );

  // POST /api/v1/contract-subscriptions/:id/test-event - Test event match dry-run
  server.post<{
    Params: { id: string };
    Body: IncomingContractEvent;
  }>(
    "/:id/test-event",
    {
      schema: {
        tags: ["Contract Event Subscriptions"],
        summary: "Dry-run evaluate a sample contract event against subscription rules",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["id", "contract_address", "network", "topic", "data"],
          properties: {
            id: { type: "string" },
            contract_address: { type: "string" },
            network: { type: "string" },
            topic: { type: "string" },
            data: { type: "object", additionalProperties: true },
            ledger_sequence: { type: "number" },
            tx_hash: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              matches: { type: "boolean" },
              reason: { type: "string" },
              evaluatedRules: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string" },
                    passed: { type: "boolean" },
                    expected: {},
                    actual: {},
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await contractEventSubscriptionRegistryService.testEvent(
        request.params.id,
        request.body
      );
      return reply.send(result);
    }
  );

  // GET /api/v1/contract-subscriptions/:id/deliveries - Delivery logs
  server.get<{
    Params: { id: string };
    Querystring: { limit?: number; offset?: number };
  }>(
    "/:id/deliveries",
    {
      schema: {
        tags: ["Contract Event Subscriptions"],
        summary: "Get delivery logs and dispatch attempts for a subscription",
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
                    subscription_id: { type: "string" },
                    event_id: { type: "string" },
                    contract_address: { type: "string" },
                    topic: { type: "string" },
                    payload: { type: "object", additionalProperties: true },
                    delivery_status: { type: "string" },
                    status_code: { type: ["number", "null"] },
                    latency_ms: { type: ["number", "null"] },
                    error_message: { type: ["string", "null"] },
                    attempt: { type: "number" },
                    created_at: { type: "string" },
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
      const logs = await contractEventSubscriptionRegistryService.getDeliveryLogs(
        request.params.id,
        request.query.limit,
        request.query.offset
      );
      return reply.send(logs);
    }
  );
}
