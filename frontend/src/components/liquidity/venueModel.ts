import type { LiquidityVenue, OrderBookLevel } from "../../types/liquidity";

/**
 * Venue model classes.
 *
 * Stellar Classic (SDEX) is a central limit order book: liquidity is
 * distributed across discrete price levels, so depth grows as the price is
 * allowed to move away from the mid.
 *
 * Soroban AMM pools (StellarX, Phoenix) instead hold pooled reserves. Depth
 * is not booked at discrete prices, so it is quoted as a constant amount of
 * reserve available at each price-impact tolerance.
 */
export type VenueModel = "order-book" | "amm-pool";

/** Venues backed by the Stellar Classic order book. */
const ORDER_BOOK_VENUES: readonly LiquidityVenue[] = ["SDEX"];

/** Venues backed by Soroban AMM liquidity pools. */
const AMM_POOL_VENUES: readonly LiquidityVenue[] = ["StellarX", "Phoenix"];

export function getVenueModel(venue: string): VenueModel {
  if (ORDER_BOOK_VENUES.includes(venue as LiquidityVenue)) return "order-book";
  if (AMM_POOL_VENUES.includes(venue as LiquidityVenue)) return "amm-pool";
  return "order-book";
}

export const VENUE_MODEL_LABELS: Record<VenueModel, string> = {
  "order-book": "SDEX Order Book",
  "amm-pool": "AMM Pool Reserves",
};

/** A single point on the cumulative depth curve. */
export interface DepthPoint {
  /** Price level, rounded to Stellar's 7 decimal precision */
  price: number;
  /** Price formatted for the X axis */
  priceLabel: string;
  /** Cumulative depth available at or better than this price, per venue */
  byVenue: Partial<Record<LiquidityVenue, number>>;
  /** Total cumulative depth across every venue on this side */
  total: number;
}

function to7(value: number): number {
  return Math.round(value * 1e7) / 1e7;
}

/**
 * Build a cumulative depth curve for one side of the book.
 *
 * Levels arrive per venue with volume already cumulative outward from that
 * venue's best price. To stack venues on a shared X axis we take the union of
 * all price levels and, for each, report the deepest level each venue can
 * still fill at that price or better.
 */
export function buildDepthCurve(levels: OrderBookLevel[], isBid: boolean): DepthPoint[] {
  if (levels.length === 0) return [];

  // Bids descend away from the mid, asks ascend. Order both so index 0 is
  // the best (deepest) price, which makes "at or better" a simple prefix scan.
  const ordered = [...levels].sort((a, b) => (isBid ? b.price - a.price : a.price - b.price));

  const prices = Array.from(new Set(ordered.map((l) => l.price))).sort((a, b) =>
    isBid ? b - a : a - b
  );

  const venues = Array.from(new Set(ordered.map((l) => l.venue)));

  return prices.map((price) => {
    const byVenue: Partial<Record<LiquidityVenue, number>> = {};
    let total = 0;

    for (const venue of venues) {
      let cumulative = 0;
      for (const level of ordered) {
        if (level.venue !== venue) continue;
        const withinBand = isBid ? level.price >= price : level.price <= price;
        if (!withinBand) break;
        // Level volume is already cumulative for this venue.
        cumulative = level.volume;
      }
      if (cumulative > 0) {
        byVenue[venue] = cumulative;
        total += cumulative;
      }
    }

    return {
      price,
      priceLabel: price.toFixed(7),
      byVenue,
      total,
    };
  });
}

/** Flatten a depth curve into one series per venue, for a stacked area chart. */
export function toStackedSeries(curve: DepthPoint[], venues: LiquidityVenue[]) {
  return curve.map((point) => {
    const row: Record<string, number | string> = {
      price: point.price,
      priceLabel: point.priceLabel,
      total: point.total,
    };
    for (const venue of venues) {
      row[venue] = point.byVenue[venue] ?? 0;
    }
    return row;
  });
}

/** Sum a venue's depth on a side, used for headline figures. */
export function sumVenueDepth(levels: OrderBookLevel[], venue: LiquidityVenue): number {
  // Level volume is already cumulative outward from the venue's best price, so
  // the venue's deepest reachable level carries its full side depth.
  let cumulative = 0;
  for (const level of levels) {
    if (level.venue === venue && level.volume > cumulative) {
      cumulative = level.volume;
    }
  }
  return to7(cumulative);
}
