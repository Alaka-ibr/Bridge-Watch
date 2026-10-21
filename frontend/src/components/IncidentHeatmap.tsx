// src/components/IncidentHeatmap.tsx
import React, { useMemo } from "react";
import { useIncidentFeed, type IncidentSeverity, type BridgeIncident } from "../hooks/useIncidentFeed";
import { SkeletonChart } from "./Skeleton";
import EmptyState from "./EmptyState";

// Helper to bucket incidents by date (YYYY-MM-DD) and asset code
function bucketIncidents(incidents: BridgeIncident[]) {
  const bucket: Record<string, Record<string, { count: number; severityScore: number }>> = {};
  const severityScore: Record<IncidentSeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  incidents.forEach((inc) => {
    const date = new Date(inc.occurredAt).toISOString().slice(0, 10); // day bucket
    const asset = inc.assetCode ?? "unknown";
    if (!bucket[date]) bucket[date] = {};
    if (!bucket[date][asset]) bucket[date][asset] = { count: 0, severityScore: 0 };
    bucket[date][asset].count += 1;
    bucket[date][asset].severityScore += severityScore[inc.severity];
  });
  return bucket;
}

// Color scale based on average severity score per cell
function getColor(score: number) {
  if (score >= 3.5) return "bg-red-600"; // critical/high mix
  if (score >= 2.5) return "bg-orange-500"; // high/medium
  if (score >= 1.5) return "bg-yellow-400"; // medium/low
  return "bg-green-300"; // low only
}

export default function IncidentHeatmap() {
  const { incidents, isLoading, error } = useIncidentFeed({});

  const bucket = useMemo(() => bucketIncidents(incidents), [incidents]);

  // Build sorted arrays of dates and assets for consistent grid layout
  const dates = useMemo(() => Object.keys(bucket).sort(), [bucket]);
  const assetsSet = useMemo(() => {
    const set = new Set<string>();
    dates.forEach((d) => Object.keys(bucket[d]).forEach((a) => set.add(a)));
    return Array.from(set).sort();
  }, [dates, bucket]);

  return (
    <section aria-label="Incident heatmap" className="overflow-auto p-4">
      <h2 className="text-xl font-semibold mb-4 text-white">Incident Heatmap</h2>
      {error && (
        <div className="text-red-400" role="alert">
          Failed to load incidents.
        </div>
      )}
      {isLoading && (
        <SkeletonChart height={180} ariaLabel="Loading incident heatmap" />
      )}
      {!isLoading && !error && incidents.length === 0 && (
        <EmptyState
          title="No incidents"
          description="All systems operational — no incidents recorded for this period."
        />
      )}
      {!isLoading && !error && incidents.length > 0 && (
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${assetsSet.length + 1}, minmax(30px, 1fr))` }}>
          {/* Header row */}
          <div></div>
          {assetsSet.map((asset) => (
            <div key={asset} className="text-xs text-center text-stellar-text-secondary" title={asset}>
              {asset}
            </div>
          ))}
          {/* Data rows */}
          {dates.map((date) => (
            <React.Fragment key={date}>
              <div className="text-xs text-stellar-text-secondary" title={date}>
                {date}
              </div>
              {assetsSet.map((asset) => {
                const cell = bucket[date][asset];
                const count = cell?.count ?? 0;
                const avgScore = cell && cell.count > 0 ? cell.severityScore / cell.count : 0;
                const color = count > 0 ? getColor(avgScore) : "bg-stellar-card";
                return (
                  <div
                    key={asset}
                    className={`w-6 h-6 ${color} rounded`}
                    aria-label={`${date} – ${asset}: ${count} incident${count !== 1 ? "s" : ""}`}
                    title={`${date} – ${asset}: ${count}`}
                  ></div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      )}
    </section>
  );
}
