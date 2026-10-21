import React, { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { DepthData, LiquidityVenue } from "../../types/liquidity";
import { VENUE_COLORS } from "./venueColors";
import { buildDepthCurve, toStackedSeries, getVenueModel } from "./venueModel";
import { SkeletonChart } from "../Skeleton";

interface Props {
  depth: DepthData | null;
  isLoading: boolean;
  pair: string;
}

type Side = "bids" | "asks";

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-stellar-dark border border-stellar-border rounded-lg p-3 text-xs shadow-lg">
      <p className="text-stellar-text-secondary mb-1">Price: {label}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} style={{ color: entry.color }}>
          {String(entry.dataKey)}:{" "}
          {Number(entry.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
      ))}
    </div>
  );
};

const formatPrice = (value: number) => value.toFixed(7);

/**
 * VenueDepthComparison — stacked area chart contrasting the SDEX limit order
 * book against Soroban AMM pool reserves.
 *
 * Both models are plotted on one cumulative depth curve so the two liquidity
 * sources can be compared directly at each price level. Order-book depth grows
 * as price moves away from the mid; AMM reserves are flat because a pool can
 * be drawn down continuously at any price.
 */
const VenueDepthComparison = React.memo(function VenueDepthComparison({
  depth,
  isLoading,
  pair,
}: Props) {
  const [side, setSide] = useState<Side>("bids");

  const levels = depth ? (side === "bids" ? depth.bids : depth.asks) : [];

  const venues = useMemo<LiquidityVenue[]>(
    () => Array.from(new Set(levels.map((level) => level.venue))),
    [levels]
  );

  const chartData = useMemo(() => {
    const curve = buildDepthCurve(levels, side === "bids");
    return toStackedSeries(curve, venues);
  }, [levels, side, venues]);

  if (isLoading) {
    return <SkeletonChart height={300} ariaLabel="Venue depth comparison loading" />;
  }

  if (chartData.length === 0) {
    return (
      <div
        className="h-48 flex items-center justify-center text-stellar-text-secondary text-sm"
        role="status"
      >
        No depth data available for {pair}
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center justify-between mb-3"
        role="group"
        aria-label="Depth side"
      >
        <p className="text-xs text-stellar-text-secondary">
          Cumulative depth by venue, {side === "bids" ? "bid" : "ask"} side
        </p>
        <div className="flex gap-1">
          {(["bids", "asks"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSide(option)}
              aria-pressed={side === option}
              className={`px-2.5 py-1 rounded text-xs font-medium capitalize transition-colors ${
                side === option
                  ? "bg-stellar-primary text-white"
                  : "border border-stellar-border text-stellar-text-secondary hover:text-white"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="h-72" data-testid="venue-depth-comparison-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
            <XAxis
              dataKey="priceLabel"
              tickFormatter={formatPrice}
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              stroke="#2a2f3a"
            />
            <YAxis
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              stroke="#2a2f3a"
              width={70}
              tickFormatter={(value: number) =>
                value.toLocaleString(undefined, { maximumFractionDigits: 0 })
              }
            />
            <Tooltip content={<CustomTooltip />} />
            {depth && (
              <ReferenceLine
                x={depth.midPrice.toFixed(7)}
                stroke="#4b5563"
                strokeDasharray="4 4"
                label={{ value: "mid", fill: "#9ca3af", fontSize: 10, position: "top" }}
              />
            )}
            {venues.map((venue) => (
              <Area
                key={venue}
                type="stepAfter"
                dataKey={venue}
                stackId="depth"
                stroke={VENUE_COLORS[venue]}
                fill={VENUE_COLORS[venue]}
                fillOpacity={venue === "SDEX" ? 0.55 : 0.35}
                strokeWidth={venue === "SDEX" ? 2 : 1.5}
                strokeDasharray={getVenueModel(venue) === "amm-pool" ? "4 3" : undefined}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stellar-text-secondary">
        {venues.map((venue) => (
          <li key={venue} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: VENUE_COLORS[venue] }}
            />
            {venue}
            <span className="text-stellar-text-muted">
              ({getVenueModel(venue) === "amm-pool" ? "pooled reserves" : "limit order book"})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
});

export default VenueDepthComparison;
