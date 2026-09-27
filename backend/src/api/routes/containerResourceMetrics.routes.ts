import type { FastifyInstance } from "fastify";
import {
  containerResourceMetricsService,
} from "../../services/containerResourceMetrics.service.js";

const containerSummarySchema = {
  type: "object",
  properties: {
    container_id: { type: "string" },
    container_name: { type: "string" },
    service_name: { type: "string" },
    node_name: { type: "string" },
    status: { type: "string" },
    uptime_seconds: { type: "number" },
    restart_count: { type: "number" },
    current_cpu_usage_millicores: { type: "number" },
    current_cpu_limit_millicores: { type: "number" },
    current_cpu_percent: { type: "number" },
    current_memory_bytes: { type: "number" },
    current_memory_limit_bytes: { type: "number" },
    current_memory_percent: { type: "number" },
    throttling_events_count: { type: "number" },
    last_sample_time: { type: "string" },
  },
} as const;

export async function containerResourceMetricsRoutes(server: FastifyInstance) {
  // GET /api/v1/container-metrics/live - Full live dashboard overview
  server.get(
    "/live",
    {
      schema: {
        tags: ["Container Resource Metrics"],
        summary: "Get real-time container resource utilization overview and alerts",
        response: {
          200: {
            type: "object",
            properties: {
              totalContainers: { type: "number" },
              runningContainers: { type: "number" },
              totalCpuCapacityMillicores: { type: "number" },
              totalCpuUsedMillicores: { type: "number" },
              overallCpuPercent: { type: "number" },
              totalMemoryCapacityBytes: { type: "number" },
              totalMemoryUsedBytes: { type: "number" },
              overallMemoryPercent: { type: "number" },
              activeAlertCount: { type: "number" },
              containers: { type: "array", items: containerSummarySchema },
              alerts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    container_id: { type: "string" },
                    container_name: { type: "string" },
                    alert_type: { type: "string" },
                    severity: { type: "string" },
                    message: { type: "string" },
                    resolved: { type: "boolean" },
                    created_at: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const live = await containerResourceMetricsService.getLiveOverview();
      return reply.send(live);
    }
  );

  // GET /api/v1/container-metrics/history - Historical time series metrics
  server.get<{
    Querystring: {
      container_name?: string;
      service_name?: string;
      range_hours?: number;
    };
  }>(
    "/history",
    {
      schema: {
        tags: ["Container Resource Metrics"],
        summary: "Query historical container resource metrics time series",
        querystring: {
          type: "object",
          properties: {
            container_name: { type: "string" },
            service_name: { type: "string" },
            range_hours: { type: "number", default: 24 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              metrics: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    container_id: { type: "string" },
                    container_name: { type: "string" },
                    service_name: { type: "string" },
                    node_name: { type: "string" },
                    cpu_usage_millicores: { type: "number" },
                    cpu_limit_millicores: { type: "number" },
                    cpu_usage_percent: { type: "number" },
                    cpu_throttled_time_ms: { type: "number" },
                    memory_usage_bytes: { type: "number" },
                    memory_limit_bytes: { type: "number" },
                    memory_usage_percent: { type: "number" },
                    memory_rss_bytes: { type: "number" },
                    network_rx_bytes_per_sec: { type: "number" },
                    network_tx_bytes_per_sec: { type: "number" },
                    disk_read_bytes_per_sec: { type: "number" },
                    disk_write_bytes_per_sec: { type: "number" },
                    status: { type: "string" },
                    restart_count: { type: "number" },
                    recorded_at: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const metrics = await containerResourceMetricsService.getHistoricalMetrics(request.query);
      return reply.send({ metrics });
    }
  );

  // GET /api/v1/container-metrics/recommendations - Resource right-sizing suggestions
  server.get(
    "/recommendations",
    {
      schema: {
        tags: ["Container Resource Metrics"],
        summary: "Get AI-driven container right-sizing and resource capacity recommendations",
        response: {
          200: {
            type: "object",
            properties: {
              recommendations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    container_name: { type: "string" },
                    service_name: { type: "string" },
                    current_cpu_limit_millicores: { type: "number" },
                    recommended_cpu_limit_millicores: { type: "number" },
                    current_memory_limit_bytes: { type: "number" },
                    recommended_memory_limit_bytes: { type: "number" },
                    p95_cpu_millicores: { type: "number" },
                    p95_memory_bytes: { type: "number" },
                    estimated_monthly_saving_usd: { type: "number" },
                    status: { type: "string" },
                    recommendation_reason: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const recommendations = await containerResourceMetricsService.getRecommendations();
      return reply.send({ recommendations });
    }
  );

  // GET /api/v1/container-metrics/alerts - Active container resource alerts
  server.get(
    "/alerts",
    {
      schema: {
        tags: ["Container Resource Metrics"],
        summary: "Get active container resource alerts",
        response: {
          200: {
            type: "object",
            properties: {
              alerts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    container_id: { type: "string" },
                    container_name: { type: "string" },
                    alert_type: { type: "string" },
                    severity: { type: "string" },
                    message: { type: "string" },
                    resolved: { type: "boolean" },
                    created_at: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const alerts = await containerResourceMetricsService.getAlerts();
      return reply.send({ alerts });
    }
  );

  // POST /api/v1/container-metrics/sample - Ingest metrics sample
  server.post<{
    Body: any;
  }>(
    "/sample",
    {
      schema: {
        tags: ["Container Resource Metrics"],
        summary: "Ingest a container resource metric telemetry sample from collector agent",
        body: {
          type: "object",
          required: ["container_id", "container_name", "service_name", "cpu_usage_millicores", "memory_usage_bytes"],
          properties: {
            container_id: { type: "string" },
            container_name: { type: "string" },
            service_name: { type: "string" },
            node_name: { type: "string", default: "stellar-node-1" },
            cpu_usage_millicores: { type: "number" },
            cpu_limit_millicores: { type: "number", default: 1000 },
            cpu_throttled_time_ms: { type: "number", default: 0 },
            memory_usage_bytes: { type: "number" },
            memory_limit_bytes: { type: "number", default: 1073741824 },
            memory_rss_bytes: { type: "number" },
            network_rx_bytes_per_sec: { type: "number", default: 0 },
            network_tx_bytes_per_sec: { type: "number", default: 0 },
            disk_read_bytes_per_sec: { type: "number", default: 0 },
            disk_write_bytes_per_sec: { type: "number", default: 0 },
            status: { type: "string", default: "running" },
            restart_count: { type: "number", default: 0 },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              sampleId: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const sample = await containerResourceMetricsService.ingestMetricSample(request.body);
      return reply.status(201).send({ success: true, sampleId: sample.id });
    }
  );
}
