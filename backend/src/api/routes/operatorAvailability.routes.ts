// @ts-nocheck
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { operatorAvailabilityService } from "../../services/operatorAvailability.service.js";
import { logger } from "../../utils/logger.js";

const availabilityStatusSchema = z.enum(["available", "unavailable", "on_call"]);

const createAvailabilitySchema = z.object({
  operator: z.string().trim().min(1).max(120),
  status: availabilityStatusSchema,
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  notes: z.string().optional().nullable(),
  createdBy: z.string().trim().min(1).max(120),
});

const updateAvailabilitySchema = z.object({
  status: availabilityStatusSchema.optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  notes: z.string().optional().nullable(),
});

export async function operatorAvailabilityRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
) {
  fastify.post(
    "/availability",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createAvailabilitySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid availability payload", details: parsed.error.flatten() });
      }

      try {
        const entry = await operatorAvailabilityService.createAvailability(parsed.data as any);
        return reply.code(201).send({ availability: entry });
      } catch (error) {
        logger.error({ error }, "Failed to create operator availability entry");
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed to create availability entry" });
      }
    }
  );

  fastify.get(
    "/availability",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { operator, status, from, to } = request.query as {
        operator?: string;
        status?: any;
        from?: string;
        to?: string;
      };

      try {
        const entries = await operatorAvailabilityService.listAvailability({
          operator,
          status,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        });
        return { availability: entries };
      } catch (error) {
        logger.error({ error }, "Failed to list operator availability");
        return reply.code(500).send({ error: "Failed to list operator availability" });
      }
    }
  );

  fastify.get(
    "/availability/calendar",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { from, to } = request.query as { from?: string; to?: string };
      if (!from || !to) {
        return reply.code(400).send({ error: "from and to query parameters are required" });
      }

      try {
        const calendar = await operatorAvailabilityService.getCalendar(
          new Date(from),
          new Date(to)
        );
        return { calendar };
      } catch (error) {
        logger.error({ error }, "Failed to build operator availability calendar");
        return reply.code(500).send({ error: "Failed to build operator availability calendar" });
      }
    }
  );

  fastify.get(
    "/availability/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        const entry = await operatorAvailabilityService.getAvailability(id);
        if (!entry) return reply.code(404).send({ error: "Availability entry not found" });
        return entry;
      } catch (error) {
        logger.error({ error, id }, "Failed to fetch operator availability entry");
        return reply.code(500).send({ error: "Failed to fetch availability entry" });
      }
    }
  );

  fastify.patch(
    "/availability/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = updateAvailabilitySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid update payload", details: parsed.error.flatten() });
      }

      try {
        const entry = await operatorAvailabilityService.updateAvailability(id, parsed.data);
        return { availability: entry };
      } catch (error) {
        logger.error({ error, id }, "Failed to update operator availability entry");
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed to update availability entry" });
      }
    }
  );

  fastify.delete(
    "/availability/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await operatorAvailabilityService.deleteAvailability(id);
        return reply.code(200).send({ message: "Availability entry deleted" });
      } catch (error) {
        logger.error({ error, id }, "Failed to delete operator availability entry");
        return reply.code(500).send({ error: "Failed to delete availability entry" });
      }
    }
  );
}
