import { describe, it, expect } from "vitest";
import type { DepthData, OrderBookLevel } from "../../types/liquidity";
import { buildSlippageComparison, DEFAULT_TRADE_SIZES } from "./venueSlippage";

const ask = (venue: OrderBookLevel["venue"], price: number, volume: number): OrderBookLevel => ({
  venue,
  price,
  volume,
});

function makeDepth(asks: OrderBookLevel[], bids: OrderBookLevel[] = []): DepthData {
  return {
    pair: "USDC/XLM",
    midPrice: 1,
    timestamp: new Date().toISOString(),
    bids,
    asks,
  };
}

describe("buildSlippageComparison", () => {
  it("returns no rows when depth is unavailable", () => {
    expect(buildSlippageComparison(null, [...DEFAULT_TRADE_SIZES])).toEqual([]);
  });

  it("prices a fully fillable order close to the mid", () => {
    // SDEX quotes 1.001 and 1.002, mid is 1.0 — deep book, tiny impact.
    const depth = makeDepth([ask("SDEX", 1.001, 500_000), ask("SDEX", 1.002, 900_000)]);
    const [row] = buildSlippageComparison(depth, [10_000]);

    expect(row.venue).toBe("SDEX");
    // A 10k order fills entirely in the first level at 1.001 => 0.1% impact.
    expect(row.slippageBySize[10_000]).toBeCloseTo(0.1, 3);
    expect(row.availableDepth).toBe(900_000);
  });

  it("reports insufficient depth when the venue cannot absorb the order", () => {
    const depth = makeDepth([ask("SDEX", 1.001, 1_000)]);
    const [row] = buildSlippageComparison(depth, [50_000]);

    expect(row.slippageBySize[50_000]).toBe(Number.POSITIVE_INFINITY);
    expect(row.exceedsDepth).toBe(true);
  });

  it("grows slippage as the order size rises on a thin book", () => {
    // Only 5k available at 1.001 then 45k at 1.02, mid 1.0.
    const depth = makeDepth([ask("SDEX", 1.001, 5_000), ask("SDEX", 1.02, 50_000)]);
    const [row] = buildSlippageComparison(depth, [1_000, 10_000]);

    expect(row.slippageBySize[1_000]).toBeCloseTo(0.1, 3);
    expect(row.slippageBySize[10_000]).toBeGreaterThan(row.slippageBySize[1_000]);
  });

  it("compares venues independently against the same sizes", () => {
    const depth = makeDepth(
      [
        ask("SDEX", 1.001, 1_000_000),
        ask("StellarX", 1.05, 1_000_000),
      ]
    );
    const rows = buildSlippageComparison(depth, [10_000, 50_000, 100_000]);
    const sdex = rows.find((r) => r.venue === "SDEX")!;
    const amm = rows.find((r) => r.venue === "StellarX")!;

    expect(sdex.venueModel).toBe("order-book");
    expect(amm.venueModel).toBe("amm-pool");
    // The AMM quotes a worse price for the same notional.
    expect(amm.slippageBySize[10_000]).toBeCloseTo(5, 3);
    expect(amm.bestSlippagePct).toBeCloseTo(5, 3);
    expect(sdex.bestSlippagePct).toBeCloseTo(0.1, 3);
  });

  it("defaults to the 10k / 50k / 100k sizes from the issue", () => {
    expect(DEFAULT_TRADE_SIZES).toEqual([10_000, 50_000, 100_000]);
  });

  it("marks n/a for a venue that quotes no ask depth", () => {
    const depth = makeDepth([ask("SDEX", 1.001, 500_000)], [ask("Phoenix", 0.999, 500)]);
    const rows = buildSlippageComparison(depth, [10_000]);
    const phoenix = rows.find((r) => r.venue === "Phoenix")!;

    expect(phoenix.slippageBySize[10_000]).toBeNaN();
    expect(phoenix.availableDepth).toBe(0);
  });

  it("handles a mid price of zero without dividing by zero", () => {
    const depth = makeDepth([ask("SDEX", 1.001, 500_000)]);
    depth.midPrice = 0;
    const [row] = buildSlippageComparison(depth, [10_000]);

    expect(row.slippageBySize[10_000]).toBeNaN();
  });
});
