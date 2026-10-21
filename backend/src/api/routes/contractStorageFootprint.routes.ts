// @ts-nocheck
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import {
  contractStorageFootprintService,
  DEFAULT_STORAGE_THRESHOLDS,
} from "../../services/contractStorageFootprint.service.js";
import { logger } from "../../utils/logger.js";
import { sendApiError } from "../utils/response.js";

const snapshotBodySchema = z.object({
  contractId: z.string().min(1).max(56),
  label: z.string().max(120).optional().nullable(),
  ledgerSeq: z.number().int().nonnegative(),
  persistentEntries: z.number().int().nonnegative(),
  temporaryEntries: z.number().int().nonnegative(),
  instanceEntries: z.number().int().nonnegative(),
  totalSizeBytes: z.number().int().nonnegative(),
  minRentExpirationLedger: z.number().int().nonnegative().optional().nullable(),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const dashboardQuerySchema = z.object({
  warningBytes: z.coerce.number().int().positive().optional(),
  criticalBytes: z.coerce.number().int().positive().optional(),
});

export async function contractStorageFootprintRoutes(server: FastifyInstance) {
  server.get(
    "/dashboard",
    async (
      request: FastifyRequest<{ Querystring: z.infer<typeof dashboardQuerySchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const query = dashboardQuerySchema.parse(request.query);
        const thresholds = {
          warningBytes: query.warningBytes ?? DEFAULT_STORAGE_THRESHOLDS.warningBytes,
          criticalBytes: query.criticalBytes ?? DEFAULT_STORAGE_THRESHOLDS.criticalBytes,
        };
        const dashboard = await contractStorageFootprintService.getDashboard({ thresholds });
        return dashboard;
      } catch (error) {
        if (error instanceof z.ZodError) {
          return sendApiError(reply, 400, "Invalid query parameters", { issues: error.errors });
        }
        logger.error(error, "Failed to build contract storage footprint dashboard");
        return sendApiError(reply, 500, "Failed to build contract storage footprint dashboard");
      }
    }
  );

  server.get(
    "/:contractId/history",
    async (
      request: FastifyRequest<{
        Params: { contractId: string };
        Querystring: z.infer<typeof historyQuerySchema>;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { limit } = historyQuerySchema.parse(request.query);
        const history = await contractStorageFootprintService.getContractHistory(
          request.params.contractId,
          limit
        );
        return { contractId: request.params.contractId, history };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return sendApiError(reply, 400, "Invalid query parameters", { issues: error.errors });
        }
        logger.error(error, "Failed to load contract storage history");
        return sendApiError(reply, 500, "Failed to load contract storage history");
      }
    }
  );

  server.post(
    "/snapshots",
    { preHandler: authMiddleware({ requiredScopes: ["jobs:trigger"] }) },
    async (
      request: FastifyRequest<{ Body: z.infer<typeof snapshotBodySchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const body = snapshotBodySchema.parse(request.body);
        const snapshot = await contractStorageFootprintService.recordSnapshot(body as any);
        reply.code(201);
        return { success: true, snapshot };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return sendApiError(reply, 400, "Invalid snapshot payload", { issues: error.errors });
        }
        logger.error(error, "Failed to record contract storage snapshot");
        return sendApiError(reply, 500, "Failed to record contract storage snapshot");
      }
    }
  );
}
