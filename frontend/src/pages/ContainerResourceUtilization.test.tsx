import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ContainerResourceUtilization from "./ContainerResourceUtilization";

describe("ContainerResourceUtilization Page Component (#1191)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/live")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              totalContainers: 4,
              runningContainers: 4,
              totalCpuCapacityMillicores: 10000,
              totalCpuUsedMillicores: 3500,
              overallCpuPercent: 35.0,
              totalMemoryCapacityBytes: 8589934592,
              totalMemoryUsedBytes: 3435973836,
              overallMemoryPercent: 40.0,
              activeAlertCount: 0,
              alerts: [],
              containers: [
                {
                  container_id: "cnt_1",
                  container_name: "bridge-watch-api",
                  service_name: "api",
                  node_name: "node-1",
                  status: "running",
                  uptime_seconds: 1000,
                  restart_count: 0,
                  current_cpu_usage_millicores: 400,
                  current_cpu_limit_millicores: 2000,
                  current_cpu_percent: 20.0,
                  current_memory_bytes: 500000000,
                  current_memory_limit_bytes: 2000000000,
                  current_memory_percent: 25.0,
                  throttling_events_count: 0,
                  last_sample_time: new Date().toISOString(),
                },
              ],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            recommendations: [
              {
                container_name: "bridge-watch-api",
                service_name: "api",
                current_cpu_limit_millicores: 2000,
                recommended_cpu_limit_millicores: 1000,
                current_memory_limit_bytes: 2000000000,
                recommended_memory_limit_bytes: 1000000000,
                p95_cpu_millicores: 450,
                p95_memory_bytes: 600000000,
                estimated_monthly_saving_usd: 15.0,
                status: "over_provisioned",
                recommendation_reason: "Low utilization observed",
              },
            ],
          }),
      });
    });
  });

  it("renders container resource dashboard and KPI gauges", async () => {
    render(
      <BrowserRouter>
        <ContainerResourceUtilization />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Container Resource Utilization Dashboard")).toBeInTheDocument();
      expect(screen.getAllByText("bridge-watch-api").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Resource Capacity & Right-Sizing Recommendations")).toBeInTheDocument();
    });
  });
});
