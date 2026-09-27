import React, { useState, useEffect } from "react";

interface ContainerSummary {
  container_id: string;
  container_name: string;
  service_name: string;
  node_name: string;
  status: string;
  uptime_seconds: number;
  restart_count: number;
  current_cpu_usage_millicores: number;
  current_cpu_limit_millicores: number;
  current_cpu_percent: number;
  current_memory_bytes: number;
  current_memory_limit_bytes: number;
  current_memory_percent: number;
  throttling_events_count: number;
  last_sample_time: string;
}

interface ContainerAlert {
  id: string;
  container_id: string;
  container_name: string;
  alert_type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  resolved: boolean;
  created_at: string;
}

interface Recommendation {
  container_name: string;
  service_name: string;
  current_cpu_limit_millicores: number;
  recommended_cpu_limit_millicores: number;
  current_memory_limit_bytes: number;
  recommended_memory_limit_bytes: number;
  p95_cpu_millicores: number;
  p95_memory_bytes: number;
  estimated_monthly_saving_usd: number;
  status: "optimal" | "over_provisioned" | "under_provisioned";
  recommendation_reason: string;
}

interface LiveOverview {
  totalContainers: number;
  runningContainers: number;
  totalCpuCapacityMillicores: number;
  totalCpuUsedMillicores: number;
  overallCpuPercent: number;
  totalMemoryCapacityBytes: number;
  totalMemoryUsedBytes: number;
  overallMemoryPercent: number;
  activeAlertCount: number;
  containers: ContainerSummary[];
  alerts: ContainerAlert[];
}

export const ContainerResourceUtilization: React.FC = () => {
  const [overview, setOverview] = useState<LiveOverview | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState<number>(24);
  const [searchFilter, setSearchFilter] = useState("");

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [selectedRange]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [liveRes, recRes] = await Promise.all([
        fetch("/api/v1/container-metrics/live"),
        fetch("/api/v1/container-metrics/recommendations"),
      ]);

      if (liveRes.ok && recRes.ok) {
        const liveData = await liveRes.json();
        const recData = await recRes.json();
        setOverview(liveData);
        setRecommendations(recData.recommendations || []);
      } else {
        // Mock fallback
        setOverview({
          totalContainers: 6,
          runningContainers: 6,
          totalCpuCapacityMillicores: 19000,
          totalCpuUsedMillicores: 5800,
          overallCpuPercent: 30.5,
          totalMemoryCapacityBytes: 20401094656,
          totalMemoryUsedBytes: 9400000000,
          overallMemoryPercent: 46.1,
          activeAlertCount: 1,
          alerts: [
            {
              id: "cra_1",
              container_id: "cnt_soroban_01",
              container_name: "bridge-watch-soroban-indexer",
              alert_type: "cpu_throttle",
              severity: "warning",
              message: "Soroban indexer container experienced CPU throttling during ledger sync spike",
              resolved: false,
              created_at: new Date().toISOString(),
            },
          ],
          containers: [
            {
              container_id: "cnt_1",
              container_name: "bridge-watch-api",
              service_name: "api",
              node_name: "node-worker-01",
              status: "running",
              uptime_seconds: 432000,
              restart_count: 0,
              current_cpu_usage_millicores: 420,
              current_cpu_limit_millicores: 2000,
              current_cpu_percent: 21.0,
              current_memory_bytes: 650000000,
              current_memory_limit_bytes: 2147483648,
              current_memory_percent: 30.3,
              throttling_events_count: 0,
              last_sample_time: new Date().toISOString(),
            },
            {
              container_id: "cnt_2",
              container_name: "bridge-watch-soroban-indexer",
              service_name: "indexer",
              node_name: "node-worker-01",
              status: "running",
              uptime_seconds: 432000,
              restart_count: 0,
              current_cpu_usage_millicores: 1850,
              current_cpu_limit_millicores: 4000,
              current_cpu_percent: 46.2,
              current_memory_bytes: 2400000000,
              current_memory_limit_bytes: 4294967296,
              current_memory_percent: 55.9,
              throttling_events_count: 1,
              last_sample_time: new Date().toISOString(),
            },
            {
              container_id: "cnt_3",
              container_name: "bridge-watch-timescaledb",
              service_name: "database",
              node_name: "node-worker-01",
              status: "running",
              uptime_seconds: 864000,
              restart_count: 0,
              current_cpu_usage_millicores: 2400,
              current_cpu_limit_millicores: 8000,
              current_cpu_percent: 30.0,
              current_memory_bytes: 4800000000,
              current_memory_limit_bytes: 8589934592,
              current_memory_percent: 55.8,
              throttling_events_count: 0,
              last_sample_time: new Date().toISOString(),
            },
          ],
        });

        setRecommendations([
          {
            container_name: "bridge-watch-api",
            service_name: "api",
            current_cpu_limit_millicores: 2000,
            recommended_cpu_limit_millicores: 1000,
            current_memory_limit_bytes: 2147483648,
            recommended_memory_limit_bytes: 1073741824,
            p95_cpu_millicores: 550,
            p95_memory_bytes: 780000000,
            estimated_monthly_saving_usd: 18.5,
            status: "over_provisioned",
            recommendation_reason: "Sustained CPU < 25% and Memory < 35%. Downsizing recommended to optimize cost.",
          },
        ]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const filteredContainers = (overview?.containers || []).filter(
    (c) =>
      c.container_name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      c.service_name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  if (loading && !overview) {
    return <div className="p-8 text-center text-gray-500">Loading container resource metrics...</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Container Resource Utilization Dashboard
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Real-time CPU & memory telemetry, cgroup throttling detection, and capacity right-sizing across microservices
          </p>
        </div>

        {/* Time Range Selector */}
        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg text-xs font-medium">
          {[
            { label: "1h", val: 1 },
            { label: "6h", val: 6 },
            { label: "24h", val: 24 },
            { label: "7d", val: 168 },
          ].map((r) => (
            <button
              key={r.val}
              onClick={() => setSelectedRange(r.val)}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                selectedRange === r.val
                  ? "bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 font-bold shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active Resource Alerts */}
      {overview && overview.alerts.length > 0 && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-sm">
            <span>⚠️</span> Active Resource Saturation Warnings ({overview.alerts.length})
          </div>
          {overview.alerts.map((a) => (
            <div key={a.id} className="text-xs text-amber-700 dark:text-amber-300 pl-6">
              • <span className="font-semibold">{a.container_name}:</span> {a.message}
            </div>
          ))}
        </div>
      )}

      {/* Overview KPI Cards */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Containers</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {overview.runningContainers} / {overview.totalContainers}
              <span className="text-xs font-normal text-green-500 ml-2">Running</span>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Cluster CPU Load</div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {overview.overallCpuPercent}%
              </span>
              <span className="text-xs text-gray-400 font-mono">
                {(overview.totalCpuUsedMillicores / 1000).toFixed(1)} / {(overview.totalCpuCapacityMillicores / 1000).toFixed(1)} Cores
              </span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-700 h-2 rounded-full mt-2 overflow-hidden">
              <div
                className={`h-full ${
                  overview.overallCpuPercent > 80 ? "bg-red-500" : "bg-blue-500"
                }`}
                style={{ width: `${Math.min(overview.overallCpuPercent, 100)}%` }}
              />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Cluster Memory Load</div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {overview.overallMemoryPercent}%
              </span>
              <span className="text-xs text-gray-400 font-mono">
                {formatBytes(overview.totalMemoryUsedBytes)} / {formatBytes(overview.totalMemoryCapacityBytes)}
              </span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-700 h-2 rounded-full mt-2 overflow-hidden">
              <div
                className={`h-full ${
                  overview.overallMemoryPercent > 80 ? "bg-red-500" : "bg-purple-500"
                }`}
                style={{ width: `${Math.min(overview.overallMemoryPercent, 100)}%` }}
              />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Monthly Cost Optimization</div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              $
              {recommendations
                .reduce((acc, r) => acc + (r.estimated_monthly_saving_usd || 0), 0)
                .toFixed(2)}
              <span className="text-xs font-normal text-gray-400 ml-1">/mo saving</span>
            </div>
          </div>
        </div>
      )}

      {/* Container Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm space-y-4 p-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Active Service Containers</h2>
          <input
            type="text"
            placeholder="Search container..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg w-64"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 font-medium text-xs">
              <tr>
                <th className="px-4 py-3">Container & Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">CPU Usage / Limit</th>
                <th className="px-4 py-3">Memory Usage / Limit</th>
                <th className="px-4 py-3">Throttling</th>
                <th className="px-4 py-3 text-right">Restarts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredContainers.map((c) => (
                <tr key={c.container_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-750">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900 dark:text-white font-mono text-xs">
                      {c.container_name}
                    </div>
                    <div className="text-[11px] text-gray-400">{c.service_name} • {c.node_name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        {c.current_cpu_percent}%
                      </span>
                      <span className="text-gray-400 font-mono text-[10px]">
                        {c.current_cpu_usage_millicores}m / {c.current_cpu_limit_millicores}m
                      </span>
                    </div>
                    <div className="w-36 bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          c.current_cpu_percent > 80 ? "bg-red-500" : "bg-blue-500"
                        }`}
                        style={{ width: `${Math.min(c.current_cpu_percent, 100)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        {c.current_memory_percent}%
                      </span>
                      <span className="text-gray-400 font-mono text-[10px]">
                        {formatBytes(c.current_memory_bytes)} / {formatBytes(c.current_memory_limit_bytes)}
                      </span>
                    </div>
                    <div className="w-36 bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          c.current_memory_percent > 80 ? "bg-red-500" : "bg-purple-500"
                        }`}
                        style={{ width: `${Math.min(c.current_memory_percent, 100)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.throttling_events_count > 0 ? (
                      <span className="px-2 py-0.5 text-xs rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-semibold">
                        {c.throttling_events_count} events
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-600 dark:text-gray-300">
                    {c.restart_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right-Sizing Capacity Recommendations */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            Resource Capacity & Right-Sizing Recommendations
          </h2>
          <p className="text-xs text-gray-500">
            Workload analysis based on p95 metrics to prevent OOM kills and eliminate cloud over-provisioning
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recommendations.map((rec) => (
            <div
              key={rec.container_name}
              className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold text-gray-900 dark:text-white text-sm font-mono">
                    {rec.container_name}
                  </div>
                  <div className="text-xs text-gray-400">{rec.service_name}</div>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs rounded font-bold uppercase ${
                    rec.status === "over_provisioned"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                      : rec.status === "under_provisioned"
                      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                  }`}
                >
                  {rec.status.replace("_", " ")}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs bg-white dark:bg-gray-800 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
                <div>
                  <div className="text-[10px] text-gray-400">Current Allocation</div>
                  <div className="font-semibold text-gray-800 dark:text-gray-200">
                    {rec.current_cpu_limit_millicores}m CPU • {formatBytes(rec.current_memory_limit_bytes)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400">Suggested Target</div>
                  <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {rec.recommended_cpu_limit_millicores}m CPU • {formatBytes(rec.recommended_memory_limit_bytes)}
                  </div>
                </div>
              </div>

              <div className="text-xs text-gray-500 dark:text-gray-400">{rec.recommendation_reason}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ContainerResourceUtilization;
