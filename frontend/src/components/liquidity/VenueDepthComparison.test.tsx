import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DepthData } from "../../types/liquidity";
import VenueDepthComparison from "./VenueDepthComparison";
import VenueSlippageCalculator from "./VenueSlippageCalculator";

vi.mock("recharts", async () => {
  const React = await import("react");
  return {
    AreaChart: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="area-chart">{children}</div>
    ),
    Area: ({ dataKey }: { dataKey?: string }) => <div data-testid={`area-${dataKey}`} />,
    XAxis: () => <div data-testid="x-axis" />,
    YAxis: () => <div data-testid="y-axis" />,
    CartesianGrid: () => null,
    Tooltip: () => null,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ReferenceLine: () => null,
  };
});

const depth: DepthData = {
  pair: "USDC/XLM",
  midPrice: 1,
  timestamp: "2026-01-01T00:00:00.000Z",
  bids: [
    { venue: "SDEX", price: 1.0, volume: 1_000 },
    { venue: "SDEX", price: 0.99, volume: 4_000 },
    { venue: "StellarX", price: 1.0, volume: 500 },
    { venue: "StellarX", price: 0.99, volume: 2_000 },
  ],
  asks: [
    { venue: "SDEX", price: 1.0, volume: 800 },
    { venue: "SDEX", price: 1.01, volume: 3_000 },
    { venue: "StellarX", price: 1.0, volume: 400 },
    { venue: "StellarX", price: 1.01, volume: 1_500 },
  ],
};

describe("VenueDepthComparison", () => {
  it("renders a loading skeleton", () => {
    render(<VenueDepthComparison depth={null} isLoading pair="USDC/XLM" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an empty state when there is no depth", () => {
    render(<VenueDepthComparison depth={null} isLoading={false} pair="USDC/XLM" />);
    expect(screen.getByText(/No depth data available for USDC\/XLM/i)).toBeInTheDocument();
  });

  it("renders one stacked area per venue", () => {
    render(<VenueDepthComparison depth={depth} isLoading={false} pair="USDC/XLM" />);
    expect(screen.getByTestId("area-SDEX")).toBeInTheDocument();
    expect(screen.getByTestId("area-StellarX")).toBeInTheDocument();
  });

  it("labels each venue with its liquidity model", () => {
    render(<VenueDepthComparison depth={depth} isLoading={false} pair="USDC/XLM" />);
    expect(screen.getByText("(limit order book)")).toBeInTheDocument();
    expect(screen.getByText("(pooled reserves)")).toBeInTheDocument();
  });

  it("defaults to the bid side and can switch to asks", async () => {
    const user = userEvent.setup();
    render(<VenueDepthComparison depth={depth} isLoading={false} pair="USDC/XLM" />);

    expect(screen.getByRole("button", { name: "bids" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await user.click(screen.getByRole("button", { name: "asks" }));
    expect(screen.getByRole("button", { name: "asks" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

describe("VenueSlippageCalculator", () => {
  it("renders the 10k / 50k / 100k columns from the issue", () => {
    render(<VenueSlippageCalculator depth={depth} isLoading={false} />);
    expect(screen.getByRole("columnheader", { name: "$10,000" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "$50,000" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "$100,000" })).toBeInTheDocument();
  });

  it("renders a row per venue", () => {
    render(<VenueSlippageCalculator depth={depth} isLoading={false} />);
    expect(screen.getByRole("rowheader", { name: /SDEX/ })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /StellarX/ })).toBeInTheDocument();
  });

  it("shows an empty state when no depth is available", () => {
    render(<VenueSlippageCalculator depth={null} isLoading={false} />);
    expect(screen.getByText(/No venue depth available/i)).toBeInTheDocument();
  });

  it("warns when a venue cannot absorb the largest order", () => {
    const thin: DepthData = {
      ...depth,
      asks: [
        { venue: "SDEX", price: 1.0, volume: 1_000 },
        { venue: "StellarX", price: 1.0, volume: 900_000 },
      ],
    };
    render(<VenueSlippageCalculator depth={thin} isLoading={false} />);
    // Appears both in the affected cell and in the explanatory footnote.
    expect(screen.getAllByText(/insufficient depth/i).length).toBeGreaterThan(0);
  });
});
