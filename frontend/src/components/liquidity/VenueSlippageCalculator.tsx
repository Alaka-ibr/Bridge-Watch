import React, { useMemo } from "react";
import type { DepthData } from "../../types/liquidity";
import { VENUE_COLORS } from "./venueColors";
import { buildSlippageComparison, DEFAULT_TRADE_SIZES } from "./venueSlippage";
import { SkeletonChart } from "../Skeleton";

interface Props {
  depth: DepthData | null;
  isLoading: boolean;
  /** Notional sizes in the quote asset (USDC) to compare across venues */
  tradeSizes?: number[];
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatSlippage(value: number): string {
  if (Number.isNaN(value)) return "n/a";
  if (!Number.isFinite(value)) return "insufficient depth";
  return `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(3)}%`;
}

function slippageToneClass(value: number): string {
  if (Number.isNaN(value)) return "text-stellar-text-secondary";
  if (!Number.isFinite(value)) return "text-red-400";
  if (value < 0.1) return "text-green-400";
  if (value < 0.5) return "text-yellow-400";
  return "text-red-400";
}

/**
 * VenueSlippageCalculator — estimates the price impact of buying with a fixed
 * notional on each venue, so the order-book and AMM venues can be compared
 * side by side for the same trade sizes.
 */
const VenueSlippageCalculator = React.memo(function VenueSlippageCalculator({
  depth,
  isLoading,
  tradeSizes = [...DEFAULT_TRADE_SIZES],
}: Props) {
  const rows = useMemo(() => buildSlippageComparison(depth, tradeSizes), [depth, tradeSizes]);

  if (isLoading) {
    return <SkeletonChart height={220} ariaLabel="Venue slippage comparison loading" />;
  }

  if (rows.length === 0) {
    return (
      <div
        className="h-32 flex items-center justify-center text-stellar-text-secondary text-sm"
        role="status"
      >
        No venue depth available to price against
      </div>
    );
  }

  return (
    <div data-testid="venue-slippage-calculator">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Estimated price impact by venue for each trade size
          </caption>
          <thead>
            <tr className="border-b border-stellar-border">
              <th scope="col" className="text-left py-2 px-3 font-medium text-stellar-text-secondary">
                Venue
              </th>
              {tradeSizes.map((size) => (
                <th
                  key={size}
                  scope="col"
                  className="text-right py-2 px-3 font-medium text-stellar-text-secondary"
                >
                  {formatUsd(size)}
                </th>
              ))}
              <th
                scope="col"
                className="text-right py-2 px-3 font-medium text-stellar-text-secondary"
              >
                Ask Depth
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.venue} className="border-b border-stellar-border/50">
                <th scope="row" className="py-2 px-3 text-left font-medium text-white">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ backgroundColor: VENUE_COLORS[row.venue] }}
                    />
                    {row.venue}
                  </span>
                  <span className="text-xs font-normal text-stellar-text-secondary">
                    {row.venueModel === "amm-pool" ? "pooled reserves" : "limit order book"}
                  </span>
                </th>
                {tradeSizes.map((size) => (
                  <td
                    key={size}
                    className={`py-2 px-3 text-right font-medium ${slippageToneClass(
                      row.slippageBySize[size]
                    )}`}
                  >
                    {formatSlippage(row.slippageBySize[size])}
                  </td>
                ))}
                <td className="py-2 px-3 text-right text-white">
                  {formatUsd(row.availableDepth)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.some((row) => row.exceedsDepth) && (
        <p className="mt-3 text-xs text-stellar-text-secondary">
          Rows marked &ldquo;insufficient depth&rdquo; cannot absorb the full order at
          current depth; routing across venues would be required.
        </p>
      )}
    </div>
  );
});

export default VenueSlippageCalculator;
