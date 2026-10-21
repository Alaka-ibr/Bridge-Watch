// @ts-nocheck
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { OperatorHandoffService } from "../../services/operatorHandoff.service.js";
import { logger } from "../../utils/logger.js";

const createHandoffSchema = z.object({
  shiftName: z.string().trim().min(1).max(120),
  outgoingOperator: z.string().trim().min(1).max(120),
  incomingOperator: z.string().trim().min(1).max(120),
  checklistItems: z.array(z.object({
    id: z.string(),
    label: z.string(),
    category: z.enum(["incidents", "circuit_breakers", "maintenance", "health_checks", "general"]),
    completed: z.boolean(),
    notes: z.string().optional(),
    verified_by: z.string().optional(),
  })).optional(),
  summaryNotes: z.string().optional(),
  incidentsReviewed: z.array(z.string()).optional(),
});

const updateHandoffSchema = z.object({
  operator: z.string().trim().min(1),
  shiftName: z.string().trim().min(1).max(120).optional(),
  incomingOperator: z.string().trim().min(1).max(120).optional(),
  checklistItems: z.array(z.object({
    id: z.string(),
    label: z.string(),
    category: z.enum(["incidents", "circuit_breakers", "maintenance", "health_checks", "general"]),
    completed: z.boolean(),
    notes: z.string().optional(),
    verified_by: z.string().optional(),
  })).optional(),
  summaryNotes: z.string().optional(),
  incidentsReviewed: z.array(z.string()).optional(),
});

const signoffSchema = z.object({
  operator: z.string().trim().min(1),
  signature: z.string().trim().min(1),
});

export async function operatorHandoffRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
) {
  const service = new OperatorHandoffService();

  fastify.post(
    "/handoffs",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createHandoffSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid handoff payload", details: parsed.error.flatten() });
      }

      try {
        const handoff = await service.createHandoff(parsed.data as any);
        return reply.code(201).send({ handoff });
      } catch (error) {
        logger.error({ error }, "Failed to create operator handoff");
        return reply.code(500).send({ error: "Failed to create operator handoff" });
      }
    }
  );

  fastify.get(
    "/handoffs",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { status, operator, limit } = request.query as {
        status?: any;
        operator?: string;
        limit?: string;
      };

      try {
        const handoffs = await service.listHandoffs({
          status,
          operator,
          limit: limit ? parseInt(limit, 10) : 50,
        });
        return { handoffs };
      } catch (error) {
        logger.error({ error }, "Failed to list operator handoffs");
        return reply.code(500).send({ error: "Failed to list operator handoffs" });
      }
    }
  );

  fastify.get(
    "/handoffs/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        const handoff = await service.getHandoff(id);
        if (!handoff) return reply.code(404).send({ error: "Handoff checklist not found" });
        return handoff;
      } catch (error) {
        logger.error({ error, id }, "Failed to fetch operator handoff");
        return reply.code(500).send({ error: "Failed to fetch operator handoff" });
      }
    }
  );

  fastify.patch(
    "/handoffs/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = updateHandoffSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid update payload", details: parsed.error.flatten() });
      }

      try {
        const handoff = await service.updateHandoff(id, parsed.data.operator, parsed.data as any);
        return { handoff };
      } catch (error) {
        logger.error({ error, id }, "Failed to update operator handoff");
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed to update handoff" });
      }
    }
  );

  fastify.post(
    "/handoffs/:id/submit",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = signoffSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid signoff payload", details: parsed.error.flatten() });
      }

      try {
        const handoff = await service.submitHandoff(id, parsed.data.operator, parsed.data.signature);
        return { handoff };
      } catch (error) {
        logger.error({ error, id }, "Failed to submit operator handoff");
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed to submit handoff" });
      }
    }
  );

  fastify.post(
    "/handoffs/:id/acknowledge",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = signoffSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid signoff payload", details: parsed.error.flatten() });
      }

      try {
        const handoff = await service.acknowledgeHandoff(id, parsed.data.operator, parsed.data.signature);
        return { handoff };
      } catch (error) {
        logger.error({ error, id }, "Failed to acknowledge operator handoff");
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed to acknowledge handoff" });
      }
    }
  );
}
