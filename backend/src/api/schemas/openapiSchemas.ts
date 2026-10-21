// @ts-nocheck
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function toOpenApiSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "openApi3",
  }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

export const AssetMetadataSchema = z.object({
  id: z.string().uuid(),
  symbol: z.string(),
  name: z.string(),
  issuer: z.string().nullable(),
  asset_type: z.enum(["native", "credit_alphanum4", "credit_alphanum12"]),
  bridge_provider: z.string().nullable(),
  source_chain: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const AssetDetailsResponseSchema = z.object({
  symbol: z.string(),
  details: AssetMetadataSchema.nullable(),
});

const StringOrStringArraySchema = z.union([z.string(), z.array(z.string())]);
const NumberOrNumericStringSchema = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/),
]);

export const AlertHistoryRouteQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  severity: StringOrStringArraySchema.optional(),
  source: StringOrStringArraySchema.optional(),
  alertType: StringOrStringArraySchema.optional(),
  q: z.string().optional(),
  page: NumberOrNumericStringSchema.optional(),
  pageSize: NumberOrNumericStringSchema.optional(),
});

export const AlertHistoryEventSchema = z.object({
  time: z.string().datetime(),
  rule_id: z.string().uuid(),
  asset_code: z.string(),
  alert_type: z.string(),
  priority: z.string(),
  triggered_value: z.union([z.string(), z.number()]),
  threshold: z.union([z.string(), z.number()]),
  metric: z.string(),
  webhook_delivered: z.boolean(),
  webhook_delivered_at: z.string().datetime().nullable(),
  webhook_attempts: z.number().int(),
  on_chain_event_id: z.union([z.string(), z.number()]).nullable(),
  event_id: z.string().uuid(),
  lifecycle_state: z.string(),
  acknowledged_at: z.string().datetime().nullable(),
  acknowledged_by: z.string().nullable(),
  assigned_at: z.string().datetime().nullable(),
  assigned_to: z.string().nullable(),
  closed_at: z.string().datetime().nullable(),
  closed_by: z.string().nullable(),
  closure_note: z.string().nullable(),
  updated_at: z.string().datetime(),
});

export const AlertHistorySuccessSchema = z.object({
  success: z.literal(true),
  data: z.object({
    results: z.array(AlertHistoryEventSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});
