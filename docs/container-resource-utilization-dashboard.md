# Container Resource Utilization Dashboard

## Overview

The **Container Resource Utilization Dashboard** provides unified observability into CPU, memory, cgroup throttling, network I/O, disk throughput, and container lifecycle health across all Bridge-Watch microservices (`bridge-watch-api`, `bridge-watch-soroban-indexer`, `bridge-watch-horizon-worker`, `bridge-watch-liquidity-watcher`, `bridge-watch-outbox-processor`, `bridge-watch-timescaledb`, `bridge-watch-redis`, `bridge-watch-prometheus`).

It includes an automated capacity right-sizing recommendation engine that calculates p95 workload demands to prevent Out-Of-Memory (OOM) kills and reduce infrastructure cloud costs.

---

## Key Capabilities

1. **Real-Time Telemetry & Gauges**:
   - **CPU**: Millicores utilized, limit allocation, throttling time in milliseconds.
   - **Memory**: Working set bytes, RSS, limits, OOM danger threshold (>85%).
   - **Lifecycle**: Status (`running`, `stopped`, `restarted`, `oom_killed`), uptime, restart counts.
2. **cgroup Throttling Detection**:
   - Detects CPU CFS quota throttling and flags services experiencing degraded latency during ingestion spikes.
3. **Right-Sizing & Cloud Cost Optimization**:
   - Analyzes sustained 7-day and 24-hour p95 resource profiles.
   - Categorizes containers as `optimal`, `over_provisioned` (cost saving opportunities), or `under_provisioned` (OOM / throttle risk).

---

## API Surface

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/container-metrics/live` | Real-time container overview, capacity totals, and active saturation alerts |
| `GET` | `/api/v1/container-metrics/history` | Historical time-series telemetry filtered by container and time range |
| `GET` | `/api/v1/container-metrics/recommendations` | Capacity right-sizing and monthly cost optimization suggestions |
| `GET` | `/api/v1/container-metrics/alerts` | Active container saturation warnings (CPU throttle, memory near OOM) |
| `POST` | `/api/v1/container-metrics/sample` | Ingest container metric sample from monitoring daemon or cAdvisor |

---

## Operator Runbook

- **Frontend Access**: Navigate to `/container-resources`.
- **Throttling Remediation**: If CPU throttling alerts are triggered for `bridge-watch-soroban-indexer` or `bridge-watch-horizon-worker`, increase container CPU CFS quota limit by 500m.
- **Memory Saturation**: If memory reaches >90%, review TimescaleDB query connection pool settings or Soroban indexer in-memory cache size before container is OOM-killed by kernel.
