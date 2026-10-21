// @ts-nocheck
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sorobanInvocationCostService } from "../../services/sorobanInvocationCost.service.js";
import { authMiddleware } from "../middleware/auth.js";

export async function sorobanInvocationCostRoutes(server: FastifyInstance) {
  server.addHook("preHandler", authMiddleware());

  server.post<{
    Body: {
      contractId: string;
      functionName: string;
      transactionHash: string;
      ledgerSequence: number;
      invokedAt: string;
      cpuInstructions: number;
      memoryBytes: number;
      networkBytes: number;
      cpuCost: number;
      memoryCost: number;
      networkCost: number;
      status: "success" | "failed" | "partial";
      errorCode?: string;
    };
  }>(
    "/invocations",
    {
      schema: {
        tags: ["Soroban Cost Tracking"],
        summary: "Record a Soroban invocation cost",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: [
            "contractId",
            "functionName",
            "transactionHash",
            "ledgerSequence",
            "invokedAt",
            "cpuInstructions",
            "memoryBytes",
            "networkBytes",
            "cpuCost",
            "memoryCost",
            "networkCost",
            "status",
          ],
          properties: {
            contractId: { type: "string" },
            functionName: { type: "string" },
            transactionHash: { type: "string" },
            ledgerSequence: { type: "number" },
            invokedAt: { type: "string", format: "date-time" },
            cpuInstructions: { type: "number" },
            memoryBytes: { type: "number" },
            networkBytes: { type: "number" },
            cpuCost: { type: "number" },
            memoryCost: { type: "number" },
            networkCost: { type: "number" },
            status: { type: "string", enum: ["success", "failed", "partial"] },
            errorCode: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const record = request.body;

      const invocation = await sorobanInvocationCostService.recordInvocation({
        contractId: record.contractId,
        functionName: record.functionName,
        transactionHash: record.transactionHash,
        ledgerSequence: BigInt(record.ledgerSequence),
        invokedAt: new Date(record.invokedAt),
        cpuInstructions: BigInt(record.cpuInstructions),
        memoryBytes: BigInt(record.memoryBytes),
        networkBytes: BigInt(record.networkBytes),
        cpuCost: record.cpuCost,
        memoryCost: record.memoryCost,
        networkCost: record.networkCost,
        status: record.status,
        errorCode: record.errorCode,
      });

      return reply.status(201).send(invocation);
    },
  );

  server.get<{ Params: { contractId: string; functionName: string }; Querystring: { granularity?: string } }>(
    "/contracts/:contractId/functions/:functionName/trends",
    {
      schema: {
        tags: ["Soroban Cost Tracking"],
        summary: "Get cost trends for a contract function",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["contractId", "functionName"],
          properties: {
            contractId: { type: "string" },
            functionName: { type: "string" },
          },
        },
        querystring: {
          type: "object",
          properties: {
            granularity: { type: "string", enum: ["hourly", "daily", "weekly", "monthly"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { contractId, functionName } = request.params;
      const { granularity } = request.query as Record<string, string>;

      const trends = await sorobanInvocationCostService.getTrends(
        contractId,
        functionName,
        granularity as "hourly" | "daily" | "weekly" | "monthly" | undefined,
      );

      return reply.send({ trends });
    },
  );

  server.post<{ Params: { contractId: string; functionName: string }; Querystring: { granularity?: string } }>(
    "/contracts/:contractId/functions/:functionName/compute-trends",
    {
      schema: {
        tags: ["Soroban Cost Tracking"],
        summary: "Compute cost trends for a contract function",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["contractId", "functionName"],
          properties: {
            contractId: { type: "string" },
            functionName: { type: "string" },
          },
        },
        querystring: {
          type: "object",
          properties: {
            granularity: { type: "string", enum: ["hourly", "daily", "weekly", "monthly"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { contractId, functionName } = request.params;
      const { granularity } = request.query as Record<string, string>;

      const trends = await sorobanInvocationCostService.computeTrends(
        contractId,
        functionName,
        (granularity as "hourly" | "daily" | "weekly" | "monthly") || "daily",
      );

      return reply.send({ trends });
    },
  );

  server.get<{ Params: { contractId: string; functionName: string }; Querystring: { status?: string } }>(
    "/contracts/:contractId/functions/:functionName/anomalies",
    {
      schema: {
        tags: ["Soroban Cost Tracking"],
        summary: "Get cost anomalies for a contract function",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["contractId", "functionName"],
          properties: {
            contractId: { type: "string" },
            functionName: { type: "string" },
          },
        },
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["open", "investigating", "resolved", "dismissed"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { contractId, functionName } = request.params;
      const { status } = request.query as Record<string, string>;

      const anomalies = await sorobanInvocationCostService.getAnomalies(contractId, functionName, status || "open");

      return reply.send({ anomalies });
    },
  );

  server.post<{ Params: { anomalyId: string } }>(
    "/anomalies/:anomalyId/resolve",
    {
      schema: {
        tags: ["Soroban Cost Tracking"],
        summary: "Resolve a cost anomaly",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["anomalyId"],
          properties: { anomalyId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const { anomalyId } = request.params;

      await sorobanInvocationCostService.resolveAnomaly(anomalyId);

      return reply.send({ success: true });
    },
  );
}
