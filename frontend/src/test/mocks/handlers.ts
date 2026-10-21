import { http, HttpResponse } from "msw";

let serviceAnnotations: Array<Record<string, unknown>> = [
  {
    id: "ann-1",
    serviceName: "price-service",
    entityType: "source",
    entityId: null,
    content: "Scheduled maintenance window",
    author: "operator",
    startTime: new Date(Date.now() - 3600000).toISOString(),
    endTime: new Date(Date.now() + 3600000).toISOString(),
    active: true,
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: "ann-2",
    serviceName: "horizon",
    entityType: "system",
    entityId: "core-api",
    content: "Rate limit increased due to traffic spike",
    author: "admin",
    startTime: null,
    endTime: null,
    active: true,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

export const handlers = [
  // Mock Assets
  http.get("/api/v1/assets", () => {
    return HttpResponse.json({
      assets: [
        { symbol: "XLM", name: "Stellar" },
        { symbol: "USDC", name: "USDC" },
      ],
      total: 2,
    });
  }),

  // Mock Bridges
  http.get("/api/v1/bridges", () => {
    return HttpResponse.json({
      bridges: [
        {
          name: "Circle",
          status: "healthy",
          totalValueLocked: 500000000,
          mismatchPercentage: 0,
        },
        {
          name: "Wormhole",
          status: "degraded",
          totalValueLocked: 200000000,
          mismatchPercentage: 5.26,
        },
      ],
    });
  }),

  // Mock Asset Health
  http.get("/api/v1/assets/:symbol/health", ({ params }) => {
    return HttpResponse.json({
      symbol: params.symbol,
      overallScore: 85,
      factors: {
        liquidityDepth: 90,
        priceStability: 80,
        bridgeUptime: 100,
        reserveBacking: 85,
        volumeTrend: 70,
      },
      trend: "stable",
      lastUpdated: new Date().toISOString(),
    });
  }),

  // Mock Asset Health History
  http.get("/api/v1/assets/:symbol/health/history", () => {
    return HttpResponse.json([
      { timestamp: new Date(Date.now() - 86400000).toISOString(), score: 80 },
      { timestamp: new Date().toISOString(), score: 85 },
    ]);
  }),

  // Mock Asset Price
  http.get("/api/v1/assets/:symbol/price", ({ params }) => {
    return HttpResponse.json({
      symbol: params.symbol,
      vwap: 0.1234,
      sources: [{ source: "Binance", price: 0.1235, timestamp: new Date().toISOString() }],
      deviation: 0.05,
      lastUpdated: new Date().toISOString(),
    });
  }),

  // Mock indexed search endpoint used by GlobalSearch / SearchModal autocomplete
  http.get("/api/v1/search", ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";

    const allResults = [
      {
        id: "xlm",
        type: "asset" as const,
        title: "XLM",
        description: "Stellar Lumens",
        relevanceScore: 1,
        highlights: ["XLM"],
        metadata: { symbol: "XLM" },
      },
      {
        id: "usdc",
        type: "asset" as const,
        title: "USDC",
        description: "USD Coin",
        relevanceScore: 0.9,
        highlights: ["USDC"],
        metadata: { symbol: "USDC" },
      },
      {
        id: "stellar-bridge",
        type: "bridge" as const,
        title: "Stellar Bridge",
        description: "Cross-chain bridge for Stellar assets",
        relevanceScore: 0.8,
        highlights: ["Stellar"],
        metadata: {},
      },
    ];

    const q = query.toLowerCase();
    const results = q
      ? allResults.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q)
        )
      : [];

    return HttpResponse.json({
      success: true,
      data: { results, total: results.length },
    });
  }),

  // Mock External Dependencies (Service Health)
  http.get("/api/v1/external-dependencies", () => {
    return HttpResponse.json({
      dependencies: [
        {
          providerKey: "horizon",
          displayName: "Horizon API",
          category: "blockchain",
          endpoint: "https://horizon.stellar.org",
          checkType: "http",
          latencyWarningMs: 1000,
          latencyCriticalMs: 3000,
          failureThreshold: 3,
          maintenanceMode: false,
          maintenanceNote: null,
          status: "healthy",
          lastCheckedAt: new Date().toISOString(),
          lastLatencyMs: 250,
          consecutiveFailures: 0,
          lastSuccessAt: new Date().toISOString(),
          lastFailureAt: null,
          lastError: null,
          alertState: "none",
        },
        {
          providerKey: "circle",
          displayName: "Circle API",
          category: "price",
          endpoint: "https://api.circle.com",
          checkType: "http",
          latencyWarningMs: 2000,
          latencyCriticalMs: 5000,
          failureThreshold: 3,
          maintenanceMode: false,
          maintenanceNote: null,
          status: "healthy",
          lastCheckedAt: new Date().toISOString(),
          lastLatencyMs: 180,
          consecutiveFailures: 0,
          lastSuccessAt: new Date().toISOString(),
          lastFailureAt: null,
          lastError: null,
          alertState: "none",
        },
      ],
      summary: {
        healthy: 2,
        degraded: 0,
        down: 0,
        maintenance: 0,
        unknown: 0,
      },
    });
  }),

  // Service Annotations
  http.get("/api/v1/service-annotations", () => {
    return HttpResponse.json(serviceAnnotations);
  }),

  http.get("/api/v1/service-annotations/:id", ({ params }) => {
    const ann = serviceAnnotations.find((a) => a.id === params.id);
    if (!ann) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(ann);
  }),

  http.post("/api/v1/service-annotations", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const newAnn = {
      id: `ann-${Date.now()}`,
      serviceName: body.serviceName,
      entityType: body.entityType ?? "source",
      entityId: body.entityId ?? null,
      content: body.content,
      author: body.author,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    serviceAnnotations = [newAnn, ...serviceAnnotations];
    return HttpResponse.json(newAnn, { status: 201 });
  }),

  http.patch("/api/v1/service-annotations/:id", async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const index = serviceAnnotations.findIndex((a) => a.id === params.id);
    if (index === -1) return new HttpResponse(null, { status: 404 });
    serviceAnnotations[index] = {
      ...serviceAnnotations[index],
      ...(body.content !== undefined ? { content: body.content } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.startTime !== undefined ? { startTime: body.startTime } : {}),
      ...(body.endTime !== undefined ? { endTime: body.endTime } : {}),
      updatedAt: new Date().toISOString(),
    };
    return HttpResponse.json(serviceAnnotations[index]);
  }),

  http.delete("/api/v1/service-annotations/:id", ({ params }) => {
    const index = serviceAnnotations.findIndex((a) => a.id === params.id);
    if (index === -1) return new HttpResponse(null, { status: 404 });
    serviceAnnotations = serviceAnnotations.filter((a) => a.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get("/api/v1/service-annotations/:id/audit", ({ params }) => {
    return HttpResponse.json([
      {
        id: "audit-1",
        annotation_id: params.id,
        action: "created",
        actor: "operator",
        changes: JSON.stringify({}),
        created_at: new Date().toISOString(),
      },
    ]);
  }),
];
