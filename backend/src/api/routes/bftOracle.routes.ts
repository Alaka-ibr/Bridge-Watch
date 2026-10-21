// @ts-nocheck
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { bftOracleAggregatorService } from "../../services/bftOracleAggregator.service.js";

const reportItemSchema = z.object({
  providerKey: z.string().min(1),
  price: z.number().positive(),
  healthScore: z.number().optional(),
  timestamp: z.string().optional().default(() => new Date().toISOString()),
  signature: z.string().optional(),
});

const aggregateSchema = z.object({
  assetCode: z.string().min(1),
  reports: z.array(reportItemSchema).min(1),
});

const registerNodeSchema = z.object({
  providerKey: z.string().min(1),
  displayName: z.string().min(1),
  publicKey: z.string().min(1),
  stakeWeight: z.number().positive().optional().default(1.0),
});

export async function bftOracleRoutes(server: FastifyInstance) {
  server.post("/aggregate", async (request: FastifyRequest<{ Body: z.infer<typeof aggregateSchema> }>, reply: FastifyReply) => {
    try {
      const { assetCode, reports } = aggregateSchema.parse(request.body);
      const result = await bftOracleAggregatorService.aggregateBftState(assetCode, reports as any);
      return reply.code(200).send(result);
    } catch (error) {
      logger.error(error, "Failed to run BFT state aggregation");
      return reply.code(400).send({ error: "Failed to run BFT state aggregation", details: String(error) });
    }
  });

  server.post("/providers", async (request: FastifyRequest<{ Body: z.infer<typeof registerNodeSchema> }>, reply: FastifyReply) => {
    try {
      const body = registerNodeSchema.parse(request.body);
      const provider = await bftOracleAggregatorService.registerProviderNode(body as any);
      return reply.code(201).send(provider);
    } catch (error) {
      logger.error(error, "Failed to register BFT provider node");
      return reply.code(400).send({ error: "Failed to register BFT provider node", details: String(error) });
    }
  });

  server.get("/providers", async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const providers = await bftOracleAggregatorService.getRegisteredProviders();
      return reply.code(200).send({ providers, total: providers.length });
    } catch (error) {
      logger.error(error, "Failed to fetch BFT provider nodes");
      return reply.code(500).send({ error: "Failed to fetch BFT provider nodes" });
    }
  });

  server.get("/rounds/:assetCode", async (request: FastifyRequest<{ Params: { assetCode: string } }>, reply: FastifyReply) => {
    try {
      const rounds = await bftOracleAggregatorService.getPastRounds(request.params.assetCode);
      return reply.code(200).send({ assetCode: request.params.assetCode, rounds });
    } catch (error) {
      logger.error(error, "Failed to fetch BFT rounds");
      return reply.code(500).send({ error: "Failed to fetch BFT rounds" });
    }
  });

  server.get("/slashing-events", async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const events = await bftOracleAggregatorService.getSlashingHistory();
      return reply.code(200).send({ events, total: events.length });
    } catch (error) {
      logger.error(error, "Failed to fetch slashing events");
      return reply.code(500).send({ error: "Failed to fetch slashing events" });
    }
  });
}
