import type { Knex } from "knex";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

const QUERY_TIMEOUT_MS = 30_000;
export const DEFAULT_SEARCH_LIMIT = 25;
export const MAX_SEARCH_LIMIT = 100;
export const MAX_SEARCH_OFFSET = 1_000;

export type SearchEntityType = "asset" | "bridge" | "incident" | "alert";

export interface SearchResult {
  id: string;
  type: SearchEntityType;
  title: string;
  description: string;
  relevanceScore: number;
  highlights: string[];
  metadata: Record<string, unknown>;
}

export interface SearchQuery {
  query: string;
  type?: SearchEntityType;
  limit?: number;
  offset?: number;
  fuzzy?: boolean;
  filters?: Record<string, unknown>;
}

export interface SearchSuggestion {
  text: string;
  type: SearchEntityType;
  count: number;
}

export interface FacetValueCount {
  value: string;
  count: number;
}

export interface AssetSearchFacets {
  bridgeProvider: FacetValueCount[];
  sourceChain: FacetValueCount[];
}

interface SearchDocumentRecord {
  document_key: string;
  entity_type: SearchEntityType;
  entity_id: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  search_tokens: string | null;
  metadata: Record<string, unknown> | string | null;
  rank_weight: number;
  visibility: string;
  source_updated_at: string | Date;
  indexed_at: string | Date;
  total_count?: number | string;
}

interface SearchIndexDocumentInput {
  documentKey: string;
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  searchTokens: string | null;
  metadata: Record<string, unknown>;
  rankWeight: number;
  visibility: "public" | "private";
  sourceUpdatedAt: Date;
}

interface BuiltDocuments {
  documents: SearchIndexDocumentInput[];
  deleteDocumentKeys: string[];
}

const INDEX_ENTITY_TYPES: SearchEntityType[] = [
  "asset",
  "bridge",
  "incident",
  "alert",
];

const SYNONYM_MAP: Record<string, string[]> = {
  usdc: ["usd coin", "circle usdc", "usd stablecoin"],
  eurc: ["euro coin", "euro stablecoin"],
  xlm: ["stellar", "stellar lumens"],
  bridge: ["cross chain", "cross-chain"],
  alert: ["notification", "alarm"],
  incident: ["outage", "event"],
  rpc: ["json rpc", "node"],
  horizon: ["stellar horizon", "api"],
};

export class SearchService {
  private readonly db = getDatabase();

  async search(
    searchQuery: SearchQuery
  ): Promise<{ results: SearchResult[]; total: number; facets?: AssetSearchFacets }> {
    const { query, type, fuzzy = true, filters = {} } = searchQuery;
    const limit = this.normalizePaginationValue(
      searchQuery.limit,
      DEFAULT_SEARCH_LIMIT,
      MAX_SEARCH_LIMIT,
      "limit"
    );
    const offset = this.normalizePaginationValue(
      searchQuery.offset,
      0,
      MAX_SEARCH_OFFSET,
      "offset",
      true
    );

    if (!query || query.trim().length < 2) {
      return { results: [], total: 0 };
    }

    await this.syncIncrementalIndex(type ? [type] : INDEX_ENTITY_TYPES);

    const searchTerms = this.parseSearchQuery(query, fuzzy);
    const candidateRows = await this.queryDocuments(searchTerms, type, filters, limit + offset);
    const rankedResults = candidateRows
      .map((row) => this.mapRowToResult(row, searchTerms))
      .sort((left, right) => right.relevanceScore - left.relevanceScore);

    const results = rankedResults.slice(offset, offset + limit);
    await this.trackSearchAnalytics(query, undefined, rankedResults.length, filters);

    const facets = type === "asset" ? this.buildAssetFacets(rankedResults) : undefined;

    return {
      results,
      total: Number(candidateRows[0]?.total_count ?? rankedResults.length),
      ...(facets ? { facets } : {}),
    };
  }

  /**
   * Counts matching assets per bridge provider and source chain, mirroring
   * the filter dimensions already supported by the asset search index.
   */
  private buildAssetFacets(assetResults: SearchResult[]): AssetSearchFacets {
    const bridgeProviderCounts = new Map<string, number>();
    const sourceChainCounts = new Map<string, number>();

    for (const result of assetResults) {
      const bridgeProvider = result.metadata.bridgeProvider;
      if (typeof bridgeProvider === "string" && bridgeProvider) {
        bridgeProviderCounts.set(bridgeProvider, (bridgeProviderCounts.get(bridgeProvider) ?? 0) + 1);
      }

      const sourceChain = result.metadata.sourceChain;
      if (typeof sourceChain === "string" && sourceChain) {
        sourceChainCounts.set(sourceChain, (sourceChainCounts.get(sourceChain) ?? 0) + 1);
      }
    }

    const toSortedCounts = (counts: Map<string, number>): FacetValueCount[] =>
      Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => right.count - left.count);

    return {
      bridgeProvider: toSortedCounts(bridgeProviderCounts),
      sourceChain: toSortedCounts(sourceChainCounts),
    };
  }

  async getSuggestions(query: string, limit = 10): Promise<SearchSuggestion[]> {
    if (!query || query.trim().length < 2) {
      return [];
    }

    await this.syncIncrementalIndex(INDEX_ENTITY_TYPES);
    const searchTerms = this.parseSearchQuery(query, true);
    const rows = await this.queryDocuments(searchTerms, undefined, {}, limit);

    const suggestions: SearchSuggestion[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.entity_type}:${row.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({
        text: row.subtitle ? `${row.title} - ${row.subtitle}` : row.title,
        type: row.entity_type,
        count: 1,
      });
      if (suggestions.length >= limit) break;
    }

    return suggestions;
  }

  async getRecentSearches(userId?: string, limit = 10): Promise<string[]> {
    let query = this.db("search_analytics")
      .select("query", "time")
      .orderBy("time", "desc")
      .limit(limit * 5)
      .timeout(QUERY_TIMEOUT_MS);

    if (userId) {
      query = query.where("user_id", userId);
    } else {
      query = query.whereNull("user_id");
    }

    const rows = await query;
    const recent: string[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      if (seen.has(row.query)) continue;
      seen.add(row.query);
      recent.push(row.query);
      if (recent.length >= limit) break;
    }

    return recent;
  }

  async trackSearchAnalytics(
    query: string,
    userId?: string,
    resultsCount = 0,
    filters: Record<string, unknown> = {}
  ): Promise<void> {
    await this.db("search_analytics")
      .insert({
        query,
        user_id: userId ?? null,
        results_count: resultsCount,
        filters: JSON.stringify(filters),
        time: new Date(),
      })
      .timeout(QUERY_TIMEOUT_MS);
  }

  async trackResultClick(query: string, resultId: string, userId?: string): Promise<void> {
    let searchQuery = this.db("search_analytics")
      .select("id")
      .where({ query })
      .orderBy("time", "desc")
      .first();

    if (userId) {
      searchQuery = searchQuery.where("user_id", userId);
    } else {
      searchQuery = searchQuery.whereNull("user_id");
    }

    const row = await searchQuery;
    if (!row?.id) {
      return;
    }

    await this.db("search_analytics")
      .where({ id: row.id })
      .update({ clicked_result: resultId });
  }

  async rebuildSearchIndex(entityTypes: SearchEntityType[] = INDEX_ENTITY_TYPES): Promise<void> {
    logger.info({ entityTypes }, "Rebuilding search index");

    for (const entityType of entityTypes) {
      await this.reindexEntityType(entityType);
    }
  }

  async getIndexStatus(): Promise<
    Array<{
      entityType: string;
      lastIndexed: string | null;
      totalRecords: number;
      indexedRecords: number;
      status: string;
      errorMessage: string | null;
    }>
  > {
    const metadataRows = await this.db("search_index_metadata")
      .select("*")
      .whereIn("entity_type", INDEX_ENTITY_TYPES)
      .orderBy("entity_type", "asc")
      .timeout(QUERY_TIMEOUT_MS);

    return metadataRows.map((row) => ({
      entityType: String(row.entity_type),
      lastIndexed: row.last_indexed ? new Date(String(row.last_indexed)).toISOString() : null,
      totalRecords: Number(row.total_records ?? 0),
      indexedRecords: Number(row.indexed_records ?? 0),
      status: String(row.status ?? "unknown"),
      errorMessage: row.error_message ? String(row.error_message) : null,
    }));
  }

  async getAnalytics(options: {
    days?: number;
    userId?: string;
    limit?: number;
  }): Promise<Array<Record<string, unknown>>> {
    const { days, userId, limit } = options;
    let query = this.db("search_analytics")
      .select(
        "query",
        this.db.raw("COUNT(*) as search_count"),
        this.db.raw("AVG(COALESCE(results_count, 0)) as avg_results"),
        this.db.raw("MAX(time) as last_searched")
      )
      .groupBy("query")
      .orderBy("search_count", "desc");

    if (days) {
      const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      query = query.where("time", ">", daysAgo);
    }

    if (userId) {
      query = query.where("user_id", userId);
    }

    if (limit) {
      query = query.limit(limit);
    }

    return query;
  }

  private async syncIncrementalIndex(entityTypes: SearchEntityType[]): Promise<void> {
    const metadataRows = await this.db("search_index_metadata")
      .select("*")
      .whereIn("entity_type", entityTypes);
    const metadataByType = new Map<string, Record<string, unknown>>();
    for (const row of metadataRows) {
      metadataByType.set(String(row.entity_type), row as Record<string, unknown>);
    }

    for (const entityType of entityTypes) {
      const metadata = metadataByType.get(entityType);
      const lastIndexed = metadata?.last_indexed ? new Date(String(metadata.last_indexed)) : null;
      const shouldReindex =
        !lastIndexed ||
        String(metadata?.status ?? "pending") !== "ready" ||
        Date.now() - lastIndexed.getTime() > 60_000;

      if (!shouldReindex) {
        continue;
      }

      if (!lastIndexed || String(metadata?.status ?? "pending") !== "ready") {
        await this.reindexEntityType(entityType);
      } else {
        await this.indexEntityType(entityType, lastIndexed);
      }
    }
  }

  private async reindexEntityType(entityType: SearchEntityType): Promise<void> {
    await this.updateIndexMetadata(entityType, {
      status: "running",
      errorMessage: null,
    });

    try {
      const built = await this.buildDocuments(entityType);

      await this.db.transaction(async (trx) => {
        await trx("search_documents").where({ entity_type: entityType }).delete();
        await this.insertDocuments(trx, built.documents);
      });

      const indexedCount = await this.countIndexedDocuments(entityType);
      await this.updateIndexMetadata(entityType, {
        lastIndexed: new Date(),
        totalRecords: indexedCount,
        indexedRecords: indexedCount,
        status: "ready",
        errorMessage: null,
      });
    } catch (error) {
      logger.error({ entityType, error }, "Failed to rebuild search index entity");
      await this.updateIndexMetadata(entityType, {
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown search indexing error",
      });
      throw error;
    }
  }

  private async indexEntityType(entityType: SearchEntityType, since: Date): Promise<void> {
    await this.updateIndexMetadata(entityType, {
      status: "running",
      errorMessage: null,
    });

    try {
      const built = await this.buildDocuments(entityType, since);

      await this.db.transaction(async (trx) => {
        await this.insertDocuments(trx, built.documents);
        if (built.deleteDocumentKeys.length > 0) {
          await trx("search_documents")
            .whereIn("document_key", built.deleteDocumentKeys)
            .delete();
        }
      });

      const indexedCount = await this.countIndexedDocuments(entityType);
      await this.updateIndexMetadata(entityType, {
        lastIndexed: new Date(),
        totalRecords: indexedCount,
        indexedRecords: indexedCount,
        status: "ready",
        errorMessage: null,
      });
    } catch (error) {
      logger.error({ entityType, error }, "Failed to incrementally index entity");
      await this.updateIndexMetadata(entityType, {
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown search indexing error",
      });
    }
  }

  private async buildDocuments(
    entityType: SearchEntityType,
    since?: Date
  ): Promise<BuiltDocuments> {
    switch (entityType) {
      case "asset":
        return this.buildAssetDocuments(since);
      case "bridge":
        return this.buildBridgeDocuments(since);
      case "incident":
        return this.buildIncidentDocuments(since);
      case "alert":
        return this.buildAlertDocuments(since);
    }
  }

  private async buildAssetDocuments(since?: Date): Promise<BuiltDocuments> {
    let query = this.db("assets").select("*");
    if (since) {
      query = query.where("updated_at", ">", since);
    }

    const rows = await query;
    const deleteDocumentKeys = rows
      .filter((row) => !row.is_active)
      .map((row) => `asset:${row.id}`);

    const activeAssetIds = rows.filter((row) => row.is_active).map((row) => row.id);
    const tagRows = activeAssetIds.length
      ? await this.db("tags")
          .join("asset_tags", "tags.id", "asset_tags.tag_id")
          .whereIn("asset_tags.asset_id", activeAssetIds)
          .select("asset_tags.asset_id", "tags.name")
      : [];

    const tagsByAssetId = new Map<string, string[]>();
    for (const tr of tagRows) {
      const arr = tagsByAssetId.get(tr.asset_id) ?? [];
      arr.push(tr.name);
      tagsByAssetId.set(tr.asset_id, arr);
    }

    const documents = rows
      .filter((row) => row.is_active)
      .map<SearchIndexDocumentInput>((row) => {
        const tags = tagsByAssetId.get(row.id) ?? [];
        return {
          documentKey: `asset:${row.id}`,
          entityType: "asset",
          entityId: String(row.id),
          title: String(row.symbol),
          subtitle: [row.name, row.bridge_provider, row.source_chain, tags.length ? tags.join(", ") : ""].filter(Boolean).join(" · "),
          body: [row.name, row.asset_type, row.bridge_provider, row.source_chain, ...tags].filter(Boolean).join(" "),
          searchTokens: this.buildSearchTokens(
            String(row.symbol),
            row.name ? String(row.name) : "",
            row.bridge_provider ? String(row.bridge_provider) : "",
            row.source_chain ? String(row.source_chain) : "",
            ...tags
          ),
          metadata: {
            symbol: row.symbol,
            name: row.name,
            bridgeProvider: row.bridge_provider,
            sourceChain: row.source_chain,
            href: `/assets/${row.symbol}`,
            tags,
          },
          rankWeight: 120,
          visibility: "public",
          sourceUpdatedAt: new Date(row.updated_at ?? row.created_at ?? Date.now()),
        };
      });

    return { documents, deleteDocumentKeys };
  }

  private async buildBridgeDocuments(since?: Date): Promise<BuiltDocuments> {
    let query = this.db("bridges").select("*");
    if (since) {
      query = query.where("updated_at", ">", since);
    }

    const rows = await query;
    const deleteDocumentKeys = rows
      .filter((row) => !row.is_active)
      .map((row) => `bridge:${row.id}`);

    const documents = rows
      .filter((row) => row.is_active)
      .map<SearchIndexDocumentInput>((row) => ({
        documentKey: `bridge:${row.id}`,
        entityType: "bridge",
        entityId: String(row.id),
        title: String(row.name),
        subtitle: `${row.source_chain} · ${row.status}`,
        body: [
          row.name,
          row.source_chain,
          `status ${row.status}`,
          `tvl ${row.total_value_locked ?? 0}`,
        ].join(" "),
        searchTokens: this.buildSearchTokens(
          String(row.name),
          row.source_chain ? String(row.source_chain) : "",
          row.status ? String(row.status) : ""
        ),
        metadata: {
          sourceChain: row.source_chain,
          status: row.status,
          totalValueLocked: Number(row.total_value_locked ?? 0),
          href: "/bridges",
        },
        rankWeight: 110,
        visibility: "public",
        sourceUpdatedAt: new Date(row.updated_at ?? row.created_at ?? Date.now()),
      }));

    return { documents, deleteDocumentKeys };
  }

  private async buildIncidentDocuments(since?: Date): Promise<BuiltDocuments> {
    let query = this.db("bridge_incidents").select("*");
    if (since) {
      query = query.where("updated_at", ">", since);
    }

    const rows = await query.orderBy("occurred_at", "desc");
    const documents = rows.map<SearchIndexDocumentInput>((row) => ({
      documentKey: `incident:${row.id}`,
      entityType: "incident",
      entityId: String(row.id),
      title: String(row.title),
      subtitle: [row.bridge_id, row.asset_code, row.severity, row.status]
        .filter(Boolean)
        .join(" · "),
      body: [
        row.description,
        row.source_type,
        row.source_repository,
        Array.isArray(row.follow_up_actions)
          ? row.follow_up_actions.join(" ")
          : String(row.follow_up_actions ?? ""),
      ]
        .filter(Boolean)
        .join(" "),
      searchTokens: this.buildSearchTokens(
        String(row.title),
        String(row.description),
        row.bridge_id ? String(row.bridge_id) : "",
        row.asset_code ? String(row.asset_code) : "",
        row.severity ? String(row.severity) : "",
        row.status ? String(row.status) : ""
      ),
      metadata: {
        bridgeId: row.bridge_id,
        assetCode: row.asset_code,
        severity: row.severity,
        status: row.status,
        href: "/incidents",
      },
      rankWeight: this.priorityWeight(row.severity, {
        critical: 180,
        high: 160,
        medium: 140,
        low: 120,
      }),
      visibility: "public",
      sourceUpdatedAt: new Date(row.updated_at ?? row.created_at ?? row.occurred_at ?? Date.now()),
    }));

    return { documents, deleteDocumentKeys: [] };
  }

  private async buildAlertDocuments(since?: Date): Promise<BuiltDocuments> {
    let query = this.db("alert_events").select("*");
    if (since) {
      query = query.where("time", ">", since);
    }

    const rows = await query.orderBy("time", "desc");
    const documents = rows.map<SearchIndexDocumentInput>((row) => ({
      documentKey: `alert:${row.rule_id}:${row.time}:${row.alert_type}`,
      entityType: "alert",
      entityId: `${row.rule_id}:${row.time}`,
      title: `${this.humanize(row.priority)} ${this.humanize(row.alert_type)} alert for ${row.asset_code}`,
      subtitle: [row.metric, row.priority, row.asset_code].filter(Boolean).join(" · "),
      body: [
        `Triggered value ${row.triggered_value}`,
        `Threshold ${row.threshold}`,
        row.metric,
        row.alert_type,
        row.asset_code,
      ]
        .filter(Boolean)
        .join(" "),
      searchTokens: this.buildSearchTokens(
        row.alert_type ? String(row.alert_type) : "",
        row.asset_code ? String(row.asset_code) : "",
        row.metric ? String(row.metric) : "",
        row.priority ? String(row.priority) : ""
      ),
      metadata: {
        assetCode: row.asset_code,
        alertType: row.alert_type,
        priority: row.priority,
        metric: row.metric,
        href: "/settings",
      },
      rankWeight: this.priorityWeight(row.priority, {
        critical: 190,
        high: 170,
        medium: 145,
        low: 125,
      }),
      visibility: "public",
      sourceUpdatedAt: new Date(row.time ?? Date.now()),
    }));

    return { documents, deleteDocumentKeys: [] };
  }

  private async insertDocuments(
    trx: Knex | Knex.Transaction,
    documents: SearchIndexDocumentInput[]
  ): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    const payload = documents.map((document) => ({
      document_key: document.documentKey,
      entity_type: document.entityType,
      entity_id: document.entityId,
      title: document.title,
      subtitle: document.subtitle,
      body: document.body,
      search_tokens: document.searchTokens,
      metadata: JSON.stringify(document.metadata),
      rank_weight: document.rankWeight,
      visibility: document.visibility,
      source_updated_at: document.sourceUpdatedAt,
      indexed_at: new Date(),
    }));

    await trx("search_documents")
      .insert(payload)
      .onConflict("document_key")
      .merge([
        "entity_type",
        "entity_id",
        "title",
        "subtitle",
        "body",
        "search_tokens",
        "metadata",
        "rank_weight",
        "visibility",
        "source_updated_at",
        "indexed_at",
      ]);
  }

  private async queryDocuments(
    searchTerms: string[],
    type?: SearchEntityType,
    filters: Record<string, unknown> = {},
    requestedLimit = 20
  ): Promise<SearchDocumentRecord[]> {
    const scanLimit = Math.min(
      Math.max(requestedLimit * 6, 30),
      MAX_SEARCH_OFFSET + MAX_SEARCH_LIMIT
    );

    let query = this.db("search_documents")
      .select("*", this.db.raw("COUNT(*) OVER() AS total_count"))
      .where({ visibility: "public" });

    if (type) {
      query = query.andWhere("entity_type", type);
    }

    if (filters.status) {
      query = query.andWhereRaw("metadata::text ILIKE ?", [`%"status":"${String(filters.status)}"%`]);
    }
    if (filters.severity) {
      query = query.andWhereRaw("metadata::text ILIKE ?", [`%"severity":"${String(filters.severity)}"%`]);
    }
    if (filters.priority) {
      query = query.andWhereRaw("metadata::text ILIKE ?", [`%"priority":"${String(filters.priority)}"%`]);
    }
    if (filters.tag) {
      query = query.andWhereRaw("metadata->'tags' @> ?::jsonb", [JSON.stringify([filters.tag])]);
    }
    if (filters.tags && Array.isArray(filters.tags)) {
      query = query.andWhereRaw("metadata->'tags' @> ?::jsonb", [JSON.stringify(filters.tags)]);
    }

    query = query.andWhere(function searchMatcher() {
      for (const term of searchTerms) {
        const pattern = `%${term}%`;
        this.orWhere("title", "ILIKE", pattern);
        this.orWhere("subtitle", "ILIKE", pattern);
        this.orWhere("body", "ILIKE", pattern);
        this.orWhere("search_tokens", "ILIKE", pattern);
        this.orWhereRaw(
          "to_tsvector('simple', COALESCE(title, '') || ' ' || COALESCE(subtitle, '') || ' ' || COALESCE(body, '') || ' ' || COALESCE(search_tokens, '')) @@ plainto_tsquery('simple', ?)",
          [term]
        );
      }
    });

    return query.limit(scanLimit);
  }

  private normalizePaginationValue(
    value: number | undefined,
    defaultValue: number,
    maximum: number,
    field: "limit" | "offset",
    allowZero = false
  ): number {
    if (value === undefined) return defaultValue;
    const minimum = allowZero ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new RangeError(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
  }

  private mapRowToResult(row: SearchDocumentRecord, searchTerms: string[]): SearchResult {
    const metadata =
      typeof row.metadata === "string"
        ? (JSON.parse(row.metadata) as Record<string, unknown>)
        : ((row.metadata as Record<string, unknown>) ?? {});

    return {
      id: row.entity_id,
      type: row.entity_type,
      title: row.title,
      description: row.subtitle ?? row.body ?? "",
      relevanceScore: this.calculateRelevanceScore(row, searchTerms),
      highlights: this.generateHighlights(row, searchTerms),
      metadata,
    };
  }

  private calculateRelevanceScore(
    row: SearchDocumentRecord,
    searchTerms: string[]
  ): number {
    const title = row.title.toLowerCase();
    const subtitle = (row.subtitle ?? "").toLowerCase();
    const body = (row.body ?? "").toLowerCase();
    const tokens = (row.search_tokens ?? "").toLowerCase();

    let score = Number(row.rank_weight ?? 100);
    for (const term of searchTerms) {
      const normalized = term.toLowerCase();
      if (title === normalized) score += 220;
      else if (title.startsWith(normalized)) score += 140;
      else if (title.includes(normalized)) score += 95;

      if (subtitle.includes(normalized)) score += 45;
      if (body.includes(normalized)) score += 20;
      if (tokens.includes(normalized)) score += 30;
    }

    if (row.entity_type === "incident" || row.entity_type === "alert") {
      const updatedAt = new Date(row.source_updated_at);
      const ageHours = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
      if (ageHours <= 24) score += 30;
      else if (ageHours <= 168) score += 10;
    }

    return score;
  }

  private generateHighlights(row: SearchDocumentRecord, searchTerms: string[]): string[] {
    const combined = [row.title, row.subtitle ?? "", row.body ?? "", row.search_tokens ?? ""]
      .join(" ")
      .toLowerCase();
    const highlights: string[] = [];

    for (const term of searchTerms) {
      if (combined.includes(term.toLowerCase())) {
        highlights.push(term);
      }
    }

    return Array.from(new Set(highlights)).slice(0, 6);
  }

  private parseSearchQuery(query: string, fuzzy: boolean): string[] {
    const baseTerms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length >= 2);
    const expanded = new Set<string>();

    for (const term of baseTerms) {
      expanded.add(term);
      for (const synonym of SYNONYM_MAP[term] ?? []) {
        expanded.add(synonym.toLowerCase());
      }

      if (fuzzy && term.length > 3) {
        expanded.add(term.slice(0, -1));
        expanded.add(term.slice(1));
      }
    }

    return Array.from(expanded);
  }

  private buildSearchTokens(...parts: string[]): string {
    const tokens = new Set<string>();
    for (const part of parts) {
      const normalizedPart = part.trim().toLowerCase();
      if (!normalizedPart) continue;
      tokens.add(normalizedPart);
      for (const token of normalizedPart.split(/\s+/)) {
        tokens.add(token);
        for (const synonym of SYNONYM_MAP[token] ?? []) {
          tokens.add(synonym.toLowerCase());
        }
      }
    }

    return Array.from(tokens).join(" ");
  }

  private priorityWeight(
    value: unknown,
    weights: Record<string, number>
  ): number {
    return weights[String(value ?? "").toLowerCase()] ?? 100;
  }

  private humanize(value: unknown): string {
    return String(value ?? "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private async updateIndexMetadata(
    entityType: SearchEntityType,
    input: {
      lastIndexed?: Date;
      totalRecords?: number;
      indexedRecords?: number;
      status?: string;
      errorMessage?: string | null;
    }
  ): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (input.lastIndexed) patch.last_indexed = input.lastIndexed;
    if (input.totalRecords !== undefined) patch.total_records = input.totalRecords;
    if (input.indexedRecords !== undefined) patch.indexed_records = input.indexedRecords;
    if (input.status !== undefined) patch.status = input.status;
    if (input.errorMessage !== undefined) patch.error_message = input.errorMessage;

    const updated = await this.db("search_index_metadata")
      .where({ entity_type: entityType })
      .update(patch);

    if (updated === 0) {
      await this.db("search_index_metadata").insert({
        entity_type: entityType,
        last_indexed: input.lastIndexed ?? new Date(0),
        total_records: input.totalRecords ?? 0,
        indexed_records: input.indexedRecords ?? 0,
        status: input.status ?? "pending",
        error_message: input.errorMessage ?? null,
        index_config: JSON.stringify({ entityType }),
      });
    }
  }

  private async countIndexedDocuments(entityType: SearchEntityType): Promise<number> {
    const [{ count }] = await this.db("search_documents")
      .where({ entity_type: entityType })
      .count<{ count: string }[]>("document_key as count");

    return Number(count);
  }
}
