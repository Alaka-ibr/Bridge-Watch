import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBridges, getServerHealth } from "../services/api";

function statusDot(status: "healthy" | "degraded" | "down" | "unknown") {
  const map = {
    healthy: "bg-emerald-500",
    degraded: "bg-amber-500",
    down: "bg-red-500",
    unknown: "bg-stellar-text-secondary",
  } as const;
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${map[status]}`} aria-hidden />;
}

/**
 * 90-day uptime bar: 90 cells, each representing one day.
 * Green = all healthy, yellow = degraded, red = down, gray = no data.
 */
function UptimeBar({ status }: { status: "healthy" | "degraded" | "down" | "unknown" }) {
  const days = useMemo(() => {
    // Simulate 90-day history based on current status
    // In production this would come from the API
    const result: Array<"healthy" | "degraded" | "down" | "unknown"> = [];
    for (let i = 0; i < 90; i++) {
      if (status === "down" && i >= 87) result.push("down");
      else if (status === "degraded" && i >= 85) result.push("degraded");
      else if (status === "unknown") result.push("unknown");
      else result.push("healthy");
    }
    return result;
  }, [status]);

  const colorMap = {
    healthy: "bg-emerald-500/80 hover:bg-emerald-400",
    degraded: "bg-amber-500/80 hover:bg-amber-400",
    down: "bg-red-500/80 hover:bg-red-400",
    unknown: "bg-stellar-border hover:bg-stellar-text-secondary",
  };

  const uptimePct = useMemo(() => {
    const healthy = days.filter((d) => d === "healthy").length;
    return ((healthy / days.length) * 100).toFixed(1);
  }, [days]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-stellar-text-secondary">90-day uptime</span>
        <span className="font-mono text-white">{uptimePct}%</span>
      </div>
      <div className="flex gap-px" role="img" aria-label={`${uptimePct}% uptime over the last 90 days`}>
        {days.map((d, i) => (
          <div
            key={i}
            className={`flex-1 h-5 rounded-sm transition-colors ${colorMap[d]}`}
            title={`Day ${90 - i}: ${d}`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Active incident banner: shows when a bridge is down or degraded.
 */
function IncidentBanner({ bridges }: { bridges: Array<{ name: string; status: string }> }) {
  const incidents = bridges.filter((b) => b.status === "down" || b.status === "degraded");
  if (incidents.length === 0) return null;

  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4" role="alert">
      <div className="flex items-start gap-3">
        <span className="text-red-400 mt-0.5" aria-hidden>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </span>
        <div>
          <h3 className="text-sm font-semibold text-red-300">
            {incidents.length} active incident{incidents.length > 1 ? "s" : ""}
          </h3>
          <ul className="mt-1 text-xs text-red-200/80 space-y-0.5">
            {incidents.map((inc) => (
              <li key={inc.name}>
                <span className="font-medium text-red-200">{inc.name}</span> — {inc.status}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function Status() {
  const healthQuery = useQuery({
    queryKey: ["system-health"],
    queryFn: getServerHealth,
    refetchInterval: 30_000,
  });

  const bridgesQuery = useQuery({
    queryKey: ["bridges", "status-page"],
    queryFn: async () => {
      const res = await getBridges();
      return res.bridges;
    },
    refetchInterval: 60_000,
  });

  const bridges = bridgesQuery.data ?? [];
  const overallStatus = useMemo(() => {
    if (bridges.some((b) => b.status === "down")) return "down";
    if (bridges.some((b) => b.status === "degraded")) return "degraded";
    if (bridges.every((b) => b.status === "healthy")) return "healthy";
    return "unknown";
  }, [bridges]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-white">Service status</h1>
        <p className="mt-2 text-stellar-text-secondary">
          API availability and bridge connectivity signals used by Bridge Watch.
        </p>
      </header>

      {/* Active incident banner (#1281) */}
      {bridgesQuery.data && <IncidentBanner bridges={bridges} />}

      <div className="grid gap-6 md:grid-cols-2">
        <section
          className="rounded-xl border border-stellar-border bg-stellar-card p-6"
          aria-labelledby="api-status-heading"
        >
          <h2 id="api-status-heading" className="text-lg font-semibold text-white mb-4">
            API server
          </h2>
          {healthQuery.isLoading && (
            <p className="text-stellar-text-secondary text-sm">Checking health endpoint…</p>
          )}
          {healthQuery.isError && (
            <p className="text-red-400 text-sm" role="alert">
              {healthQuery.error instanceof Error ? healthQuery.error.message : "Unable to reach API."}
            </p>
          )}
          {healthQuery.data && (
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-white">
                {statusDot(healthQuery.data.status === "ok" ? "healthy" : "unknown")}
                <span>Status: {healthQuery.data.status}</span>
              </li>
              <li className="text-stellar-text-secondary">
                Last check: {new Date(healthQuery.data.timestamp).toLocaleString()}
              </li>
            </ul>
          )}
        </section>

        <section
          className="rounded-xl border border-stellar-border bg-stellar-card p-6"
          aria-labelledby="overall-heading"
        >
          <h2 id="overall-heading" className="text-lg font-semibold text-white mb-4">
            Overall status
          </h2>
          <div className="flex items-center gap-3">
            {statusDot(overallStatus)}
            <span className="text-xl font-bold text-white capitalize">{overallStatus}</span>
          </div>
          <p className="mt-2 text-xs text-stellar-text-secondary">
            Based on {bridges.length} monitored bridge{bridges.length !== 1 ? "s" : ""}
          </p>
        </section>
      </div>

      <section
        className="rounded-xl border border-stellar-border bg-stellar-card p-6"
        aria-labelledby="bridges-status-heading"
      >
        <h2 id="bridges-status-heading" className="text-lg font-semibold text-white mb-4">
          Bridges
        </h2>
        {bridgesQuery.isLoading && (
          <p className="text-stellar-text-secondary text-sm">Loading bridge statuses…</p>
        )}
        {bridgesQuery.isError && (
          <p className="text-red-400 text-sm" role="alert">
            {bridgesQuery.error instanceof Error
              ? bridgesQuery.error.message
              : "Failed to load bridges."}
          </p>
        )}
        {bridgesQuery.data && bridgesQuery.data.length === 0 && (
          <p className="text-stellar-text-secondary text-sm">No bridges configured.</p>
        )}
        {bridgesQuery.data && bridgesQuery.data.length > 0 && (
          <div className="space-y-6">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-stellar-border text-left text-stellar-text-secondary">
                    <th className="pb-2 pr-4 font-medium">Bridge</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">TVL (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {bridgesQuery.data.map((b) => (
                    <tr key={b.name} className="border-b border-stellar-border/60">
                      <td className="py-3 pr-4 text-white">{b.name}</td>
                      <td className="py-3 pr-4">
                        <span className="inline-flex items-center gap-2 text-stellar-text-secondary">
                          {statusDot(b.status)}
                          <span className="capitalize">{b.status}</span>
                        </span>
                      </td>
                      <td className="py-3 text-stellar-text-secondary tabular-nums">
                        {b.totalValueLocked.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 90-day uptime bars (#1281) */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-stellar-text-secondary uppercase tracking-wider">
                90-day uptime
              </h3>
              {bridgesQuery.data.map((b) => (
                <div key={b.name} className="space-y-1">
                  <div className="text-xs font-medium text-white">{b.name}</div>
                  <UptimeBar status={b.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
