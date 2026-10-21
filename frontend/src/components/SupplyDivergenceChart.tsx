import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

interface BridgeSupplyData {
  name: string;
  supplyOnStellar: number;
  supplyOnSource: number;
}

interface SupplyDivergenceChartProps {
  bridges: BridgeSupplyData[];
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function DivergenceTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as BridgeSupplyData;
  if (!d) return null;
  const diff = d.supplyOnStellar - d.supplyOnSource;
  const pct = d.supplyOnSource > 0 ? ((diff / d.supplyOnSource) * 100).toFixed(1) : "0";
  return (
    <div className="bg-stellar-card border border-stellar-border rounded-lg p-3 text-xs shadow-lg">
      <div className="font-medium text-white mb-1">{d.name}</div>
      <div className="space-y-1 text-stellar-text-secondary">
        <div>Stellar supply: {formatNumber(d.supplyOnStellar)}</div>
        <div>Source supply: {formatNumber(d.supplyOnSource)}</div>
        <div className={`font-medium ${diff >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          Divergence: {diff >= 0 ? "+" : ""}{formatNumber(diff)} ({pct}%)
        </div>
      </div>
    </div>
  );
}

export default function SupplyDivergenceChart({ bridges }: SupplyDivergenceChartProps) {
  const chartData = useMemo(() => {
    return bridges
      .map((b) => ({
        ...b,
        divergence: b.supplyOnStellar - b.supplyOnSource,
        divergenceAbs: Math.abs(b.supplyOnStellar - b.supplyOnSource),
      }))
      .sort((a, b) => b.divergenceAbs - a.divergenceAbs)
      .slice(0, 10);
  }, [bridges]);

  if (chartData.length === 0) {
    return (
      <div className="text-center py-8 text-stellar-text-secondary text-sm">
        No supply data available for divergence analysis.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-xs text-stellar-text-secondary">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-emerald-500" /> Over-collateralized
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-red-500" /> Under-collateralized
        </span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <XAxis
            dataKey="name"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "#334155" }}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={60}
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatNumber}
          />
          <Tooltip content={<DivergenceTooltip />} />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
          <Bar dataKey="divergence" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.divergence >= 0 ? "#10b981" : "#ef4444"}
                fillOpacity={0.8}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
