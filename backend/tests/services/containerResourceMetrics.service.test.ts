import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ContainerResourceMetricsService,
} from "../../src/services/containerResourceMetrics.service.js";

describe("ContainerResourceMetricsService Unit Tests", () => {
  let service: ContainerResourceMetricsService;

  beforeEach(() => {
    service = new ContainerResourceMetricsService();
    vi.clearAllMocks();
  });

  it("should return live overview with total CPU, memory, and container summaries", async () => {
    const overview = await service.getLiveOverview();
    expect(overview.totalContainers).toBeGreaterThan(0);
    expect(overview.runningContainers).toBeGreaterThan(0);
    expect(overview.overallCpuPercent).toBeGreaterThan(0);
    expect(overview.overallMemoryPercent).toBeGreaterThan(0);
  });

  it("should generate right-sizing recommendations", async () => {
    const recommendations = await service.getRecommendations();
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0].recommended_cpu_limit_millicores).toBeGreaterThan(0);
  });

  it("should ingest sample and trigger memory alert when above threshold", async () => {
    const sample = await service.ingestMetricSample({
      container_id: "test_cnt_1",
      container_name: "bridge-watch-soroban-indexer",
      service_name: "indexer",
      node_name: "stellar-node-1",
      cpu_usage_millicores: 1200,
      cpu_limit_millicores: 2000,
      cpu_throttled_time_ms: 10,
      memory_usage_bytes: 1000000000, // ~93% of 1GB
      memory_limit_bytes: 1073741824,
      memory_rss_bytes: 950000000,
      network_rx_bytes_per_sec: 1000,
      network_tx_bytes_per_sec: 2000,
      disk_read_bytes_per_sec: 500,
      disk_write_bytes_per_sec: 500,
      status: "running",
      restart_count: 0,
    });

    expect(sample.memory_usage_percent).toBeGreaterThan(90);
    const alerts = await service.getAlerts();
    expect(alerts.some((a) => a.container_id === "test_cnt_1")).toBe(true);
  });
});
