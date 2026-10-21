import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { horizonCursorAuditService } from "../../services/horizonCursorAudit.service.js";
import { authMiddleware } from "../middleware/auth.js";
import { getPaginationParams, formatPaginatedResponse } from "../../utils/pagination.js";

export async function horizonCursorAuditRoutes(server: FastifyInstance) {
  server.addHook("preHandler", authMiddleware());

  server.post<{
    Body: {
      cursorKey: string;
      cursorType: string;
      sourceName: string;
      currentPosition: string;
    };
  }>(
    "/cursors",
    {
      schema: {
        tags: ["Horizon Cursor Audit"],
        summary: "Initialize a Horizon cursor",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["cursorKey", "cursorType", "sourceName", "currentPosition"],
          properties: {
            cursorKey: { type: "string" },
            cursorType: { type: "string" },
            sourceName: { type: "string" },
            currentPosition: { type: "string" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cursor = await horizonCursorAuditService.initializeCursor(request.body as any);
      return reply.status(201).send(cursor);
    },
  );

  server.put<{
    Params: { cursorKey: string };
    Body: {
      newPosition: string;
      eventsInBatch: number;
      reasonCode?: string;
    };
  }>(
    "/cursors/:cursorKey",
    {
      schema: {
        tags: ["Horizon Cursor Audit"],
        summary: "Advance a Horizon cursor",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["cursorKey"],
          properties: { cursorKey: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["newPosition", "eventsInBatch"],
          properties: {
            newPosition: { type: "string" },
            eventsInBatch: { type: "number" },
            reasonCode: { type: "string" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { cursorKey } = request.params as any;
      const { newPosition, eventsInBatch, reasonCode } = request.body as any;

      const result = await horizonCursorAuditService.advanceCursor(cursorKey, newPosition, eventsInBatch, reasonCode as any);

      return reply.send(result);
    },
  );

  server.post<{
    Body: {
      cursorId: string;
      fromPosition: string;
      toPosition: string;
      eventsRolledBack: number;
      rollbackReason: "data_corruption" | "network_failure" | "duplicate_events" | "ordering_violation" | "manual_override";
      description: string;
      severity: "low" | "medium" | "high" | "critical";
    };
  }>(
    "/rollbacks",
    {
      schema: {
        tags: ["Horizon Cursor Audit"],
        summary: "Create a cursor rollback",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["cursorId", "fromPosition", "toPosition", "eventsRolledBack", "rollbackReason", "description", "severity"],
          properties: {
            cursorId: { type: "string", format: "uuid" },
            fromPosition: { type: "string" },
            toPosition: { type: "string" },
            eventsRolledBack: { type: "number" },
            rollbackReason: {
              type: "string",
              enum: ["data_corruption", "network_failure", "duplicate_events", "ordering_violation", "manual_override"],
            },
            description: { type: "string" },
            severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rollback = await horizonCursorAuditService.createRollback(request.body as any);
      return reply.status(201).send(rollback);
    },
  );

  server.post<{ Params: { rollbackId: string } }>(
    "/rollbacks/:rollbackId/complete",
    {
      schema: {
        tags: ["Horizon Cursor Audit"],
        summary: "Complete a cursor rollback",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["rollbackId"],
          properties: { rollbackId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { rollbackId } = request.params as any;

      await horizonCursorAuditService.completeRollback(rollbackId);

      return reply.send({ success: true });
    },
  );

  server.post<{
    Params: { cursorId: string };
    Body: { horizonPosition: string };
  }>(
    "/cursors/:cursorId/reconcile",
    {
      schema: {
        tags: ["Horizon Cursor Audit"],
        summary: "Reconcile cursor position with Horizon",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["cursorId"],
          properties: { cursorId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["horizonPosition"],
          properties: { horizonPosition: { type: "string" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { cursorId } = request.params as any;
      const { horizonPosition } = request.body as any;

      const reconciliation = await horizonCursorAuditService.reconcileCursorPosition(cursorId as any, horizonPosition as any);

      return reply.status(201).send(reconciliation);
    },
  );

  server.get<{ Params: { cursorKey: string }; Querystring: { limit?: string; offset?: string } }>(
    "/cursors/:cursorKey/audit-log",
    {
      schema: {
        tags: ["Horizon Cursor Audit"],
        summary: "Get cursor audit log",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["cursorKey"],
          properties: { cursorKey: { type: "string" } },
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
            offset: { type: "string" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { cursorKey } = request.params as any;
      const { limit, offset } = getPaginationParams(request.query as Record<string, string>);

      const result = await horizonCursorAuditService.getAuditLog(cursorKey as any, limit, offset);

      return reply.send((formatPaginatedResponse as any)(result.logs as any, {
        total: (result.pagination as any).total,
        limit,
        offset,
        cursor: result.cursor,
      } as any));
    },
  );

  server.get<{ Params: { cursorKey: string }; Querystring: { limit?: string } }>(
    "/cursors/:cursorKey/rollback-history",
    {
      schema: {
        tags: ["Horizon Cursor Audit"],
        summary: "Get cursor rollback history",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["cursorKey"],
          properties: { cursorKey: { type: "string" } },
        },
        querystring: {
          type: "object",
          properties: { limit: { type: "string" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { cursorKey } = request.params as any;
      const { limit } = request.query as Record<string, string>;

      const rollbacks = await horizonCursorAuditService.getRollbackHistory(cursorKey as any, parseInt(limit, 10) || 50);

      return reply.send({ rollbacks });
    },
  );

  server.get<{ Params: { cursorKey: string }; Querystring: { limit?: string } }>(
    "/cursors/:cursorKey/reconciliations",
    {
      schema: {
        tags: ["Horizon Cursor Audit"],
        summary: "Get cursor reconciliation history",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["cursorKey"],
          properties: { cursorKey: { type: "string" } },
        },
        querystring: {
          type: "object",
          properties: { limit: { type: "string" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { cursorKey } = request.params as any;
      const { limit } = request.query as Record<string, string>;

      const reconciliations = await horizonCursorAuditService.getReconciliationHistory(cursorKey as any, parseInt(limit, 10) || 50);

      return reply.send({ reconciliations });
    },
  );

  server.get<{ Querystring: { limit?: string } }>(
    "/discrepancies",
    {
      schema: {
        tags: ["Horizon Cursor Audit"],
        summary: "Get cursor position discrepancies",
        security: [{ ApiKeyAuth: [] }],
        querystring: {
          type: "object",
          properties: { limit: { type: "string" } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      const { limit } = request.query as Record<string, string>;

      const discrepancies = await horizonCursorAuditService.getDiscrepancies(parseInt(limit, 10) || 50);

      return reply.send({ discrepancies });
    },
  );

  server.post<{ Params: { cursorKey: string } }>(
    "/cursors/:cursorKey/pause",
    {
      schema: {
        tags: ["Horizon Cursor Audit"],
        summary: "Pause a cursor",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["cursorKey"],
          properties: { cursorKey: { type: "string" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { cursorKey } = request.params as any;

      await horizonCursorAuditService.pauseCursor(cursorKey as any);

      return reply.send({ success: true });
    },
  );

  server.post<{ Params: { cursorKey: string } }>(
    "/cursors/:cursorKey/resume",
    {
      schema: {
        tags: ["Horizon Cursor Audit"],
        summary: "Resume a cursor",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["cursorKey"],
          properties: { cursorKey: { type: "string" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { cursorKey } = request.params as any;

      await horizonCursorAuditService.resumeCursor(cursorKey as any);

      return reply.send({ success: true });
    },
  );
}
