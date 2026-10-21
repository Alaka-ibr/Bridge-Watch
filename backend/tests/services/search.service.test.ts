import { describe, it, expect, vi, beforeEach } from "vitest";
import { SearchService } from "../../src/services/search.service.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Minimal chainable query-builder mock. Thenable so `await chain` resolves to rows.
function makeQB(rows: Record<string, unknown>[] = []) {
  const p = Promise.resolve(rows);
  const qb: Record<string, unknown> = {};
  for (const m of [
    "select", "where", "andWhere", "andWhereRaw", "orWhere", "orWhereRaw",
    "whereIn", "whereNull", "orderBy", "limit", "groupBy", "having", "timeout",
  ]) {
    qb[m] = vi.fn().mockReturnValue(qb);
  }
  qb.first  = vi.fn().mockResolvedValue(rows[0] ?? null);
  qb.insert = vi.fn().mockResolvedValue(undefined);
  qb.update = vi.fn().mockResolvedValue(1);
  qb.delete = vi.fn().mockResolvedValue(1);
  qb.count  = vi.fn().mockReturnValue(qb);
  qb.then   = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown
  ) => p.then(resolve, reject);
  return qb;
}

let metadataRows: Record<string, unknown>[] = [];
let documentRows: Record<string, unknown>[] = [];
let analyticsRows: Record<string, unknown>[] = [];
const analyticsInsert = vi.fn().mockReturnValue({
  timeout: vi.fn().mockResolvedValue(undefined),
});

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => {
    const db = (tableName: string) => {
      if (tableName === "search_index_metadata") return makeQB(metadataRows);
      if (tableName === "search_documents") return makeQB(documentRows);
      if (tableName === "search_analytics") {
        const qb = makeQB(analyticsRows);
        qb.insert = analyticsInsert;
        return qb;
      }
      return makeQB([]);
    };
    (db as any).transaction = vi.fn().mockImplementation(async (cb: unknown) => {
      if (typeof cb === "function") return cb(db);
    });
    (db as any).raw = vi.fn().mockReturnValue({});
    return db;
  }),
}));

// "Ready" metadata row — makes syncIncrementalIndex short-circuit without reindexing.
function readyMetadata(entityType: string) {
  return {
    entity_type: entityType,
    last_indexed: new Date().toISOString(),
    status: "ready",
    total_records: 1,
    indexed_records: 1,
    error_message: null,
  };
}

const ALL_TYPES = ["asset", "bridge", "incident", "alert"];

function mockBridgeDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    document_key: "bridge:doc-1",
    entity_id: "doc-1",
    entity_type: "bridge",
    title: "USDC Bridge",
    subtitle: "Stellar · active",
    body: "Stellar USDC bridge status active tvl 1000000",
    search_tokens: "usdc bridge stellar",
    metadata: JSON.stringify({ sourceChain: "Stellar", status: "active", href: "/bridges" }),
    rank_weight: 110,
    visibility: "public",
    source_updated_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    indexed_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("SearchService", () => {
  let service: SearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    metadataRows = ALL_TYPES.map(readyMetadata);
    documentRows = [];
    analyticsRows = [];
    service = new SearchService();
  });

  // ── Query guard ────────────────────────────────────────────────────────────

  describe("search — empty / short query guard", () => {
    it("returns empty result for blank query", async () => {
      const result = await service.search({ query: "" });
      expect(result).toEqual({ results: [], total: 0 });
    });

    it("returns empty result for whitespace query", async () => {
      const result = await service.search({ query: "   " });
      expect(result).toEqual({ results: [], total: 0 });
    });

    it("returns empty result for single-character query", async () => {
      const result = await service.search({ query: "a" });
      expect(result).toEqual({ results: [], total: 0 });
    });
  });

  describe("getSuggestions — empty / short query guard", () => {
    it("returns empty for blank query", async () => {
      expect(await service.getSuggestions("")).toEqual([]);
    });

    it("returns empty for single-character query", async () => {
      expect(await service.getSuggestions("a")).toEqual([]);
    });
  });

  // ── Query parsing ──────────────────────────────────────────────────────────

  describe("query parsing (parseSearchQuery)", () => {
    it("filters out terms shorter than 2 characters", () => {
      const terms = (service as any).parseSearchQuery("a b usdc", false) as string[];
      expect(terms).not.toContain("a");
      expect(terms).not.toContain("b");
      expect(terms).toContain("usdc");
    });

    it("expands USDC synonym", () => {
      const terms = (service as any).parseSearchQuery("usdc", false) as string[];
      expect(terms).toContain("usdc");
      expect(terms).toContain("usd coin");
      expect(terms).toContain("circle usdc");
    });

    it("expands XLM synonym to stellar lumens", () => {
      const terms = (service as any).parseSearchQuery("xlm", false) as string[];
      expect(terms).toContain("xlm");
      expect(terms).toContain("stellar lumens");
    });

    it("expands bridge synonym", () => {
      const terms = (service as any).parseSearchQuery("bridge", false) as string[];
      expect(terms).toContain("bridge");
      expect(terms).toContain("cross chain");
    });

    it("adds fuzzy prefix/suffix variants when fuzzy=true and term length > 3", () => {
      const terms = (service as any).parseSearchQuery("stellar", true) as string[];
      expect(terms).toContain("stellar");
      expect(terms).toContain("stella"); // slice(0,-1)
      expect(terms).toContain("tellar"); // slice(1)
    });

    it("does not add fuzzy variants when fuzzy=false", () => {
      const terms = (service as any).parseSearchQuery("stellar", false) as string[];
      expect(terms).toContain("stellar");
      expect(terms).not.toContain("stella");
      expect(terms).not.toContain("tellar");
    });

    it("deduplicates terms", () => {
      const terms = (service as any).parseSearchQuery("usdc usdc", false) as string[];
      const usdcCount = terms.filter((t: string) => t === "usdc").length;
      expect(usdcCount).toBe(1);
    });
  });

  // ── Relevance ranking ──────────────────────────────────────────────────────

  describe("relevance ranking (calculateRelevanceScore)", () => {
    const baseRow = {
      document_key: "bridge:1",
      entity_id: "1",
      entity_type: "bridge" as const,
      title: "Some Bridge",
      subtitle: "",
      body: "",
      search_tokens: "",
      metadata: "{}",
      rank_weight: 100,
      visibility: "public",
      source_updated_at: new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString(),
      indexed_at: new Date().toISOString(),
    };

    it("gives exact title match the highest boost", () => {
      const exactScore = (service as any).calculateRelevanceScore(
        { ...baseRow, title: "usdc" },
        ["usdc"]
      ) as number;
      const prefixScore = (service as any).calculateRelevanceScore(
        { ...baseRow, title: "usdc bridge" },
        ["usdc"]
      ) as number;
      expect(exactScore).toBeGreaterThan(prefixScore);
    });

    it("ranks title match above body-only match", () => {
      const titleScore = (service as any).calculateRelevanceScore(
        { ...baseRow, title: "usdc bridge", body: "some text" },
        ["usdc"]
      ) as number;
      const bodyScore = (service as any).calculateRelevanceScore(
        { ...baseRow, title: "other bridge", body: "usdc related content" },
        ["usdc"]
      ) as number;
      expect(titleScore).toBeGreaterThan(bodyScore);
    });

    it("ranks subtitle match above body match", () => {
      const subtitleScore = (service as any).calculateRelevanceScore(
        { ...baseRow, subtitle: "usdc info", body: "some body" },
        ["usdc"]
      ) as number;
      const bodyScore = (service as any).calculateRelevanceScore(
        { ...baseRow, subtitle: "other info", body: "usdc body content" },
        ["usdc"]
      ) as number;
      expect(subtitleScore).toBeGreaterThan(bodyScore);
    });

    it("adds recency boost for recent incidents", () => {
      const recentScore = (service as any).calculateRelevanceScore(
        { ...baseRow, entity_type: "incident", source_updated_at: new Date().toISOString() },
        ["incident"]
      ) as number;
      const oldScore = (service as any).calculateRelevanceScore(
        { ...baseRow, entity_type: "incident", source_updated_at: new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString() },
        ["incident"]
      ) as number;
      expect(recentScore).toBeGreaterThan(oldScore);
    });
  });

  // ── Highlight generation ───────────────────────────────────────────────────

  describe("highlight generation (generateHighlights)", () => {
    it("returns search terms that appear in the document", () => {
      const row = {
        title: "USDC Bridge",
        subtitle: "Stellar",
        body: "cross-chain usdc transfer",
        search_tokens: "usdc bridge stellar",
      };
      const highlights = (service as any).generateHighlights(row, ["usdc", "bridge"]) as string[];
      expect(highlights).toContain("usdc");
      expect(highlights).toContain("bridge");
    });

    it("excludes terms not present in the document", () => {
      const row = {
        title: "Bridge",
        subtitle: null,
        body: null,
        search_tokens: "bridge",
      };
      const highlights = (service as any).generateHighlights(row, ["usdc", "bridge"]) as string[];
      expect(highlights).not.toContain("usdc");
    });

    it("deduplicates highlight terms", () => {
      const row = {
        title: "usdc usdc",
        subtitle: null,
        body: null,
        search_tokens: "usdc",
      };
      const highlights = (service as any).generateHighlights(row, ["usdc"]) as string[];
      expect(highlights.filter((h: string) => h === "usdc").length).toBe(1);
    });

    it("caps highlights at 6 entries", () => {
      const terms = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"];
      const row = {
        title: terms.join(" "),
        subtitle: null,
        body: null,
        search_tokens: terms.join(" "),
      };
      const highlights = (service as any).generateHighlights(row, terms) as string[];
      expect(highlights.length).toBeLessThanOrEqual(6);
    });
  });

  // ── search() with results ─────────────────────────────────────────────────

  describe("search — result ranking and filtering", () => {
    it("defaults to 25 results and rejects pagination outside service bounds", async () => {
      documentRows = Array.from({ length: 30 }, (_, i) =>
        mockBridgeDoc({ entity_id: String(i), title: `Bridge ${i}`, search_tokens: "bridge query" })
      );
      metadataRows = [readyMetadata("bridge")];
      vi.spyOn(service as any, "trackSearchAnalytics").mockResolvedValue(undefined);

      const result = await service.search({ query: "bridge query", type: "bridge" });
      expect(result.results).toHaveLength(25);
      await expect(service.search({ query: "bridge", limit: 101 })).rejects.toThrow(RangeError);
      await expect(service.search({ query: "bridge", offset: -1 })).rejects.toThrow(RangeError);
      await expect(service.search({ query: "bridge", offset: 1001 })).rejects.toThrow(RangeError);
    });

    it("returns the database total independently of the current page", async () => {
      documentRows = [mockBridgeDoc({ total_count: "137" })];
      metadataRows = [readyMetadata("bridge")];
      vi.spyOn(service as any, "trackSearchAnalytics").mockResolvedValue(undefined);

      const result = await service.search({ query: "bridge", type: "bridge", limit: 1 });
      expect(result.total).toBe(137);
    });

    it("returns results sorted by relevance (title match first)", async () => {
      documentRows = [
        mockBridgeDoc({
          entity_id: "body-only",
          title: "Some Other Bridge",
          body: "usdc is mentioned here",
          search_tokens: "bridge some",
        }),
        mockBridgeDoc({
          entity_id: "title-match",
          title: "USDC Bridge",
          body: "a usdc bridge",
          search_tokens: "usdc bridge",
        }),
      ];
      metadataRows = [readyMetadata("bridge")];

      vi.spyOn(service as any, "trackSearchAnalytics").mockResolvedValue(undefined);

      const { results, total } = await service.search({ query: "usdc", type: "bridge" });
      expect(total).toBe(2);
      expect(results[0].id).toBe("title-match");
    });

    it("respects offset and limit", async () => {
      documentRows = Array.from({ length: 5 }, (_, i) =>
        mockBridgeDoc({ entity_id: String(i), title: `Bridge ${i}`, search_tokens: "bridge query" })
      );
      metadataRows = [readyMetadata("bridge")];
      vi.spyOn(service as any, "trackSearchAnalytics").mockResolvedValue(undefined);

      const { results, total } = await service.search({
        query: "bridge query",
        type: "bridge",
        limit: 2,
        offset: 1,
      });
      expect(total).toBe(5);
      expect(results.length).toBe(2);
    });

    it("returns empty results for query shorter than 2 chars", async () => {
      const { results, total } = await service.search({ query: "x" });
      expect(results).toEqual([]);
      expect(total).toBe(0);
    });
  });

  // ── getSuggestions ─────────────────────────────────────────────────────────

  describe("getSuggestions", () => {
    it("returns suggestions from indexed documents", async () => {
      documentRows = [mockBridgeDoc()];
      metadataRows = ALL_TYPES.map(readyMetadata);
      vi.spyOn(service as any, "trackSearchAnalytics").mockResolvedValue(undefined);

      const suggestions = await service.getSuggestions("usdc");
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].type).toBe("bridge");
    });

    it("deduplicates suggestion text across rows", async () => {
      documentRows = [mockBridgeDoc(), mockBridgeDoc()];
      metadataRows = ALL_TYPES.map(readyMetadata);

      const suggestions = await service.getSuggestions("usdc");
      const texts = suggestions.map((s) => `${s.type}:${s.text}`);
      expect(new Set(texts).size).toBe(texts.length);
    });
  });

  // ── trackSearchAnalytics ───────────────────────────────────────────────────

  describe("trackSearchAnalytics", () => {
    it("inserts an analytics row with the query and result count", async () => {
      await service.trackSearchAnalytics("usdc", undefined, 5, {});
      expect(analyticsInsert).toHaveBeenCalledOnce();
      const [payload] = analyticsInsert.mock.calls[0] as [Record<string, unknown>];
      expect(payload.query).toBe("usdc");
      expect(payload.results_count).toBe(5);
      expect(payload.user_id).toBeNull();
    });

    it("stores userId when provided", async () => {
      await service.trackSearchAnalytics("bridge", "user-42", 3, {});
      const [payload] = analyticsInsert.mock.calls[0] as [Record<string, unknown>];
      expect(payload.user_id).toBe("user-42");
    });
  });

  // ── getIndexStatus ─────────────────────────────────────────────────────────

  describe("getIndexStatus", () => {
    it("maps metadata rows to status objects", async () => {
      const now = new Date();
      metadataRows = [
        {
          entity_type: "bridge",
          last_indexed: now.toISOString(),
          total_records: 42,
          indexed_records: 42,
          status: "ready",
          error_message: null,
        },
      ];

      const statuses = await service.getIndexStatus();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].entityType).toBe("bridge");
      expect(statuses[0].totalRecords).toBe(42);
      expect(statuses[0].status).toBe("ready");
      expect(statuses[0].errorMessage).toBeNull();
    });

    it("returns null lastIndexed for rows with no last_indexed", async () => {
      metadataRows = [
        {
          entity_type: "asset",
          last_indexed: null,
          total_records: 0,
          indexed_records: 0,
          status: "pending",
          error_message: null,
        },
      ];

      const statuses = await service.getIndexStatus();
      expect(statuses[0].lastIndexed).toBeNull();
    });
  });
});
