// @ts-nocheck
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import {
  reserveAttestationExpiryService,
  DEFAULT_EXPIRY_WARNING_MS,
  type AttestationExpiryStatus,
} from "../../services/reserveAttestationExpiry.service.js";
import { logger } from "../../utils/logger.js";
import { sendApiError } from "../utils/response.js";

const expiryStatusEnum = z.enum(["valid", "expiring_soon", "expired", "revoked"]);

const listQuerySchema = z.object({
  bridgeId: z.string().optional(),
  assetCode: z.string().optional(),
  expiryStatus: expiryStatusEnum.optional(),
  warningWindowDays: z.coerce.number().int().min(1).max(90).optional(),
});

const registerBodySchema = z.object({
  bridgeId: z.string().min(1),
  assetCode: z.string().min(1),
  attestor: z.string().min(1),
  attestationRef: z.string().max(128).optional().nullable(),
  issuedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
}).refine((body) => body.expiresAt.getTime() > body.issuedAt.getTime(), {
  message: "expiresAt must be after issuedAt",
  path: ["expiresAt"],
});

const revokeBodySchema = z.object({
  reason: z.string().min(1).max(500),
});

const summaryQuerySchema = z.object({
  warningWindowDays: z.coerce.number().int().min(1).max(90).optional(),
});

function toWarningWindowMs(days?: number): number | undefined {
  return days ? days * 24 * 60 * 60 * 1000 : undefined;
}

export async function reserveAttestationsRoutes(server: FastifyInstance) {
  server.get(
    "/",
    async (
      request: FastifyRequest<{ Querystring: z.infer<typeof listQuerySchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const query = listQuerySchema.parse(request.query);
        const attestations = await reserveAttestationExpiryService.listAttestations({
          bridgeId: query.bridgeId,
          assetCode: query.assetCode,
          expiryStatus: query.expiryStatus as AttestationExpiryStatus | undefined,
          warningWindowMs: toWarningWindowMs(query.warningWindowDays) ?? DEFAULT_EXPIRY_WARNING_MS,
        });
        return { attestations };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return sendApiError(reply, 400, "Invalid query parameters", { issues: error.errors });
        }
        logger.error(error, "Failed to list reserve attestations");
        return sendApiError(reply, 500, "Failed to list reserve attestations");
      }
    }
  );

  server.get(
    "/summary",
    async (
      request: FastifyRequest<{ Querystring: z.infer<typeof summaryQuerySchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const query = summaryQuerySchema.parse(request.query);
        const summary = await reserveAttestationExpiryService.getExpirySummary(
          toWarningWindowMs(query.warningWindowDays) ?? DEFAULT_EXPIRY_WARNING_MS
        );
        return summary;
      } catch (error) {
        if (error instanceof z.ZodError) {
          return sendApiError(reply, 400, "Invalid query parameters", { issues: error.errors });
        }
        logger.error(error, "Failed to build reserve attestation expiry summary");
        return sendApiError(reply, 500, "Failed to build reserve attestation expiry summary");
      }
    }
  );

  server.get(
    "/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const attestation = await reserveAttestationExpiryService.getAttestation(request.params.id);
        if (!attestation) {
          return sendApiError(reply, 404, "Attestation not found");
        }
        return attestation;
      } catch (error) {
        logger.error(error, "Failed to load reserve attestation");
        return sendApiError(reply, 500, "Failed to load reserve attestation");
      }
    }
  );

  server.post(
    "/",
    { preHandler: authMiddleware({ requiredScopes: ["jobs:trigger"] }) },
    async (
      request: FastifyRequest<{ Body: z.infer<typeof registerBodySchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const body = registerBodySchema.parse(request.body);
        const attestation = await reserveAttestationExpiryService.registerAttestation(body as any);
        reply.code(201);
        return { success: true, attestation };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return sendApiError(reply, 400, "Invalid attestation payload", { issues: error.errors });
        }
        logger.error(error, "Failed to register reserve attestation");
        return sendApiError(reply, 500, "Failed to register reserve attestation");
      }
    }
  );

  server.post(
    "/:id/revoke",
    { preHandler: authMiddleware({ requiredScopes: ["jobs:trigger"] }) },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: z.infer<typeof revokeBodySchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const body = revokeBodySchema.parse(request.body);
        const attestation = await reserveAttestationExpiryService.revokeAttestation(
          request.params.id,
          body.reason
        );
        if (!attestation) {
          return sendApiError(reply, 404, "Attestation not found");
        }
        return { success: true, attestation };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return sendApiError(reply, 400, "Invalid revoke payload", { issues: error.errors });
        }
        logger.error(error, "Failed to revoke reserve attestation");
        return sendApiError(reply, 500, "Failed to revoke reserve attestation");
      }
    }
  );
}
