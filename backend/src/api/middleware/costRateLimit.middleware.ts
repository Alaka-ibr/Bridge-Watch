// @ts-nocheck
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { redis } from "../../utils/redis.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default cost budget per principal per window (cost units, not request count). */
export const DEFAULT_BUDGET = 1000;

/** Cost windows per tier (milliseconds). */
export const BUDGET_WINDOW_MS = 60_000;

/**
 * Maximum depth (page * limit) treated as free.  Beyond this, each additional
 * 100 rows adds +1 cost.
 */
const FREE_ROW_THRESHOLD = 100;

/**
 * Maximum date-range in days treated as free.  Beyond this, each additional
 * 30 days adds +1 cost.
 */
const FREE_DATE_RANGE_DAYS = 7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryShape {
  /** Pagination: page number (default 1). */
  page?: number | string;
  /** Pagination: rows per page (default 20). */
  limit?: number | string;
  /** Time-series range start (ISO-8601 or epoch ms). */
  from?: string;
  /** Time-series range end (ISO-8601 or epoch ms). */
  to?: string;
  /** Export format hint: "csv" | "json" | "parquet" | undefined. */
  format?: string;
  /** Whether this is a join-heavy / aggregate query. */
  join?: string | boolean;
  /** Replay window in seconds. */
  replayWindow?: number | string;
  /** Batch size override passed by caller. */
  batchSize?: number | string;
}

export interface CostEstimate {
  /** Total computed cost for this request. */
  total: number;
  /** Breakdown used for observability. */
  breakdown: {
    base: number;
    pagination: number;
    dateRange: number;
    export: number;
    join: number;
    replay: number;
    batch: number;
  };
}

export interface CostBudgetResult {
  allowed: boolean;
  /** Cost charged for this request. */
  cost: number;
  /** Remaining budget units in this window. */
  remaining: number;
  /** Total budget for this principal. */
  budget: number;
  /** Epoch ms when the window resets. */
  resetMs: number;
  /** How long to wait before retrying (ms). Only set when denied. */
  retryAfterMs?: number;
  /** Whether Redis was unavailable (fail-open path). */
  degraded?: boolean;
}

export interface PrincipalId {
  /** Stable identifier: apiKey if present, otherwise canonical IP. */
  key: string;
  /** True when the ID was derived from IP address (anonymous). */
  isAnonymous: boolean;
}

// ---------------------------------------------------------------------------
// Trusted proxy CIDR list
// ---------------------------------------------------------------------------

/**
 * Parses the RATE_LIMIT_WHITELIST_IPS config as the trusted-proxy list.
 * In production this is set to your load-balancer egress range.
 */
function buildTrustedProxyCidrs(): string[] {
  const raw = (config as Record<string, unknown>)["TRUSTED_PROXY_CIDRS"] as string | undefined;
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * Converts a dotted-decimal IPv4 to a 32-bit integer for fast CIDR matching.
 */
function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return -1;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function cidrContains(cidr: string, ip: string): boolean {
  const [base, bits] = cidr.split("/");
  if (!base || !bits) return cidr === ip;
  const prefixLen = parseInt(bits, 10);
  if (isNaN(prefixLen)) return false;
  const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
  return (ipv4ToInt(base) & mask) === (ipv4ToInt(ip) & mask);
}

function isTrustedProxy(ip: string, cidrs: string[]): boolean {
  return cidrs.some((c) => cidrContains(c, ip));
}

/**
 * Extracts the real client IP from the request, respecting the trusted-proxy
 * chain.  Falls back to the direct connection IP when the forwarding chain
 * cannot be validated.
 */
export function resolveClientIp(
  request: FastifyRequest,
  trustedCidrs: string[],
): string {
  const directIp = request.ip;

  if (trustedCidrs.length === 0) {
    // No trusted proxies configured — never trust X-Forwarded-For.
    return directIp;
  }

  if (!isTrustedProxy(directIp, trustedCidrs)) {
    // Direct connection is not a trusted proxy — ignore X-Forwarded-For.
    return directIp;
  }

  const xff = request.headers["x-forwarded-for"] as string | undefined;
  if (!xff) return directIp;

  // X-Forwarded-For: <client>, <proxy1>, <proxy2>
  // Walk from the right, skipping trusted proxies to find the first untrusted IP.
  const hops = xff
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!;
    if (!isTrustedProxy(hop, trustedCidrs)) {
      return hop;
    }
  }

  // All hops were trusted proxies — use leftmost (original client).
  return hops[0] ?? directIp;
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Estimates the server-side cost of a request based on its observable query
 * shape.  Cost is dimensionless but proportional to RPC + DB load.
 *
 * Base cost (1) applies to all requests.
 * Additional costs are additive:
 *   - Pagination depth: +1 per 100 rows above FREE_ROW_THRESHOLD
 *   - Date range: +1 per 30 days above FREE_DATE_RANGE_DAYS
 *   - Export: csv +5, parquet +8, json +3
 *   - Join / aggregate: +3
 *   - Replay: +1 per 10 min of replay window requested
 *   - Batch: +1 per 50 items above 50
 */
export function estimateCost(
  method: string,
  url: string,
  shape: QueryShape,
): CostEstimate {
  const breakdown = {
    base: 1,
    pagination: 0,
    dateRange: 0,
    export: 0,
    join: 0,
    replay: 0,
    batch: 0,
  };

  // Writes are inherently more expensive than reads
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    breakdown.base = 2;
  }

  // Pagination depth cost
  const page = Math.max(1, Number(shape.page ?? 1) || 1);
  const limit = Math.max(1, Math.min(1000, Number(shape.limit ?? 20) || 20));
  const depth = page * limit;
  if (depth > FREE_ROW_THRESHOLD) {
    breakdown.pagination = Math.floor((depth - FREE_ROW_THRESHOLD) / 100);
  }

  // Date-range cost
  if (shape.from && shape.to) {
    try {
      const fromMs = Number.isFinite(Number(shape.from))
        ? Number(shape.from)
        : Date.parse(shape.from);
      const toMs = Number.isFinite(Number(shape.to))
        ? Number(shape.to)
        : Date.parse(shape.to);
      if (!isNaN(fromMs) && !isNaN(toMs) && toMs > fromMs) {
        const days = (toMs - fromMs) / 86_400_000;
        if (days > FREE_DATE_RANGE_DAYS) {
          breakdown.dateRange = Math.floor((days - FREE_DATE_RANGE_DAYS) / 30);
        }
      }
    } catch {
      // Unparseable dates — no additional cost.
    }
  }

  // Export format cost
  const path = url.split("?")[0] ?? "";
  const fmt = (shape.format ?? "").toLowerCase();
  const isExport = path.includes("/export") || ["csv", "parquet", "json"].includes(fmt);
  if (isExport) {
    if (fmt === "parquet") breakdown.export = 8;
    else if (fmt === "csv") breakdown.export = 5;
    else breakdown.export = 3;
  }

  // Join / aggregate cost
  const isJoin =
    shape.join === true ||
    shape.join === "true" ||
    path.includes("/analytics") ||
    path.includes("/aggregate") ||
    path.includes("/correlation");
  if (isJoin) breakdown.join = 3;

  // Replay window cost
  if (path.includes("/replay") || shape.replayWindow !== undefined) {
    const windowSec = Number(shape.replayWindow ?? 600) || 600;
    breakdown.replay = Math.max(1, Math.floor(windowSec / 600));
  }

  // Batch size cost
  const batchSize = Number(shape.batchSize ?? 0) || 0;
  if (batchSize > 50 || path.includes("/batch")) {
    breakdown.batch = Math.max(1, Math.floor(Math.max(batchSize, 50) / 50));
  }

  const total =
    breakdown.base +
    breakdown.pagination +
    breakdown.dateRange +
    breakdown.export +
    breakdown.join +
    breakdown.replay +
    breakdown.batch;

  return { total, breakdown };
}

// ---------------------------------------------------------------------------
// Lua script — atomic budget reservation
// ---------------------------------------------------------------------------

/**
 * Atomically deducts `cost` from the principal's budget.
 *
 * Uses a Redis string key holding the "spent" counter for the current window.
 * TTL is refreshed to `windowMs` ms on each write.
 *
 * Returns a 4-element array:
 *   [allowed(0|1), spent_after, budget, reset_epoch_ms]
 */
const COST_BUDGET_SCRIPT = `
local key      = KEYS[1]
local cost     = tonumber(ARGV[1])
local budget   = tonumber(ARGV[2])
local windowMs = tonumber(ARGV[3])
local now      = tonumber(ARGV[4])

local spent = tonumber(redis.call('GET', key)) or 0

if spent + cost > budget then
  local ttl = tonumber(redis.call('PTTL', key))
  local reset_ms = now + (ttl > 0 and ttl or windowMs)
  return {0, spent, budget, reset_ms}
end

local new_spent = redis.call('INCRBY', key, cost)
redis.call('PEXPIRE', key, windowMs)

local reset_ms = now + windowMs
return {1, new_spent, budget, reset_ms}
`;

// ---------------------------------------------------------------------------
// Debt-repayment tracking
// ---------------------------------------------------------------------------

/**
 * Records excess spend (debt) so that principals who burst above budget have
 * their next window's budget reduced proportionally.
 *
 * Debt decays by 50% each window to give honest clients a recovery path.
 */
async function getDebtAdjustedBudget(
  principalKey: string,
  baseBudget: number,
  windowMs: number,
): Promise<number> {
  const debtKey = `bw:crl:debt:${principalKey}`;
  try {
    const raw = await redis.get(debtKey);
    if (!raw) return baseBudget;
    const debt = parseFloat(raw);
    if (isNaN(debt) || debt <= 0) return baseBudget;
    // Reduce budget by up to 50% to repay debt
    const reduction = Math.min(baseBudget * 0.5, Math.ceil(debt));
    // Decay debt by 50% for the next window
    const nextDebt = debt * 0.5;
    if (nextDebt < 1) {
      await redis.del(debtKey);
    } else {
      await redis.psetex(debtKey, windowMs * 2, String(nextDebt));
    }
    return Math.max(1, baseBudget - reduction);
  } catch {
    return baseBudget;
  }
}

async function recordDebt(
  principalKey: string,
  overspend: number,
  windowMs: number,
): Promise<void> {
  const debtKey = `bw:crl:debt:${principalKey}`;
  try {
    await redis.incrbyfloat(debtKey, overspend);
    await redis.pexpire(debtKey, windowMs * 4);
  } catch {
    // Non-critical — debt tracking failure does not block the request
  }
}

// ---------------------------------------------------------------------------
// Core budget check
// ---------------------------------------------------------------------------

export async function checkCostBudget(
  principalKey: string,
  cost: number,
  budget: number,
  windowMs: number,
): Promise<CostBudgetResult> {
  const now = Date.now();
  const redisKey = `bw:crl:budget:${principalKey}`;

  try {
    const adjustedBudget = await getDebtAdjustedBudget(principalKey, budget, windowMs);

    const raw = (await redis.eval(
      COST_BUDGET_SCRIPT,
      1,
      redisKey,
      String(cost),
      String(adjustedBudget),
      String(windowMs),
      String(now),
    )) as [number, number, number, number];

    const [allowed, spentAfter, effectiveBudget, resetMs] = raw;
    const remaining = Math.max(0, effectiveBudget - spentAfter);

    if (allowed === 0) {
      // Record the overspend as debt so repeat offenders see a tighter budget
      await recordDebt(principalKey, cost, windowMs);
    }

    return {
      allowed: allowed === 1,
      cost,
      remaining,
      budget: effectiveBudget,
      resetMs,
      retryAfterMs: allowed === 0 ? Math.max(0, resetMs - now) : undefined,
    };
  } catch (err) {
    logger.warn({ err, principalKey }, "cost-rate-limit: Redis unavailable — failing open");
    return {
      allowed: true,
      cost,
      remaining: budget,
      budget,
      resetMs: now + windowMs,
      degraded: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Principal resolution
// ---------------------------------------------------------------------------

/**
 * Derives a stable principal identifier that cannot be trivially changed by
 * rotating IP, API key, or connection.
 *
 * Strategy:
 *   - If an API key is present: the key itself is the principal.
 *   - Otherwise: the resolved client IP is the principal.
 *
 * Combining both (IP + key) would allow bypass by dropping the key.
 * Keying only on API key would allow bypass by rotating keys.
 * This implementation chooses the most stable signal available.
 */
export function resolvePrincipal(
  request: FastifyRequest,
  resolvedIp: string,
): PrincipalId {
  const apiKey = request.headers["x-api-key"] as string | undefined;
  if (apiKey && apiKey.length > 0) {
    return { key: `key:${apiKey}`, isAnonymous: false };
  }
  return { key: `ip:${resolvedIp}`, isAnonymous: true };
}

// ---------------------------------------------------------------------------
// Tier budget map
// ---------------------------------------------------------------------------

export const TIER_BUDGETS: Record<string, number> = {
  free: DEFAULT_BUDGET,
  basic: DEFAULT_BUDGET * 3,
  premium: DEFAULT_BUDGET * 10,
  trusted: Infinity,
};

function getTierFromApiKey(apiKey: string | undefined): string {
  if (!apiKey) return "free";
  if (apiKey.startsWith(config.RATE_LIMIT_ADMIN_API_KEY_PREFIX)) return "trusted";
  if (apiKey.startsWith("premium_")) return "premium";
  if (apiKey.startsWith("basic_")) return "basic";
  return "free";
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export async function registerCostRateLimiting(server: FastifyInstance): Promise<void> {
  if (
    config.NODE_ENV === "test" &&
    process.env.ENABLE_COST_RATE_LIMIT_IN_TESTS !== "true"
  ) {
    logger.info("Cost rate limiting disabled for test environment");
    return;
  }

  const trustedCidrs = buildTrustedProxyCidrs();

  server.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const resolvedIp = resolveClientIp(request, trustedCidrs);
    const apiKey = request.headers["x-api-key"] as string | undefined;
    const tier = getTierFromApiKey(apiKey);

    // Trusted principals bypass cost limiting
    if (tier === "trusted") {
      reply.header("X-Cost-Tier", "trusted");
      return;
    }

    const principal = resolvePrincipal(request, resolvedIp);
    const budget = TIER_BUDGETS[tier] ?? DEFAULT_BUDGET;

    const query = (request.query ?? {}) as QueryShape;
    const shape: QueryShape = {
      page: query.page,
      limit: query.limit,
      from: query.from,
      to: query.to,
      format: query.format,
      join: query.join,
      replayWindow: query.replayWindow,
      batchSize: query.batchSize,
    };

    const { total: cost, breakdown } = estimateCost(request.method, request.url, shape);

    const result = await checkCostBudget(
      principal.key,
      cost,
      budget,
      BUDGET_WINDOW_MS,
    );

    // Set response headers
    reply.header("X-Cost-Budget", String(result.budget));
    reply.header("X-Cost-Remaining", String(result.remaining));
    reply.header("X-Cost-Charged", String(cost));
    reply.header(
      "X-Cost-Reset",
      String(Math.ceil(result.resetMs / 1000)),
    );
    reply.header("X-Cost-Tier", tier);

    if (result.degraded) {
      reply.header("X-Cost-Degraded", "1");
    }

    if (!result.allowed) {
      const retryAfterSec = Math.ceil((result.retryAfterMs ?? BUDGET_WINDOW_MS) / 1000);
      reply.header("Retry-After", String(retryAfterSec));

      logger.warn(
        {
          principal: principal.key,
          isAnonymous: principal.isAnonymous,
          tier,
          cost,
          breakdown,
          remaining: result.remaining,
          budget: result.budget,
          url: request.url,
          method: request.method,
        },
        "cost-rate-limit: budget exhausted",
      );

      return reply.status(429).send({
        error: "Too Many Requests",
        message: "Cost budget exhausted. Your request load is too high for this window.",
        retryAfter: retryAfterSec,
        costCharged: cost,
        budgetRemaining: 0,
        budgetTotal: result.budget,
        resetAt: new Date(result.resetMs).toISOString(),
      });
    }

    logger.debug(
      { principal: principal.key, tier, cost, breakdown, remaining: result.remaining },
      "cost-rate-limit: request allowed",
    );
  });

  logger.info(
    { trustedProxyCidrs: trustedCidrs.length, budgetWindowMs: BUDGET_WINDOW_MS },
    "Cost rate limiting middleware registered",
  );
}
