// @ts-nocheck
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  maintenanceService,
  MaintenanceScope,
  MaintenanceStatus,
} from "../../services/maintenance.service";
import { maintenanceImpactPreviewService } from "../../services/maintenanceImpactPreview.service.js";
import { sendApiError } from "../utils/response.js";

const impactPreviewBodySchema = z
  .object({
    scope: z.enum(["global", "bridge", "asset", "service"]),
    scopeIdentifier: z.string().optional().nullable(),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
  })
  .refine((body) => body.endTime.getTime() > body.startTime.getTime(), {
    message: "endTime must be after startTime",
    path: ["endTime"],
  });

export async function maintenanceRoutes(server: FastifyInstance) {
  // Preview the impact of a proposed (not-yet-created) maintenance window
  server.post("/impact-preview", async (request, reply) => {
    const parsed = impactPreviewBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, 400, "Invalid impact preview payload", {
        issues: parsed.error.errors,
      });
    }

    const preview = await maintenanceImpactPreviewService.previewImpact(parsed.data as any);
    return preview;
  });

  // Create maintenance window
  server.post("/", async (request, reply) => {
    const window = await maintenanceService.createWindow(request.body as any);
    return reply.code(201).send(window);
  });

  // Get maintenance window
  server.get<{ Params: { windowId: string } }>(
    "/:windowId",
    async (request, reply) => {
      const window = await maintenanceService.getWindow(
        request.params.windowId,
      );
      if (!window) {
        return reply.code(404).send({ error: "Window not found" });
      }
      return window;
    },
  );

  // Update maintenance window
  server.patch<{
    Params: { windowId: string };
    Body: { updates: any; updatedBy: string };
  }>("/:windowId", async (request, reply) => {
    const window = await maintenanceService.updateWindow(
      request.params.windowId,
      request.body.updates,
      request.body.updatedBy,
    );
    if (!window) {
      return reply.code(404).send({ error: "Window not found" });
    }
    return window;
  });

  // Approve maintenance window
  server.post<{ Params: { windowId: string }; Body: { approvedBy: string } }>(
    "/:windowId/approve",
    async (request, reply) => {
      await maintenanceService.approveWindow(
        request.params.windowId,
        request.body.approvedBy,
      );
      return reply.code(200).send({ message: "Window approved" });
    },
  );

  // Cancel maintenance window
  server.post<{ Params: { windowId: string }; Body: { cancelledBy: string } }>(
    "/:windowId/cancel",
    async (request, reply) => {
      await maintenanceService.cancelWindow(
        request.params.windowId,
        request.body.cancelledBy,
      );
      return reply.code(200).send({ message: "Window cancelled" });
    },
  );

  // Get active windows
  server.get("/active", async (_request, _reply) => {
    const windows = await maintenanceService.getActiveWindows();
    return { windows, total: windows.length };
  });

  // Get upcoming windows
  server.get("/upcoming", async (request, _reply) => {
    const limit = (request.query as any).limit || 10;
    const windows = await maintenanceService.getUpcomingWindows(limit);
    return { windows, total: windows.length };
  });

  // Get all windows with filters
  server.get("/", async (request, _reply) => {
    const filters = request.query as any;
    const windows = await maintenanceService.getAllWindows(filters);
    return { windows, total: windows.length };
  });

  // Get audit trail
  server.get<{ Params: { windowId: string } }>(
    "/:windowId/audit",
    async (request, _reply) => {
      const trail = await maintenanceService.getAuditTrail(
        request.params.windowId,
      );
      return { trail, total: trail.length };
    },
  );

  // Check alert suppression
  server.post("/check-suppression", async (request, _reply) => {
    const { alertType, scope } = request.body as any;
    const suppressed = await maintenanceService.shouldSuppressAlert(
      alertType,
      scope,
    );
    return { suppressed };
  });
}
