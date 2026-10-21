import { useState, useEffect } from "react";
import { useLocalStorageState } from "../hooks/useLocalStorageState";
import { useLiquidity } from "../hooks/useLiquidity";
import { VenueDepthComparison, VenueSlippageCalculator } from "../components/liquidity";
import type { TradingPair } from "../types/liquidity";

interface FragmentationMetrics {
  symbol: string;
  totalLiquidity: number;
  dexCount: number;
  herfindahlIndex: number;
  giniCoefficient: number;
  concentrationRatio: number;
  fragmentationScore: number;
  timestamp: string;
}

interface DexLiquidityShare {
  dex: string;
  liquidity: number;
  share: number;
  rank: number;
}

interface ArbitrageOpportunity {
  assetPair: string;
  buyDex: string;
  sellDex: string;
  buyPrice: number;
  sellPrice: number;
  spread: number;
  spreadPercent: number;
  potentialProfit: number;
  estimatedVolume: number;
  confidence: number;
  timestamp: string;
}

interface OptimalRoute {
  fromAsset: string;
  toAsset: string;
  amount: number;
  routes: RouteStep[];
  estimatedOutput: number;
  estimatedSlippage: number;
  priceImpact: number;
  gasEstimate: number;
}

interface RouteStep {
  dex: string;
  pair: string;
  inputAmount: number;
  outputAmount: number;
  price: number;
  liquidity: number;
  share: number;
}

const SUPPORTED_ASSETS = ["USDC", "EURC", "PYUSD", "FOBXX", "XLM"];

/**
 * The aggregated-liquidity endpoint quotes every asset against USDC on the
 * backend, so map the selected asset onto the phase-1 trading pair.
 */
const TRADING_PAIR_BY_ASSET: Record<string, TradingPair> = {
  USDC: "USDC/XLM",
  EURC: "EURC/XLM",
  PYUSD: "PYUSD/XLM",
  FOBXX: "FOBXX/USDC",
  XLM: "USDC/XLM",
};

export default function LiquidityFragmentation() {
  const [selectedAsset, setSelectedAsset] = useLocalStorageState<string>(
    "bridge-watch:fragmentation-asset:v1",
    "USDC"
  );

  const {
    depth,
    venues,
    isLoading: isDepthLoading,
    error: depthError,
  } = useLiquidity(TRADING_PAIR_BY_ASSET[selectedAsset] ?? "USDC/XLM");

  const [metrics, setMetrics] = useState<FragmentationMetrics | null>(null);
  const [distribution, setDistribution] = useState<DexLiquidityShare[]>([]);
  const [arbitrageOps, setArbitrageOps] = useState<ArbitrageOpportunity[]>([]);
  const [optimalRoute, setOptimalRoute] = useState<OptimalRoute | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [routeParams, setRouteParams] = useState({
    fromAsset: "USDC",
    toAsset: "XLM",
    amount: "1000",
  });

  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

  useEffect(() => {
    fetchFragmentationData();
    const interval = setInterval(fetchFragmentationData, 60000);
    return () => clearInterval(interval);
  }, [selectedAsset]);

  const fetchFragmentationData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [metricsRes, distRes, arbRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/fragmentation/metrics/${selectedAsset}`),
        fetch(`${API_BASE}/api/v1/fragmentation/distribution/${selectedAsset}`),
        fetch(`${API_BASE}/api/v1/fragmentation/arbitrage`),
      ]);

      if (metricsRes.ok) {
        setMetrics(await metricsRes.json());
      }

      if (distRes.ok) {
        setDistribution(await distRes.json());
      }

      if (arbRes.ok) {
        const ops = await arbRes.json();
        setArbitrageOps(ops.slice(0, 10));
      }
    } catch (err) {
      setError("Failed to fetch fragmentation data");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateRoute = async () => {
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/fragmentation/optimal-route?fromAsset=${routeParams.fromAsset}&toAsset=${routeParams.toAsset}&amount=${routeParams.amount}`
      );

      if (res.ok) {
        setOptimalRoute(await res.json());
      } else {
        setError("Failed to calculate optimal route");
      }
    } catch (err) {
      setError("Failed to calculate route");
      console.error(err);
    }
  };

  const getFragmentationColor = (score: number) => {
    if (score >= 70) return "text-green-400";
    if (score >= 40) return "text-yellow-400";
    return "text-red-400";
  };

  const getFragmentationLabel = (score: number) => {
    if (score >= 70) return "High Fragmentation";
    if (score >= 40) return "Moderate Fragmentation";
    return "Low Fragmentation";
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Liquidity Fragmentation Analysis</h1>
          <p className="mt-1 text-stellar-text-secondary text-sm">
            DEX fragmentation patterns, optimal routing, and arbitrage opportunities
          </p>
        </div>

        <select
          value={selectedAsset}
          onChange={(e) => setSelectedAsset(e.target.value)}
          className="bg-stellar-bg border border-stellar-border rounded-lg px-4 py-2 text-white"
        >
          {SUPPORTED_ASSETS.map((asset) => (
            <option key={asset} value={asset}>
              {asset}
            </option>
          ))}
        </select>
      </header>

      {error && (
        <div
          role="alert"
          className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-stellar-card border border-stellar-border rounded-lg p-4">
            <p className="text-xs text-stellar-text-secondary">Fragmentation Score</p>
            <p className={`mt-1 text-xl font-bold ${getFragmentationColor(metrics.fragmentationScore)}`}>
              {metrics.fragmentationScore.toFixed(2)}
            </p>
            <p className="text-xs text-stellar-text-secondary mt-1">
              {getFragmentationLabel(metrics.fragmentationScore)}
            </p>
          </div>

          <div className="bg-stellar-card border border-stellar-border rounded-lg p-4">
            <p className="text-xs text-stellar-text-secondary">Total Liquidity</p>
            <p className="mt-1 text-xl font-bold text-white">
              ${metrics.totalLiquidity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>

          <div className="bg-stellar-card border border-stellar-border rounded-lg p-4">
            <p className="text-xs text-stellar-text-secondary">Herfindahl Index</p>
            <p className="mt-1 text-xl font-bold text-white">{metrics.herfindahlIndex.toFixed(4)}</p>
            <p className="text-xs text-stellar-text-secondary mt-1">Concentration measure</p>
          </div>

          <div className="bg-stellar-card border border-stellar-border rounded-lg p-4">
            <p className="text-xs text-stellar-text-secondary">DEX Count</p>
            <p className="mt-1 text-xl font-bold text-white">{metrics.dexCount}</p>
          </div>
        </div>
      )}

      {depthError && (
        <div
          role="alert"
          className="bg-yellow-900/30 border border-yellow-700 rounded-lg px-4 py-3 text-sm text-yellow-300"
        >
          Venue depth unavailable: {depthError}
        </div>
      )}

      <section
        className="bg-stellar-card border border-stellar-border rounded-lg p-6"
        aria-labelledby="venue-comparison-heading"
      >
        <h2 id="venue-comparison-heading" className="text-lg font-semibold text-white mb-1">
          AMM vs SDEX Depth Comparison
        </h2>
        <p className="text-sm text-stellar-text-secondary mb-4">
          Stellar Classic order book depth compared against Soroban AMM pooled reserves
          for {selectedAsset}
        </p>

        {venues.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {venues.map((venue) => (
              <div
                key={venue.venue}
                className="bg-stellar-bg border border-stellar-border rounded-lg p-3"
              >
                <p className="text-xs text-stellar-text-secondary">{venue.venue}</p>
                <p className="mt-1 text-base font-bold text-white">
                  $
                  {venue.totalLiquidity.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </p>
                <p className="text-xs text-stellar-text-secondary mt-1">
                  {venue.share.toFixed(2)}% of venue liquidity
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Depth by venue</h3>
            <VenueDepthComparison
              depth={depth}
              isLoading={isDepthLoading}
              pair={TRADING_PAIR_BY_ASSET[selectedAsset] ?? "USDC/XLM"}
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">
              Venue slippage for 10k / 50k / 100k USDC
            </h3>
            <VenueSlippageCalculator depth={depth} isLoading={isDepthLoading} />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-stellar-card border border-stellar-border rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Liquidity Distribution</h2>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-stellar-primary"></div>
            </div>
          ) : (
            <div className="space-y-3">
              {distribution.map((dex) => (
                <div key={dex.dex} className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-sm font-medium text-white">{dex.rank}.</span>
                    <span className="text-sm text-stellar-text-secondary">{dex.dex}</span>
                    <div className="flex-1 h-2 bg-stellar-bg rounded-full overflow-hidden">
                      <div
                        className="h-full bg-stellar-primary"
                        style={{ width: `${dex.share}%` }}
                      ></div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-white">{dex.share.toFixed(2)}%</p>
                    <p className="text-xs text-stellar-text-secondary">
                      ${dex.liquidity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-stellar-card border border-stellar-border rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Optimal Route Calculator</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-stellar-text-secondary mb-1 block">From</label>
                <select
                  value={routeParams.fromAsset}
                  onChange={(e) => setRouteParams({ ...routeParams, fromAsset: e.target.value })}
                  className="w-full bg-stellar-bg border border-stellar-border rounded px-3 py-2 text-white text-sm"
                >
                  {SUPPORTED_ASSETS.map((asset) => (
                    <option key={asset} value={asset}>
                      {asset}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-stellar-text-secondary mb-1 block">To</label>
                <select
                  value={routeParams.toAsset}
                  onChange={(e) => setRouteParams({ ...routeParams, toAsset: e.target.value })}
                  className="w-full bg-stellar-bg border border-stellar-border rounded px-3 py-2 text-white text-sm"
                >
                  {SUPPORTED_ASSETS.map((asset) => (
                    <option key={asset} value={asset}>
                      {asset}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-stellar-text-secondary mb-1 block">Amount</label>
              <input
                type="number"
                value={routeParams.amount}
                onChange={(e) => setRouteParams({ ...routeParams, amount: e.target.value })}
                className="w-full bg-stellar-bg border border-stellar-border rounded px-3 py-2 text-white text-sm"
                placeholder="Enter amount"
              />
            </div>

            <button
              onClick={calculateRoute}
              className="w-full bg-stellar-primary hover:bg-stellar-primary-hover text-white font-medium py-2 px-4 rounded transition-colors"
            >
              Calculate Route
            </button>

            {optimalRoute && (
              <div className="mt-4 space-y-3">
                <div className="bg-stellar-bg rounded p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-stellar-text-secondary">Estimated Output</span>
                    <span className="text-sm font-medium text-white">
                      {optimalRoute.estimatedOutput.toFixed(4)} {optimalRoute.toAsset}
                    </span>
                  </div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-stellar-text-secondary">Slippage</span>
                    <span className="text-sm font-medium text-yellow-400">
                      {optimalRoute.estimatedSlippage.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-stellar-text-secondary">Price Impact</span>
                    <span className="text-sm font-medium text-red-400">
                      {(optimalRoute.priceImpact * 100).toFixed(4)}%
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-stellar-text-secondary font-medium">Route Steps:</p>
                  {optimalRoute.routes.map((step, idx) => (
                    <div key={idx} className="bg-stellar-bg rounded p-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-stellar-text-secondary">{step.dex}</span>
                        <span className="text-white font-medium">
                          {(step.share * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="text-stellar-text-secondary mt-1">
                        {step.inputAmount.toFixed(2)} → {step.outputAmount.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="bg-stellar-card border border-stellar-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Arbitrage Opportunities</h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-stellar-primary"></div>
          </div>
        ) : arbitrageOps.length === 0 ? (
          <p className="text-stellar-text-secondary text-sm py-8 text-center">
            No arbitrage opportunities detected
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stellar-border">
                  <th className="text-left py-2 px-3 text-stellar-text-secondary font-medium">
                    Pair
                  </th>
                  <th className="text-left py-2 px-3 text-stellar-text-secondary font-medium">
                    Buy DEX
                  </th>
                  <th className="text-left py-2 px-3 text-stellar-text-secondary font-medium">
                    Sell DEX
                  </th>
                  <th className="text-right py-2 px-3 text-stellar-text-secondary font-medium">
                    Spread
                  </th>
                  <th className="text-right py-2 px-3 text-stellar-text-secondary font-medium">
                    Profit Est.
                  </th>
                  <th className="text-right py-2 px-3 text-stellar-text-secondary font-medium">
                    Confidence
                  </th>
                </tr>
              </thead>
              <tbody>
                {arbitrageOps.map((op, idx) => (
                  <tr key={idx} className="border-b border-stellar-border/50">
                    <td className="py-2 px-3 text-white font-medium">{op.assetPair}</td>
                    <td className="py-2 px-3 text-stellar-text-secondary">{op.buyDex}</td>
                    <td className="py-2 px-3 text-stellar-text-secondary">{op.sellDex}</td>
                    <td className="py-2 px-3 text-right text-green-400 font-medium">
                      {op.spreadPercent.toFixed(2)}%
                    </td>
                    <td className="py-2 px-3 text-right text-white">
                      ${op.potentialProfit.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                          op.confidence >= 70
                            ? "bg-green-900/30 text-green-400"
                            : op.confidence >= 40
                            ? "bg-yellow-900/30 text-yellow-400"
                            : "bg-red-900/30 text-red-400"
                        }`}
                      >
                        {op.confidence.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
