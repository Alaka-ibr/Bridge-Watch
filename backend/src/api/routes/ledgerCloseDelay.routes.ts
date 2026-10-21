// @ts-nocheck
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ledgerCloseDelayService } from "../../services/ledgerCloseDelay.service.js";
import { authMiddleware } from "../middleware/auth.js";

export async function ledgerCloseDelayRoutes(server: FastifyInstance) {
  server.addHook("preHandler", authMiddleware());

  server.post<{
    Body: {
      ledgerSequence: number;
      expectedCloseTime: string;
      actualCloseTime: string;
      ledgerHash: string;
      transactionCount: number;
      operationCount: number;
      baseFeeRate: string;
    };
  }>(
    "/events",
    {
      schema: {
        tags: ["Ledger Close Delays"],
        summary: "Record a ledger close event",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["ledgerSequence", "expectedCloseTime", "actualCloseTime", "ledgerHash", "transactionCount", "operationCount", "baseFeeRate"],
          properties: {
            ledgerSequence: { type: "number" },
            expectedCloseTime: { type: "string", format: "date-time" },
            actualCloseTime: { type: "string", format: "date-time" },
            ledgerHash: { type: "string" },
            transactionCount: { type: "number" },
            operationCount: { type: "number" },
            baseFeeRate: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const record = request.body;

      const ledgerEvent = await ledgerCloseDelayService.recordClosureEvent({
        ledgerSequence: BigInt(record.ledgerSequence),
        expectedCloseTime: new Date(record.expectedCloseTime),
        actualCloseTime: new Date(record.actualCloseTime),
        ledgerHash: record.ledgerHash,
        transactionCount: record.transactionCount,
        operationCount: record.operationCount,
        baseFeeRate: record.baseFeeRate,
      });

      return reply.status(201).send(ledgerEvent);
    },
  );

  server.put<{
    Params: { alertId: string };
    Body: {
      status: "open" | "investigating" | "resolved" | "dismissed";
      notes?: string;
    };
  }>(
    "/alerts/:alertId",
    {
      schema: {
        tags: ["Ledger Close Delays"],
        summary: "Update a delay alert status",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["alertId"],
          properties: { alertId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["open", "investigating", "resolved", "dismissed"] },
            notes: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { alertId } = request.params;
      const { status, notes } = request.body;

      await ledgerCloseDelayService.updateAlertStatus(alertId, status, notes);

      return reply.send({ success: true });
    },
  );

  server.post<{ Querystring: { granularity?: string } }>(
    "/compute-stats",
    {
      schema: {
        tags: ["Ledger Close Delays"],
        summary: "Compute ledger close delay statistics",
        security: [{ ApiKeyAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            granularity: { type: "string", enum: ["hourly", "daily", "weekly", "monthly"] },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { granularity } = request.query as Record<string, string>;

      const stats = await ledgerCloseDelayService.computeDelayStats(
        (granularity as "hourly" | "daily" | "weekly" | "monthly") || "daily",
      );

      return reply.status(201).send({ stats });
    },
  );

  server.get<{ Querystring: { granularity?: string; limit?: string } }>(
    "/stats",
    {
      schema: {
        tags: ["Ledger Close Delays"],
        summary: "Get ledger close delay statistics",
        security: [{ ApiKeyAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            granularity: { type: "string", enum: ["hourly", "daily", "weekly", "monthly"] },
            limit: { type: "string" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { granularity, limit } = request.query as Record<string, string>;

      const stats = await ledgerCloseDelayService.getDelayStats(granularity, parseInt(limit, 10) || 52);

      return reply.send({ stats });
    },
  );

  server.post(
    "/detect-patterns",
    {
      schema: {
        tags: ["Ledger Close Delays"],
        summary: "Detect ledger close delay patterns",
        security: [{ ApiKeyAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const patterns = await ledgerCloseDelayService.detectPatterns();
      return reply.status(201).send({ patterns });
    },
  );
}
