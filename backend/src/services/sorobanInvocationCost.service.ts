import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export interface InvocationCostRecord {
  contractId: string;
  functionName: string;
  transactionHash: string;
  ledgerSequence: bigint;
  invokedAt: Date;
  cpuInstructions: bigint;
  memoryBytes: bigint;
  networkBytes: bigint;
  cpuCost: number;
  memoryCost: number;
  networkCost: number;
  status: "success" | "failed" | "partial";
  errorCode?: string;
}

export interface CostTrendData {
  contractId: string;
  functionName: string;
  granularity: "hourly" | "daily" | "weekly" | "monthly";
  windowStart: Date;
  windowEnd: Date;
  invocationCount: number;
  avgTotalCost: number;
  p95TotalCost: number;
  p99TotalCost: number;
}

export class SorobanInvocationCostService {
  async recordInvocation(record: InvocationCostRecord) {
    logger.info({ contract: record.contractId, function: record.functionName }, "Recording Soroban invocation cost");

    try {
      const totalCost = record.cpuCost + record.memoryCost + record.networkCost;

      const [invocation] = await database("soroban_invocation_costs")
        .insert({
          contract_id: record.contractId,
          function_name: record.functionName,
          transaction_hash: record.transactionHash,
          ledger_sequence: record.ledgerSequence,
          invoked_at: record.invokedAt,
          cpu_instructions: record.cpuInstructions,
          memory_bytes: record.memoryBytes,
          network_bytes: record.networkBytes,
          cpu_cost: record.cpuCost,
          memory_cost: record.memoryCost,
          network_cost: record.networkCost,
          total_cost: totalCost,
          status: record.status,
          error_code: record.errorCode,
        })
        .returning("*");

      await this.detectCostAnomalies(invocation.id, record.contractId, record.functionName, totalCost);

      return invocation;
    } catch (error) {
      logger.error({ error }, "Failed to record invocation cost");
      throw error;
    }
  }

  private async detectCostAnomalies(invocationId: string, contractId: string, functionName: string, totalCost: number) {
    const database = getDatabase();
    const baseline = await database("soroban_invocation_costs")
      .where({ contract_id: contractId, function_name: functionName })
      .orderBy("invoked_at", "desc")
      .limit(1000)
      .select("total_cost")
      .then((rows) => {
        if (rows.length === 0) return null;
        const costs = rows.map((r) => Number(r.total_cost)).sort((a, b) => a - b);
        return costs[Math.floor(costs.length * 0.95)];
      });

    if (!baseline) return;

    const deviationPercent = ((totalCost - baseline) / baseline) * 100;

    if (deviationPercent > 50) {
      const severity = deviationPercent > 200 ? "critical" : deviationPercent > 100 ? "high" : "medium";

      await database("soroban_cost_anomalies").insert({
        invocation_id: invocationId,
        contract_id: contractId,
        function_name: functionName,
        anomaly_type: "cost_spike",
        deviation_percent: deviationPercent,
        baseline_cost: baseline,
        observed_cost: totalCost,
        severity,
        detected_at: new Date(),
        status: "open",
      });

      logger.warn({
        contract: contractId,
        function: functionName,
        deviation: deviationPercent,
        severity,
      }, "Cost anomaly detected");
    }
  }

  async computeTrends(contractId: string, functionName: string, granularity: "hourly" | "daily" | "weekly" | "monthly" = "daily") {
    logger.info({ contractId, functionName, granularity }, "Computing cost trends");

    const now = new Date();
    const lookbackDays = granularity === "hourly" ? 1 : granularity === "daily" ? 7 : granularity === "weekly" ? 30 : 90;
    const windowStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const rows = await database("soroban_invocation_costs")
      .where({ contract_id: contractId, function_name: functionName })
      .whereBetween("invoked_at", [windowStart, now])
      .select(["total_cost", "cpu_instructions", "memory_bytes"]);

    if (rows.length === 0) {
      return null;
    }

    const costs = rows.map((r) => Number(r.total_cost)).sort((a, b) => a - b);
    const cpuInstsAvg = rows.reduce((sum, r) => sum + Number(r.cpu_instructions), 0) / rows.length;
    const memoryAvg = rows.reduce((sum, r) => sum + Number(r.memory_bytes), 0) / rows.length;

    const trend = {
      contractId,
      functionName,
      granularity,
      windowStart,
      windowEnd: now,
      invocationCount: rows.length,
      avgTotalCost: costs.reduce((a, b) => a + b, 0) / costs.length,
      minTotalCost: costs[0],
      maxTotalCost: costs[costs.length - 1],
      p50TotalCost: costs[Math.floor(costs.length * 0.5)],
      p95TotalCost: costs[Math.floor(costs.length * 0.95)],
      p99TotalCost: costs[Math.floor(costs.length * 0.99)],
      avgCpuInstructions: cpuInstsAvg,
      avgMemoryBytes: memoryAvg,
    };

    await database("soroban_cost_trends")
      .insert({
        contract_id: contractId,
        function_name: functionName,
        granularity,
        window_start: trend.windowStart,
        window_end: trend.windowEnd,
        invocation_count: trend.invocationCount,
        avg_total_cost: trend.avgTotalCost,
        min_total_cost: trend.minTotalCost,
        max_total_cost: trend.maxTotalCost,
        p50_total_cost: trend.p50TotalCost,
        p95_total_cost: trend.p95TotalCost,
        p99_total_cost: trend.p99TotalCost,
        avg_cpu_instructions: trend.avgCpuInstructions,
        avg_memory_bytes: trend.avgMemoryBytes,
      })
      .onConflict(["contract_id", "function_name", "granularity", "window_start"])
      .merge();

    return trend;
  }

  async getTrends(contractId: string, functionName: string, granularity?: "hourly" | "daily" | "weekly" | "monthly") {
    const database = getDatabase();
    let query = database("soroban_cost_trends").where({ contract_id: contractId, function_name: functionName });

    if (granularity) {
      query = query.where({ granularity });
    }

    const trends = await query.orderBy("window_start", "desc").limit(52);
    return trends;
  }

  async getAnomalies(contractId: string, functionName: string, status: string = "open") {
    const database = getDatabase();
    const anomalies = await database("soroban_cost_anomalies")
      .where({ contract_id: contractId, function_name: functionName, status })
      .orderBy("detected_at", "desc")
      .limit(100);

    return anomalies;
  }

  async resolveAnomaly(anomalyId: string) {
    logger.info({ anomalyId }, "Resolving cost anomaly");

    await database("soroban_cost_anomalies").where("id", anomalyId).update({
      status: "resolved",
      updated_at: new Date(),
    });
  }
}

export const sorobanInvocationCostService = new SorobanInvocationCostService();
