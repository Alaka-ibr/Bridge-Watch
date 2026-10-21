export interface ContainerResourceMetric {
  id: string;
  container_id: string;
  container_name: string;
  service_name: string;
  node_name: string;
  cpu_usage_millicores: number;
  cpu_limit_millicores: number;
  cpu_usage_percent: number;
  cpu_throttled_time_ms: number;
  memory_usage_bytes: number;
  memory_limit_bytes: number;
  memory_usage_percent: number;
  memory_rss_bytes: number;
  network_rx_bytes_per_sec: number;
  network_tx_bytes_per_sec: number;
  disk_read_bytes_per_sec: number;
  disk_write_bytes_per_sec: number;
  status: "running" | "stopped" | "restarted" | "oom_killed";
  restart_count: number;
  recorded_at: string;
}

export interface ContainerResourceAlert {
  id: string;
  container_id: string;
  container_name: string;
  alert_type: "cpu_throttle" | "memory_near_oom" | "frequent_restarts" | "disk_saturation";
  severity: "info" | "warning" | "critical";
  message: string;
  resolved: boolean;
  created_at: string;
  resolved_at?: string | null;
}

export interface ResourceRecommendation {
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

export interface ContainerSummary {
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

export interface DashboardUtilizationOverview {
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
  alerts: ContainerResourceAlert[];
}
