import { z } from "zod";
import { coercion } from "../../utils/validation.js";
import { PaginationSchema } from "./common.schema.js";

export const SearchQuerySchema = z.object({
    q: z.string().min(2).max(100),
    type: z.enum(["asset", "bridge", "incident", "alert"]).optional(),
    fuzzy: coercion.boolean.optional().default(false),
}).merge(PaginationSchema);

export const SearchBodySchema = z.object({
    query: z.string().min(2).max(100),
    type: z.enum(["asset", "bridge", "incident", "alert"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(1000).optional(),
    fuzzy: z.boolean().optional(),
    filters: z.record(z.string(), z.any()).optional(),
});

export const SearchSuggestionSchema = z.object({
    q: z.string().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});
