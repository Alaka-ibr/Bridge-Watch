/* eslint-disable @typescript-eslint/no-loss-of-precision */
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export interface CorrelationSnapshot {
  id: string;
  assetA: string;
  assetB: string;
  period: string;
  correlationCoefficient: number;
  sampleCount: number;
  pValue: number | null;
  strength: string;
  metadata: Record<string, unknown> | null;
  computedAt: Date;
}

export interface CorrelationAlert {
  id: string;
  ownerAddress: string;
  assetA: string;
  assetB: string;
  condition: string;
  threshold: number;
  isActive: boolean;
  lastTriggeredAt: Date | null;
  createdAt: Date;
}

export class CorrelationAnalysisService {
  async computeCorrelation(
    assetA: string,
    assetB: string,
    period: "1h" | "4h" | "1d" | "7d" = "1d",
  ): Promise<CorrelationSnapshot> {
    const db = getDatabase();

    const intervalStr = period === "1h" ? "1 hour" : period === "4h" ? "4 hours" : period === "1d" ? "1 day" : "7 days";

    // Fetch price series for both assets
    const intervalStr = period === "1h" ? "hour" : period === "4h" ? "4 hours" : period === "1d" ? "day" : "7 days";
    const pricesA = await db("prices")
      .where("asset_code", assetA)
      .where("time", ">=", db.raw(`now() - interval '1 ${intervalStr}'`))
      .orderBy("time", "asc")
      .select("price");

    const pricesB = await db("prices")
      .where("asset_code", assetB)
      .where("time", ">=", db.raw(`now() - interval '1 ${intervalStr}'`))
      .orderBy("time", "asc")
      .select("price");

    const returnsA = this.computeReturns(pricesA.map((p) => Number(p.price)));
    const returnsB = this.computeReturns(pricesB.map((p) => Number(p.price)));

    const minLen = Math.min(returnsA.length, returnsB.length);
    const a = returnsA.slice(-minLen);
    const b = returnsB.slice(-minLen);

    const coefficient = this.pearsonCorrelation(a, b);
    const pValue = this.computePValue(coefficient, minLen);
    const strength = this.classifyStrength(coefficient);

    const [row] = await db("correlation_snapshots")
      .insert({
        asset_a: assetA,
        asset_b: assetB,
        period,
        correlation_coefficient: coefficient,
        sample_count: minLen,
        p_value: pValue,
        strength,
        metadata: JSON.stringify({ computedAt: new Date().toISOString() }),
      })
      .returning("*");

    return this.mapRow(row);
  }

  async getLatestCorrelation(assetA: string, assetB: string, period: string): Promise<CorrelationSnapshot | null> {
    const db = getDatabase();
    const row = await db("correlation_snapshots")
      .where({ asset_a: assetA, asset_b: assetB, period })
      .orWhere({ asset_a: assetB, asset_b: assetA, period })
      .orderBy("computed_at", "desc")
      .first();
    return row ? this.mapRow(row) : null;
  }

  async getCorrelationMatrix(assets: string[], period: string): Promise<Record<string, Record<string, number>>> {
    const matrix: Record<string, Record<string, number>> = {};
    for (const a of assets) {
      matrix[a] = {};
      for (const b of assets) {
        if (a === b) { matrix[a][b] = 1; continue; }
        const snap = await this.getLatestCorrelation(a, b, period);
        matrix[a][b] = snap?.correlationCoefficient ?? 0;
      }
    }
    return matrix;
  }

  async createAlert(ownerAddress: string, assetA: string, assetB: string, condition: string, threshold: number): Promise<CorrelationAlert> {
    const db = getDatabase();
    const [row] = await db("correlation_alerts")
      .insert({ owner_address: ownerAddress, asset_a: assetA, asset_b: assetB, condition, threshold })
      .returning("*");
    return this.mapAlertRow(row);
  }

  async listAlerts(ownerAddress: string): Promise<CorrelationAlert[]> {
    const db = getDatabase();
    const rows = await db("correlation_alerts").where("owner_address", ownerAddress).orderBy("created_at", "desc");
    return rows.map(this.mapAlertRow);
  }

  private computeReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] !== 0) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    return returns;
  }

  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n === 0) return 0;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }

  private computePValue(r: number, n: number): number {
    if (n <= 2) return 1;
    const t = r * Math.sqrt((n - 2) / (1 - r * r));
    return 2 * (1 - this.tCDF(Math.abs(t), n - 2));
  }

  private tCDF(t: number, df: number): number {
    const x = df / (df + t * t);
    return 1 - 0.5 * this.incompleteBeta(df / 2, 0.5, x);
  }

  private incompleteBeta(a: number, b: number, x: number): number {
    let sum = 0, term = 1;
    for (let i = 0; i < 200; i++) {
      if (i > 0) term *= x * (a + i - 1) / ((a + b + i - 1) * i);
      sum += term / (a + i);
    }
    return sum * Math.pow(x, a) * Math.pow(1 - x, b) / this.beta(a, b);
  }

  private beta(a: number, b: number): number {
    return Math.exp(this.lnGamma(a) + this.lnGamma(b) - this.lnGamma(a + b));
  }

  private lnGamma(z: number): number {
    // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let sum = 1.000000000190015;
    for (let i = 0; i < c.length; i++) sum += c[i] / (z + 1 + i);
    return Math.log(2.5066282746310005 * sum / z) + (z + 0.5) * Math.log(z + 5.5) - (z + 5.5);
  }

  private classifyStrength(r: number): string {
    const abs = Math.abs(r);
    if (abs >= 0.7) return "strong";
    if (abs >= 0.4) return "moderate";
    if (abs >= 0.2) return "weak";
    return "negligible";
  }

  private mapRow(row: Record<string, unknown>): CorrelationSnapshot {
    return {
      id: row.id as string,
      assetA: row.asset_a as string,
      assetB: row.asset_b as string,
      period: row.period as string,
      correlationCoefficient: Number(row.correlation_coefficient),
      sampleCount: row.sample_count as number,
      pValue: row.p_value != null ? Number(row.p_value) : null,
      strength: row.strength as string,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
      computedAt: row.computed_at as Date,
    };
  }

  private mapAlertRow(row: Record<string, unknown>): CorrelationAlert {
    return {
      id: row.id as string,
      ownerAddress: row.owner_address as string,
      assetA: row.asset_a as string,
      assetB: row.asset_b as string,
      condition: row.condition as string,
      threshold: Number(row.threshold),
      isActive: row.is_active as boolean,
      lastTriggeredAt: row.last_triggered_at as Date | null,
      createdAt: row.created_at as Date,
    };
  }
}

export const correlationAnalysisService = new CorrelationAnalysisService();
