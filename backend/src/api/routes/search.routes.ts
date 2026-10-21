import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { SearchService } from "../../services/search.service.js";
import { logger } from "../../utils/logger.js";
import { validateRequest } from "../middleware/validation.js";
import { authMiddleware } from "../middleware/auth.js";
import { SearchBodySchema, SearchQuerySchema, SearchSuggestionSchema } from "../validations/search.schema.js";

const searchService = new SearchService();

export async function searchRoutes(server: FastifyInstance) {
  // Main search endpoint
  server.post(
    "/",
    {
      preHandler: validateRequest({ body: SearchBodySchema }),
      rateLimit: { max: 30, timeWindow: "1 minute" },
    } as any,
    async (
      request: FastifyRequest<{
        Body: z.infer<typeof SearchBodySchema>;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { query, type, limit, offset, fuzzy, filters } = request.body;

        if (!query || query.trim().length < 2) {
          reply.code(400);
          return {
            success: false,
            error: "Query must be at least 2 characters long"
          };
        }

        const results = await searchService.search({
          query,
          type,
          limit,
          offset,
          fuzzy,
          filters,
        });

        return { success: true, data: results };
      } catch (error) {
        logger.error(error, "Search failed");
        reply.code(500);
        return { success: false, error: "Search failed" };
      }
    }
  );

  // GET endpoint for simple searches
  server.get(
    "/",
    {
      preHandler: validateRequest({ query: SearchQuerySchema }),
      rateLimit: { max: 30, timeWindow: "1 minute" },
    } as any,
    async (
      request: FastifyRequest<{
        Querystring: z.infer<typeof SearchQuerySchema>;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { q: query, type, limit, offset, fuzzy } = request.query;

        if (!query || query.trim().length < 2) {
          reply.code(400);
          return {
            success: false,
            error: "Query must be at least 2 characters long"
          };
        }

        const results = await searchService.search({
          query,
          type,
          limit,
          offset,
          fuzzy,
        });

        return { success: true, data: results };
      } catch (error) {
        logger.error(error, "Search failed");
        reply.code(500);
        return { success: false, error: "Search failed" };
      }
    }
  );

  // Search suggestions/autocomplete
  server.get(
    "/suggestions",
    {
      preHandler: validateRequest({ query: SearchSuggestionSchema }),
      rateLimit: { max: 60, timeWindow: "1 minute" },
    } as any,
    async (
      request: FastifyRequest<{
        Querystring: z.infer<typeof SearchSuggestionSchema>;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { q: query, limit } = request.query;

        if (!query || query.trim().length < 2) {
          return { success: true, data: [] };
        }

        const suggestions = await searchService.getSuggestions(
          query,
          limit ?? 10
        );

        return { success: true, data: suggestions };
      } catch (error) {
        logger.error(error, "Failed to get suggestions");
        reply.code(500);
        return { success: false, error: "Failed to get suggestions" };
      }
    }
  );

  // Recent searches
  server.get(
    "/recent",
    async (
      request: FastifyRequest<{
        Querystring: { userId?: string; limit?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { userId, limit } = request.query;

        const recentSearches = await searchService.getRecentSearches(
          userId,
          limit ? parseInt(limit) : 10
        );

        return { success: true, data: recentSearches };
      } catch (error) {
        logger.error(error, "Failed to get recent searches");
        reply.code(500);
        return { success: false, error: "Failed to get recent searches" };
      }
    }
  );

  // Track result click
  server.post(
    "/click",
    async (
      request: FastifyRequest<{
        Body: {
          query: string;
          resultId: string;
          userId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { query, resultId, userId } = request.body;

        await searchService.trackResultClick(query, resultId, userId);

        return { success: true };
      } catch (error) {
        logger.error(error, "Failed to track click");
        reply.code(500);
        return { success: false, error: "Failed to track click" };
      }
    }
  );

  // Rebuild search index (admin only)
  server.post(
    "/rebuild-index",
    {
      preHandler: authMiddleware({ requiredScopes: ["jobs:trigger"] }),
    },
    async (
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      try {
        await searchService.rebuildSearchIndex();

        logger.info("Search index rebuilt successfully");
        return { success: true, message: "Search index rebuilt successfully" };
      } catch (error) {
        logger.error(error, "Failed to rebuild search index");
        reply.code(500);
        return { success: false, error: "Failed to rebuild search index" };
      }
    }
  );

  server.get(
    "/index-status",
    {
      preHandler: authMiddleware({ requiredScopes: ["jobs:read"] }),
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = await searchService.getIndexStatus();
        return { success: true, data };
      } catch (error) {
        logger.error(error, "Failed to get search index status");
        reply.code(500);
        return { success: false, error: "Failed to get search index status" };
      }
    }
  );

  // Search analytics
  server.get(
    "/analytics",
    {
      preHandler: authMiddleware({ requiredScopes: ["jobs:read"] }),
    },
    async (
      request: FastifyRequest<{
        Querystring: {
          days?: string;
          userId?: string;
          limit?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { days, userId, limit } = request.query;
        const analytics = await searchService.getAnalytics({
          days: days ? parseInt(days, 10) : undefined,
          userId,
          limit: limit ? parseInt(limit, 10) : undefined,
        });

        return { success: true, data: analytics };
      } catch (error) {
        logger.error(error, "Failed to get search analytics");
        reply.code(500);
        return { success: false, error: "Failed to get search analytics" };
      }
    }
  );

  // Health check for search service
  server.get("/health", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const startedAt = Date.now();
      const testResults = await searchService.search({
        query: "usdc",
        limit: 1,
      });
      const indexStatus = await searchService.getIndexStatus();

      return {
        success: true,
        data: {
          status: "healthy",
          testSearchResults: testResults.total,
          latencyMs: Date.now() - startedAt,
          indexStatus,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error(error, "Search health check failed");
      reply.code(500);
      return { success: false, error: "Search health check failed" };
    }
  });
}
