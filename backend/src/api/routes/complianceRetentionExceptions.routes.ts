// @ts-nocheck
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ComplianceRetentionExceptionService } from "../../services/complianceRetentionException.service.js";
import { logger } from "../../utils/logger.js";

const createExceptionSchema = z.object({
  exceptionCode: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(150),
  reason: z.string().trim().min(1),
  requestedBy: z.string().trim().min(1),
  targetType: z.enum(["all", "mismatch", "alert", "report", "export", "asset"]),
  targetId: z.string().trim().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const releaseExceptionSchema = z.object({
  releasedBy: z.string().trim().min(1),
  releaseReason: z.string().trim().optional(),
});

export async function complianceRetentionExceptionRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
) {
  const service = new ComplianceRetentionExceptionService();

  fastify.post(
    "/compliance/retention-exceptions",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createExceptionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid retention exception payload", details: parsed.error.flatten() });
      }

      try {
        const record = await service.createException({
          ...parsed.data,
          startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
          endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
        } as any);
        return reply.code(201).send({ exception: record });
      } catch (error) {
        logger.error({ error }, "Failed to create compliance retention exception");
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed to create exception" });
      }
    }
  );

  fastify.get(
    "/compliance/retention-exceptions",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { status, targetType, limit } = request.query as {
        status?: any;
        targetType?: any;
        limit?: string;
      };

      try {
        const exceptions = await service.listExceptions({
          status,
          targetType,
          limit: limit ? parseInt(limit, 10) : 50,
        });
        return { exceptions };
      } catch (error) {
        logger.error({ error }, "Failed to list compliance retention exceptions");
        return reply.code(500).send({ error: "Failed to list retention exceptions" });
      }
    }
  );

  fastify.get(
    "/compliance/retention-exceptions/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        const exception = await service.getException(id);
        if (!exception) return reply.code(404).send({ error: "Retention exception not found" });
        return exception;
      } catch (error) {
        logger.error({ error, id }, "Failed to fetch retention exception");
        return reply.code(500).send({ error: "Failed to fetch retention exception" });
      }
    }
  );

  fastify.post(
    "/compliance/retention-exceptions/:id/release",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = releaseExceptionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid release payload", details: parsed.error.flatten() });
      }

      try {
        const exception = await service.releaseException(id, parsed.data.releasedBy, parsed.data.releaseReason);
        return { exception };
      } catch (error) {
        logger.error({ error, id }, "Failed to release retention exception");
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed to release exception" });
      }
    }
  );
}
