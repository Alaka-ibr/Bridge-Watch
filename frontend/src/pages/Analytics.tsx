import { useState, useMemo } from "react";
import ColorPreviewTool from "../components/ColorPreviewTool";
import { MetricsDrilldown } from "../components/MetricsDrilldown";
import SnapshotCard from "../components/analytics/SnapshotCard";
import BridgeComparison from "../components/analytics/BridgeComparison";
import IncidentHeatmap from "../components/IncidentHeatmap";
import AnomalyTrendCharts from "../components/AnomalyTrendCharts";
import AnomalyTuningPanel from "../components/AnomalyTuningPanel";
import { TimeRangeSelector } from "../components/TimeRangeSelector";
import type { BridgeAnalytics } from "../hooks/useAnalytics";
import { useAssetsWithHealth } from "../hooks/useAssets";
import { usePricesForSymbols } from "../hooks/usePrices";
import { useLocalStorageState } from "../hooks/useLocalStorageState";

interface SnapshotState {
  title: string;
  timestamp: string;
}

const MAX_COMPARE_ASSETS = 3;

export default function Analytics() {
  const [isDrilldownOpen, setIsDrilldownOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotState | null>(null);
  const [isLoading] = useState(false);
  const [bridgeData] = useState<BridgeAnalytics[]>([]);

  const { data: assetsData, isLoading: isAssetsLoading, error } = useAssetsWithHealth();
  const [selectedSymbols, setSelectedSymbols] = useLocalStorageState<string[]>(
    "bridge-watch:analytics-compare:v1",
    []
  );

  const priceQueries = usePricesForSymbols(selectedSymbols);
  const selectedAssets = useMemo(
    () => (assetsData ?? []).filter((asset) => selectedSymbols.includes(asset.symbol)),
    [assetsData, selectedSymbols]
  );

  const handleToggleAsset = (symbol: string) => {
    setSelectedSymbols((prev) => {
      if (prev.includes(symbol)) return prev.filter((s) => s !== symbol);
      if (prev.length >= MAX_COMPARE_ASSETS) return prev;
      return [...prev, symbol];
    });
  };

  const handleCaptureSnapshot = () => {
    setSnapshot({
      title: "Bridge Analytics Snapshot",
      timestamp: new Date().toLocaleString(),
    });
  };

  const metrics = [
    { id: "tvl", label: "Total Value Locked", value: "$12.5M", trend: { value: "+12%", direction: "up" as const }, icon: "💰" },
    { id: "assets", label: "Monitored Assets", value: "42", trend: { value: "+3", direction: "up" as const }, icon: "📊" },
    { id: "bridges", label: "Active Bridges", value: "8/10", trend: { value: "2 down", direction: "down" as const }, icon: "🌉" },
    { id: "health", label: "System Health", value: "85%", trend: { value: "+5%", direction: "up" as const }, icon: "❤️" },
    { id: "alerts", label: "Active Alerts", value: "3", trend: { value: "-2", direction: "down" as const }, icon: "⚠️" },
    { id: "volume", label: "24h Volume", value: "$4.2M", trend: { value: "+8%", direction: "up" as const }, icon: "📈" },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Analytics</h1>
          <p className="mt-2 text-stellar-text-secondary">
            Historical trends, cross-asset comparisons, and ecosystem health metrics
          </p>
        </div>
        <button
          onClick={handleCaptureSnapshot}
          disabled={isLoading || bridgeData.length === 0}
          className="px-4 py-2 bg-stellar-blue text-white rounded-lg text-sm font-semibold hover:bg-stellar-blue/90 transition-colors disabled:opacity-50"
        >
          Capture Snapshot
        </button>
      </div>

      {snapshot && (
        <section className="print:m-0 print:p-0">
          <div className="flex justify-between items-center mb-4 no-print">
            <h2 className="text-xl font-semibold text-white">Latest Snapshot</h2>
            <button onClick={() => setSnapshot(null)} className="text-sm text-stellar-text-secondary hover:text-white">
              Dismiss
            </button>
          </div>
          <SnapshotCard 
            title={snapshot.title}
            bridges={bridgeData.slice(0, 5)} 
            timestamp={snapshot.timestamp}
          />
        </section>
      )}

      {/* Overview Stats */}
      <div className="space-y-6">
        {/* Time Range Selector for Analytics */}
        <TimeRangeSelector 
          chartId="analytics-overview" 
          title="Analytics Time Range" 
          showApplyGlobally={true}
        />
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {metrics.slice(0, 4).map((stat) => (
            <div
              key={stat.id}
              className="bg-stellar-card border border-stellar-border rounded-lg p-6 cursor-pointer hover:border-stellar-blue transition-colors"
              onClick={() => setIsDrilldownOpen(true)}
            >
              <p className="text-sm text-stellar-text-secondary">{stat.label}</p>
              <p className="mt-2 text-2xl font-bold text-white">{stat.value}</p>
              {stat.trend && (
                <p className={`mt-1 text-sm ${stat.trend.direction === "up" ? "text-green-400" : "text-red-400"}`}>
                  {stat.trend.value}
                </p>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setIsDrilldownOpen(true)}
            className="bg-stellar-card border border-stellar-border rounded-lg p-6 flex flex-col items-center justify-center hover:border-stellar-blue transition-colors"
          >
            <span className="text-3xl mb-2">🔍</span>
            <span className="text-sm font-medium text-stellar-text-primary">View All Metrics</span>
          </button>
        </div>
      </div>

      {/* Asset Comparison */}
      <div className="bg-stellar-card border border-stellar-border rounded-lg p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold text-white">
            Asset Comparison
          </h2>
          <p className="text-sm text-stellar-text-secondary">
            Select up to {MAX_COMPARE_ASSETS} assets for side-by-side comparison.
          </p>
        </div>

        <div className="mt-4">
          {error ? (
            <p className="text-red-400" role="alert">
              Failed to load assets for comparison.
            </p>
          ) : isAssetsLoading ? (
            <div
              className="flex flex-wrap gap-2"
              role="status"
              aria-live="polite"
              aria-label="Loading assets for comparison"
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-9 w-20 rounded-md bg-stellar-border/50 animate-pulse"
                />
              ))}
            </div>
          ) : assetsData && assetsData.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {assetsData.map((asset) => {
                const selected = selectedSymbols.includes(asset.symbol);
                const disabled = !selected && selectedSymbols.length >= MAX_COMPARE_ASSETS;
                return (
                  <button
                    key={asset.symbol}
                    type="button"
                    onClick={() => handleToggleAsset(asset.symbol)}
                    disabled={disabled}
                    aria-pressed={selected}
                    className={`rounded-md border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-stellar-blue ${
                      selected
                        ? "border-stellar-blue bg-stellar-blue/20 text-white"
                        : "border-stellar-border bg-stellar-dark text-stellar-text-secondary hover:text-white"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {asset.symbol}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-stellar-text-secondary">
              No assets are available for comparison yet.
            </p>
          )}
        </div>

        <div className="mt-6">
          {selectedAssets.length === 0 ? (
            <p className="text-stellar-text-secondary">
              Select at least one asset to view comparison metrics.
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {selectedAssets.map((asset, index) => {
                const query = priceQueries[index];
                const vwap = query?.data?.vwap;
                const lastUpdated = query?.data?.lastUpdated;

                return (
                  <article
                    key={asset.symbol}
                    className="bg-stellar-dark border border-stellar-border rounded-lg p-4"
                    aria-label={`${asset.symbol} comparison metrics`}
                  >
                    <h3 className="text-lg font-semibold text-white">{asset.symbol}</h3>
                    <p className="text-sm text-stellar-text-secondary">{asset.name}</p>

                    <dl className="mt-4 space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-stellar-text-secondary">Health Score</dt>
                        <dd className="text-white font-medium">
                          {asset.health?.overallScore ?? "--"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-stellar-text-secondary">Trend</dt>
                        <dd className="text-white font-medium">
                          {asset.health?.trend ?? "--"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-stellar-text-secondary">VWAP</dt>
                        <dd className="text-white font-medium">
                          {typeof vwap === "number" ? `$${vwap.toFixed(4)}` : "--"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-stellar-text-secondary">Price Sources</dt>
                        <dd className="text-white font-medium">
                          {query?.data?.sources?.length ?? 0}
                        </dd>
                      </div>
                    </dl>

                    <p className="mt-3 text-xs text-stellar-text-secondary">
                      {query?.isLoading
                        ? "Loading latest prices…"
                        : lastUpdated
                          ? `Updated: ${lastUpdated}`
                          : "No price update timestamp"}
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <BridgeComparison bridges={bridgeData} isLoading={isLoading || isAssetsLoading} />

      {/* Incident Heatmap */}
      <IncidentHeatmap />

      {/* Anomaly Trend Charts */}
      <AnomalyTrendCharts />

      <AnomalyTuningPanel />

      {/* Health Score Trends */}
      <div className="bg-stellar-card border border-stellar-border rounded-lg p-6">
        <h2 className="text-xl font-semibold text-white mb-4">
          Health Score Trends
        </h2>
        <div className="h-64 flex items-center justify-center">
          <p className="text-stellar-text-secondary">
            Historical health score charts will render here once data is
            available
          </p>
        </div>
      </div>

      {/* Volume Analytics */}
      <div className="bg-stellar-card border border-stellar-border rounded-lg p-6">
        <h2 className="text-xl font-semibold text-white mb-4">
          Bridge Volume Analytics
        </h2>
        <div className="h-64 flex items-center justify-center">
          <p className="text-stellar-text-secondary">
            Volume analytics will render here once bridge monitoring data is
            collected
          </p>
        </div>
      </div>

      {/* Liquidity Distribution */}
      <div className="bg-stellar-card border border-stellar-border rounded-lg p-6">
        <h2 className="text-xl font-semibold text-white mb-4">
          Liquidity Distribution Across DEXs
        </h2>
        <div className="h-64 flex items-center justify-center">
          <p className="text-stellar-text-secondary">
            DEX liquidity distribution charts will render here once data is
            aggregated
          </p>
        </div>
      </div>

      <ColorPreviewTool />

      {/* Metrics Drilldown Panel */}
      <MetricsDrilldown
        isOpen={isDrilldownOpen}
        onClose={() => setIsDrilldownOpen(false)}
        metrics={metrics}
        title="Metrics Drilldown"
      />
    </div>
  );
}
