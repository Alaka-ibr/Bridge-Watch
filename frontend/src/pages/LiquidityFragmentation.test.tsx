import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LiquidityFragmentation from "./LiquidityFragmentation";

const mockDepth = {
  pair: "USDC/XLM",
  midPrice: 1,
  timestamp: "2026-01-01T00:00:00.000Z",
  bids: [
    { venue: "SDEX" as const, price: 1, volume: 1_000 },
    { venue: "StellarX" as const, price: 1, volume: 500 },
  ],
  asks: [
    { venue: "SDEX" as const, price: 1, volume: 900 },
    { venue: "StellarX" as const, price: 1, volume: 400 },
  ],
};

vi.mock("../hooks/useLiquidity", () => ({
  useLiquidity: () => ({
    depth: mockDepth,
    venues: [
      { venue: "SDEX", totalLiquidity: 1400, bidDepth: 1000, askDepth: 900, share: 60 },
      { venue: "StellarX", totalLiquidity: 900, bidDepth: 500, askDepth: 400, share: 40 },
    ],
    history: [],
    isLoading: false,
    error: null,
    lastUpdated: "2026-01-01T00:00:00.000Z",
    refetch: vi.fn(),
  }),
}));

vi.mock("../hooks/useLocalStorageState", () => ({
  useLocalStorageState: (_key: string, defaultValue: unknown) => [defaultValue, vi.fn()],
}));

vi.mock("../components/liquidity", async () => {
  const actual = await vi.importActual<typeof import("../components/liquidity")>(
    "../components/liquidity"
  );
  return {
    ...actual,
    VenueDepthComparison: () => <div data-testid="venue-depth-comparison" />,
    VenueSlippageCalculator: () => <div data-testid="venue-slippage-calculator" />,
  };
});

describe("LiquidityFragmentation", () => {
  beforeEach(() => {
    // The page polls the fragmentation endpoints on mount; stub them so the
    // test does not depend on MSW handlers for pre-existing sections.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 }))
    );
  });

  it("renders the AMM vs SDEX comparison section", () => {
    render(<LiquidityFragmentation />);
    expect(
      screen.getByRole("heading", { name: /AMM vs SDEX Depth Comparison/i })
    ).toBeInTheDocument();
  });

  it("renders both venue comparison components", () => {
    render(<LiquidityFragmentation />);
    expect(screen.getByTestId("venue-depth-comparison")).toBeInTheDocument();
    expect(screen.getByTestId("venue-slippage-calculator")).toBeInTheDocument();
  });

  it("shows the per-venue liquidity split", () => {
    render(<LiquidityFragmentation />);
    expect(screen.getByText("60.00% of venue liquidity")).toBeInTheDocument();
    expect(screen.getByText("40.00% of venue liquidity")).toBeInTheDocument();
  });

  it("keeps the pre-existing fragmentation sections", () => {
    render(<LiquidityFragmentation />);
    expect(screen.getByRole("heading", { name: /Liquidity Distribution/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Optimal Route Calculator/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Arbitrage Opportunities/i })
    ).toBeInTheDocument();
  });
});
