import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ContainerResourceMetricsService,
} from "../containerResourceMetrics.service.js";

vi.mock("../../database/connection.js", () => {
  const mockDb: any = vi.fn().mockImplementation(() => mockDb);
  mockDb.schema = { hasTable: vi.fn().mockResolvedValue(true) };
  mockDb.where = vi.fn().mockReturnValue(mockDb);
  mockDb.insert = vi.fn().mockResolvedValue([1]);
  mockDb.select = vi.fn().mockResolvedValue([]);
  mockDb.orderBy = vi.fn().mockReturnValue(mockDb);
  mockDb.limit = vi.fn().mockReturnValue(mockDb);
  return { getDatabase: () => mockDb };
});

describe("ContainerResourceMetricsService", () => {
  let service: ContainerResourceMetricsService;

  beforeEach(() => {
    service = new ContainerResourceMetricsService();
    vi.clearAllMocks();
  });

  describe("Live Dashboard Overview", () => {
    it("should return live overview with total CPU, memory, and container summaries", async () => {
      const overview = await service.getLiveOverview();

      expect(overview.totalContainers).toBeGreaterThan(0);
      expect(overview.runningContainers).toBeGreaterThan(0);
      expect(overview.totalCpuCapacityMillicores).toBeGreaterThan(0);
      expect(overview.totalMemoryCapacityBytes).toBeGreaterThan(0);
      expect(overview.overallCpuPercent).toBeGreaterThan(0);
      expect(overview.overallMemoryPercent).toBeGreaterThan(0);
      expect(Array.isArray(overview.containers)).toBe(true);
      expect(overview.containers.length).toBe(overview.totalContainers);
    });

    it("should provide per-container stats including cpu and memory percentages", async () => {
      const overview = await service.getLiveOverview();
      const apiContainer = overview.containers.find((c) => c.container_name === "bridge-watch-api");

      expect(apiContainer).toBeDefined();
      expect(apiContainer?.status).toBe("running");
      expect(apiContainer?.current_cpu_percent).toBeGreaterThan(0);
      expect(apiContainer?.current_memory_percent).toBeGreaterThan(0);
    });
  });

  describe("Historical Metrics & Time-Series", () => {
    it("should return historical metrics filtered by container name and range", async () => {
      const metrics = await service.getHistoricalMetrics({
        container_name: "bridge-watch-api",
        range_hours: 24,
      });

      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics.every((m) => m.container_name === "bridge-watch-api")).toBe(true);
      expect(metrics[0].recorded_at).toBeDefined();
    });
  });

  describe("Right-Sizing Capacity Recommendations", () => {
    it("should generate right-sizing recommendations for workloads", async () => {
      const recommendations = await service.getRecommendations();

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].container_name).toBeDefined();
      expect(recommendations[0].recommended_cpu_limit_millicores).toBeGreaterThan(0);
      expect(recommendations[0].status).toMatch(/optimal|over_provisioned|under_provisioned/);
      expect(recommendations[0].recommendation_reason).toBeDefined();
    });
  });

  describe("Metric Sample Ingestion & Alerting", () => {
    it("should ingest live sample and trigger alert if memory exceeds threshold", async () => {
      const sample = await service.ingestMetricSample({
        container_id: "test_cnt_99",
        container_name: "bridge-watch-stress-worker",
        service_name: "worker",
        node_name: "stellar-node-1",
        cpu_usage_millicores: 950,
        cpu_limit_millicores: 1000,
        cpu_throttled_time_ms: 50,
        memory_usage_bytes: 980000000, // ~91% of 1GB
        memory_limit_bytes: 1073741824,
        memory_rss_bytes: 900000000,
        network_rx_bytes_per_sec: 100000,
        network_tx_bytes_per_sec: 50000,
        disk_read_bytes_per_sec: 20000,
        disk_write_bytes_per_sec: 10000,
        status: "running",
        restart_count: 0,
      });

      expect(sample.id).toBeDefined();
      expect(sample.memory_usage_percent).toBeGreaterThan(90);

      const alerts = await service.getAlerts();
      const memAlert = alerts.find((a) => a.container_id === "test_cnt_99");
      expect(memAlert).toBeDefined();
      expect(memAlert?.alert_type).toBe("memory_near_oom");
      expect(memAlert?.severity).toBe("critical");
    });
  });
});
