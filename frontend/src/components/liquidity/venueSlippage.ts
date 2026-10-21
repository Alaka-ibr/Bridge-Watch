import type { DepthData, LiquidityVenue } from "../../types/liquidity";
import { getVenueModel } from "./venueModel";

/** The venue split issue #1286 asks to contrast. */
export const DEFAULT_TRADE_SIZES = [10_000, 50_000, 100_000] as const;

export interface VenueSlippageRow {
  venue: LiquidityVenue;
  venueModel: ReturnType<typeof getVenueModel>;
  /** Slippage percent for each requested size, keyed by size */
  slippageBySize: Record<number, number>;
  /** Best (lowest) slippage across the requested sizes */
  bestSlippagePct: number;
  /** Total depth the venue can absorb on the ask side */
  availableDepth: number;
  /** True when even the smallest size exceeds available depth */
  exceedsDepth: boolean;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Walk a venue's ask levels to estimate the average fill price for a given
 * notional, then express the shortfall against the mid as slippage.
 *
 * Returns null when the venue has no ask depth at all.
 */
export function estimateSlippage(
  depth: DepthData,
  venue: LiquidityVenue,
  tradeSize: number
): number | null {
  const venueAsks = depth.asks
    .filter((level) => level.venue === venue)
    .sort((a, b) => a.price - b.price);

  if (venueAsks.length === 0 || tradeSize <= 0 || depth.midPrice <= 0) return null;

  // Each level reports cumulative volume at that price, so the amount newly
  // available at a level is the step up from the previous level.
  let remaining = tradeSize;
  let previousVolume = 0;
  let cost = 0;
  let filled = 0;

  for (const level of venueAsks) {
    const available = Math.max(level.volume - previousVolume, 0);
    const fill = Math.min(remaining, available);
    cost += fill * level.price;
    filled += fill;
    remaining -= fill;
    previousVolume = level.volume;
    if (remaining <= 0) break;
  }

  if (filled <= 0) return null;

  const averagePrice = cost / filled;
  // A partially filled order pays worse than the mid, so cap the result at
  // "not fillable" rather than reporting a misleadingly small number.
  if (remaining > 0) return Number.POSITIVE_INFINITY;

  return ((averagePrice - depth.midPrice) / depth.midPrice) * 100;
}

/** Build the per-venue comparison rows for each requested trade size. */
export function buildSlippageComparison(
  depth: DepthData | null,
  tradeSizes: number[]
): VenueSlippageRow[] {
  if (!depth) return [];

  const venues = Array.from(
    new Set([...depth.asks, ...depth.bids].map((level) => level.venue))
  );

  return venues.map((venue) => {
    const availableDepth = venueAsksDepth(depth, venue);
    const slippageBySize: Record<number, number> = {};

    for (const size of tradeSizes) {
      const slippage = estimateSlippage(depth, venue, size);
      slippageBySize[size] = slippage === null ? Number.NaN : round(slippage, 4);
    }

    const finite = Object.values(slippageBySize).filter((v) => Number.isFinite(v));

    return {
      venue,
      venueModel: getVenueModel(venue),
      slippageBySize,
      bestSlippagePct: finite.length > 0 ? Math.min(...finite) : Number.NaN,
      availableDepth,
      exceedsDepth: tradeSizes.some((size) => size > availableDepth),
    };
  });
}

function venueAsksDepth(depth: DepthData, venue: LiquidityVenue): number {
  let cumulative = 0;
  for (const level of depth.asks) {
    if (level.venue === venue && level.volume > cumulative) cumulative = level.volume;
  }
  return round(cumulative, 2);
}
