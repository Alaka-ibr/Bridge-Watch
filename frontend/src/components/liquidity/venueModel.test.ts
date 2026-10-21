import { describe, it, expect } from "vitest";
import type { DepthData, OrderBookLevel } from "../../types/liquidity";
import {
  getVenueModel,
  buildDepthCurve,
  toStackedSeries,
  sumVenueDepth,
} from "./venueModel";

const bid = (venue: OrderBookLevel["venue"], price: number, volume: number): OrderBookLevel => ({
  venue,
  price,
  volume,
});

describe("getVenueModel", () => {
  it("classifies the Stellar Classic order book as an order book", () => {
    expect(getVenueModel("SDEX")).toBe("order-book");
  });

  it("classifies Soroban AMM venues as pooled reserves", () => {
    expect(getVenueModel("StellarX")).toBe("amm-pool");
    expect(getVenueModel("Phoenix")).toBe("amm-pool");
  });

  it("falls back to order book for unknown venues", () => {
    expect(getVenueModel("SomeNewDex")).toBe("order-book");
  });
});

describe("buildDepthCurve", () => {
  it("returns an empty curve when there are no levels", () => {
    expect(buildDepthCurve([], true)).toEqual([]);
  });

  it("orders bids from best price downwards", () => {
    const curve = buildDepthCurve([bid("SDEX", 0.99, 10), bid("SDEX", 1.0, 4)], true);
    expect(curve.map((p) => p.price)).toEqual([1, 0.99]);
  });

  it("orders asks from best price upwards", () => {
    const curve = buildDepthCurve([bid("SDEX", 1.02, 20), bid("SDEX", 1.01, 8)], false);
    expect(curve.map((p) => p.price)).toEqual([1.01, 1.02]);
  });

  it("accumulates depth outward from the mid on the bid side", () => {
    // Volume is already cumulative per venue, so deeper levels hold more size.
    const curve = buildDepthCurve(
      [bid("SDEX", 1.0, 5), bid("SDEX", 0.99, 25), bid("SDEX", 0.98, 60)],
      true
    );

    expect(curve[0].byVenue.SDEX).toBe(5);
    expect(curve[1].byVenue.SDEX).toBe(25);
    expect(curve[2].byVenue.SDEX).toBe(60);
  });

  it("stacks venues independently on a shared price axis", () => {
    const curve = buildDepthCurve(
      [
        bid("SDEX", 1.0, 10),
        bid("SDEX", 0.99, 40),
        bid("StellarX", 1.0, 3),
        bid("StellarX", 0.99, 12),
      ],
      true
    );

    const deepest = curve[curve.length - 1];
    expect(deepest.byVenue.SDEX).toBe(40);
    expect(deepest.byVenue.StellarX).toBe(12);
    expect(deepest.total).toBe(52);
  });

  it("keeps a venue's depth once its best level is at or better than the price", () => {
    const curve = buildDepthCurve(
      [bid("SDEX", 1.0, 10), bid("SDEX", 0.9, 30), bid("StellarX", 1.0, 7)],
      true
    );

    // On the bid side a level priced at 1.0 is better than 0.9, so the AMM
    // pool's best level is still reachable and must be carried forward.
    const deepest = curve[curve.length - 1];
    expect(deepest.price).toBe(0.9);
    expect(deepest.byVenue.SDEX).toBe(30);
    expect(deepest.byVenue.StellarX).toBe(7);
    expect(deepest.total).toBe(37);
  });

  it("drops a venue once its best level is worse than the price", () => {
    const curve = buildDepthCurve(
      [bid("SDEX", 1.0, 10), bid("SDEX", 0.9, 30), bid("StellarX", 0.8, 7)],
      true
    );

    const deepest = curve[curve.length - 1];
    expect(deepest.price).toBe(0.8);
    expect(deepest.byVenue.SDEX).toBe(30);
    expect(deepest.byVenue.StellarX).toBe(7);
  });

  it("de-duplicates identical prices shared by multiple venues", () => {
    const curve = buildDepthCurve(
      [bid("SDEX", 1.0, 10), bid("StellarX", 1.0, 6)],
      true
    );
    expect(curve).toHaveLength(1);
    expect(curve[0].total).toBe(16);
  });
});

describe("toStackedSeries", () => {
  it("emits one column per price with a field per venue", () => {
    const curve = buildDepthCurve(
      [bid("SDEX", 1.0, 10), bid("SDEX", 0.99, 20), bid("StellarX", 1.0, 5)],
      true
    );

    const series = toStackedSeries(curve, ["SDEX", "StellarX"]);

    expect(series[0]).toMatchObject({
      price: 1,
      priceLabel: "1.0000000",
      SDEX: 10,
      StellarX: 5,
      total: 15,
    });
    // Missing venues must still be present so the chart stack stays stable.
    expect(series[1].SDEX).toBe(20);
    expect(series[1].StellarX).toBe(5);
  });
});

describe("sumVenueDepth", () => {
  it("returns the venue's deepest cumulative level", () => {
    expect(
      sumVenueDepth([bid("SDEX", 1.0, 5), bid("SDEX", 0.99, 30), bid("StellarX", 1.0, 2)], "SDEX")
    ).toBe(30);
  });

  it("returns zero when the venue has no levels", () => {
    expect(sumVenueDepth([bid("SDEX", 1.0, 5)], "Phoenix")).toBe(0);
  });
});

describe("venue depth data shape", () => {
  it("keeps SDEX and AMM sides separable from a realistic book", () => {
    const depth: DepthData = {
      pair: "USDC/XLM",
      midPrice: 1,
      timestamp: new Date().toISOString(),
      bids: [bid("SDEX", 1.0, 1000), bid("StellarX", 1.0, 500)],
      asks: [bid("SDEX", 1.0, 800), bid("StellarX", 1.0, 400)],
    };

    const curve = buildDepthCurve(depth.asks, false);
    expect(curve[0].byVenue).toEqual({ SDEX: 800, StellarX: 400 });
    expect(curve[0].total).toBe(1200);
  });
});
