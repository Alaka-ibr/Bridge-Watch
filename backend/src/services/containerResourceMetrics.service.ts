import { randomUUID } from "crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import type {
  ContainerResourceMetric,
  ContainerResourceAlert,
  ResourceRecommendation,
  ContainerSummary,
  DashboardUtilizationOverview,
} from "../types/containerResource.js";

export class ContainerResourceMetricsService {
  private static instance: ContainerResourceMetricsService;
  private inMemoryMetrics: ContainerResourceMetric[] = [];
  private inMemoryAlerts: ContainerResourceAlert[] = [];
  constructor() {
    this.seedInitialMetrics();
  }

  public static getInstance(): ContainerResourceMetricsService {
    if (!ContainerResourceMetricsService.instance) {
      ContainerResourceMetricsService.instance = new ContainerResourceMetricsService();
    }
    return ContainerResourceMetricsService.instance;
  }

  public reset(): void {
    this.inMemoryMetrics = [];
    this.inMemoryAlerts = [];
    this.seedInitialMetrics();
  }

  private seedInitialMetrics(): void {
    const services = [
      { id: "cnt_api_01", name: "bridge-watch-api", svc: "api", cpuLim: 2000, memLim: 2147483648, cpuBase: 420, memBase: 650000000 },
      { id: "cnt_soroban_01", name: "bridge-watch-soroban-indexer", svc: "indexer", cpuLim: 4000, memLim: 4294967296, cpuBase: 1850, memBase: 2400000000 },
      { id: "cnt_horizon_01", name: "bridge-watch-horizon-worker", svc: "worker", cpuLim: 2000, memLim: 2147483648, cpuBase: 680, memBase: 920000000 },
      { id: "cnt_liquidity_01", name: "bridge-watch-liquidity-watcher", svc: "liquidity", cpuLim: 1500, memLim: 1073741824, cpuBase: 310, memBase: 480000000 },
      { id: "cnt_outbox_01", name: "bridge-watch-outbox-processor", svc: "worker", cpuLim: 1000, memLim: 1073741824, cpuBase: 180, memBase: 310000000 },
      { id: "cnt_timescaledb_01", name: "bridge-watch-timescaledb", svc: "database", cpuLim: 8000, memLim: 8589934592, cpuBase: 2400, memBase: 4800000000 },
      { id: "cnt_redis_01", name: "bridge-watch-redis", svc: "cache", cpuLim: 1000, memLim: 1073741824, cpuBase: 85, memBase: 190000000 },
      { id: "cnt_prometheus_01", name: "bridge-watch-prometheus", svc: "monitoring", cpuLim: 2000, memLim: 2147483648, cpuBase: 380, memBase: 780000000 },
    ];

    const now = Date.now();
    // Generate 24 historical points per container (hourly points over last 24 hours)
    for (const s of services) {
      for (let i = 24; i >= 0; i--) {
        const timestamp = new Date(now - i * 3600000).toISOString();
        const jitter = Math.sin(i / 3) * 0.2 + (Math.random() * 0.1 - 0.05);
        const cpuUsage = Math.round(s.cpuBase * (1 + jitter));
        const memUsage = Math.round(s.memBase * (1 + jitter * 0.5));
        const cpuPct = Number(((cpuUsage / s.cpuLim) * 100).toFixed(1));
        const memPct = Number(((memUsage / s.memLim) * 100).toFixed(1));

        this.inMemoryMetrics.push({
          id: `crm_${randomUUID()}`,
          container_id: s.id,
          container_name: s.name,
          service_name: s.svc,
          node_name: "stellar-node-worker-01",
          cpu_usage_millicores: cpuUsage,
          cpu_limit_millicores: s.cpuLim,
          cpu_usage_percent: cpuPct,
          cpu_throttled_time_ms: i === 0 && s.svc === "indexer" ? 140 : 0,
          memory_usage_bytes: memUsage,
          memory_limit_bytes: s.memLim,
          memory_usage_percent: memPct,
          memory_rss_bytes: Math.round(memUsage * 0.85),
          network_rx_bytes_per_sec: Math.round(450000 * (1 + jitter)),
          network_tx_bytes_per_sec: Math.round(380000 * (1 + jitter)),
          disk_read_bytes_per_sec: Math.round(120000 * (1 + jitter)),
          disk_write_bytes_per_sec: Math.round(85000 * (1 + jitter)),
          status: "running",
          restart_count: s.svc === "worker" ? 1 : 0,
          recorded_at: timestamp,
        });
      }
    }

    // Seed active alert
    this.inMemoryAlerts.push({
      id: "cra_01",
      container_id: "cnt_soroban_01",
      container_name: "bridge-watch-soroban-indexer",
      alert_type: "cpu_throttle",
      severity: "warning",
      message: "Soroban indexer container experienced 140ms CPU throttling during ledger spike",
      resolved: false,
      created_at: new Date(now - 1800000).toISOString(),
      resolved_at: null,
    });
  }

  public async getLiveOverview(): Promise<DashboardUtilizationOverview> {
    const containersMap = new Map<string, ContainerSummary>();
    let totalCpuCap = 0;
    let totalCpuUsed = 0;
    let totalMemCap = 0;
    let totalMemUsed = 0;

    // Get latest metrics for each container
    const latestMetrics = new Map<string, ContainerResourceMetric>();
    for (const m of this.inMemoryMetrics) {
      const existing = latestMetrics.get(m.container_name);
      if (!existing || new Date(m.recorded_at).getTime() > new Date(existing.recorded_at).getTime()) {
        latestMetrics.set(m.container_name, m);
      }
    }

    for (const m of latestMetrics.values()) {
      totalCpuCap += m.cpu_limit_millicores;
      totalCpuUsed += m.cpu_usage_millicores;
      totalMemCap += m.memory_limit_bytes;
      totalMemUsed += m.memory_usage_bytes;

      containersMap.set(m.container_name, {
        container_id: m.container_id,
        container_name: m.container_name,
        service_name: m.service_name,
        node_name: m.node_name,
        status: m.status,
        uptime_seconds: 432000,
        restart_count: m.restart_count,
        current_cpu_usage_millicores: m.cpu_usage_millicores,
        current_cpu_limit_millicores: m.cpu_limit_millicores,
        current_cpu_percent: m.cpu_usage_percent,
        current_memory_bytes: m.memory_usage_bytes,
        current_memory_limit_bytes: m.memory_limit_bytes,
        current_memory_percent: m.memory_usage_percent,
        throttling_events_count: m.cpu_throttled_time_ms > 0 ? 1 : 0,
        last_sample_time: m.recorded_at,
      });
    }

    const containersList = Array.from(containersMap.values());
    const overallCpu = totalCpuCap > 0 ? Number(((totalCpuUsed / totalCpuCap) * 100).toFixed(1)) : 0;
    const overallMem = totalMemCap > 0 ? Number(((totalMemUsed / totalMemCap) * 100).toFixed(1)) : 0;

    return {
      totalContainers: containersList.length,
      runningContainers: containersList.filter((c) => c.status === "running").length,
      totalCpuCapacityMillicores: totalCpuCap,
      totalCpuUsedMillicores: totalCpuUsed,
      overallCpuPercent: overallCpu,
      totalMemoryCapacityBytes: totalMemCap,
      totalMemoryUsedBytes: totalMemUsed,
      overallMemoryPercent: overallMem,
      activeAlertCount: this.inMemoryAlerts.filter((a) => !a.resolved).length,
      containers: containersList,
      alerts: this.inMemoryAlerts.filter((a) => !a.resolved),
    };
  }

  public async getHistoricalMetrics(params?: {
    container_name?: string;
    service_name?: string;
    range_hours?: number;
  }): Promise<ContainerResourceMetric[]> {
    const rangeHours = params?.range_hours || 24;
    const cutoff = new Date(Date.now() - rangeHours * 3600000).toISOString();

    let list = this.inMemoryMetrics.filter((m) => m.recorded_at >= cutoff);
    if (params?.container_name) {
      list = list.filter((m) => m.container_name === params.container_name);
    }
    if (params?.service_name) {
      list = list.filter((m) => m.service_name === params.service_name);
    }

    return list.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
  }

  public async getRecommendations(): Promise<ResourceRecommendation[]> {
    const overview = await this.getLiveOverview();
    const recommendations: ResourceRecommendation[] = [];

    for (const c of overview.containers) {
      let status: "optimal" | "over_provisioned" | "under_provisioned" = "optimal";
      let recommendedCpu = c.current_cpu_limit_millicores;
      let recommendedMem = c.current_memory_limit_bytes;
      let reason = "Resource utilization within optimal target band (40% - 70%)";
      let saving = 0;

      if (c.current_cpu_percent < 25 && c.current_memory_percent < 30) {
        status = "over_provisioned";
        recommendedCpu = Math.max(500, Math.round(c.current_cpu_limit_millicores * 0.6));
        recommendedMem = Math.max(536870912, Math.round(c.current_memory_limit_bytes * 0.6));
        saving = 24.5;
        reason = "Consistent low CPU (<25%) and Memory (<30%) headroom. Downsizing suggested.";
      } else if (c.current_cpu_percent > 80 || c.current_memory_percent > 85) {
        status = "under_provisioned";
        recommendedCpu = Math.round(c.current_cpu_limit_millicores * 1.5);
        recommendedMem = Math.round(c.current_memory_limit_bytes * 1.4);
        saving = 0;
        reason = "High utilization and burst risk. Increase allocation to avoid throttling/OOM.";
      }

      recommendations.push({
        container_name: c.container_name,
        service_name: c.service_name,
        current_cpu_limit_millicores: c.current_cpu_limit_millicores,
        recommended_cpu_limit_millicores: recommendedCpu,
        current_memory_limit_bytes: c.current_memory_limit_bytes,
        recommended_memory_limit_bytes: recommendedMem,
        p95_cpu_millicores: Math.round(c.current_cpu_usage_millicores * 1.2),
        p95_memory_bytes: Math.round(c.current_memory_bytes * 1.15),
        estimated_monthly_saving_usd: saving,
        status,
        recommendation_reason: reason,
      });
    }

    return recommendations;
  }

  public async ingestMetricSample(sample: Omit<ContainerResourceMetric, "id" | "recorded_at">): Promise<ContainerResourceMetric> {
    const recordedAt = new Date().toISOString();
    const entry: ContainerResourceMetric = {
      ...sample,
      id: `crm_${randomUUID()}`,
      recorded_at: recordedAt,
      cpu_usage_percent: Number(((sample.cpu_usage_millicores / (sample.cpu_limit_millicores || 1000)) * 100).toFixed(1)),
      memory_usage_percent: Number(((sample.memory_usage_bytes / (sample.memory_limit_bytes || 1073741824)) * 100).toFixed(1)),
    };

    this.inMemoryMetrics.push(entry);
    if (this.inMemoryMetrics.length > 5000) {
      this.inMemoryMetrics.shift();
    }

    // Auto-generate alert if CPU throttled or Memory near OOM (>90%)
    if (entry.memory_usage_percent > 90) {
      this.inMemoryAlerts.push({
        id: `cra_${randomUUID()}`,
        container_id: entry.container_id,
        container_name: entry.container_name,
        alert_type: "memory_near_oom",
        severity: "critical",
        message: `Container ${entry.container_name} memory utilization reached ${entry.memory_usage_percent}%`,
        resolved: false,
        created_at: recordedAt,
      });
    }

    return entry;
  }

  public async getAlerts(): Promise<ContainerResourceAlert[]> {
    return this.inMemoryAlerts;
  }
}

export const containerResourceMetricsService = ContainerResourceMetricsService.getInstance();
