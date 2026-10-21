import type { Knex } from "knex";

/**
 * Seed: Development-environment sample data.
 *
 * Inserts realistic-looking test records so a freshly initialised dev database
 * has enough rows to exercise UI filters, alert rule evaluation, and circuit
 * breaker logic without requiring a live Stellar network connection.
 *
 * Safe to re-run — every insert uses ON CONFLICT DO NOTHING.
 * NOT safe for production — guarded by seed.ts when NODE_ENV=production.
 */
export async function seed(knex: Knex): Promise<void> {
  // ── API keys ──────────────────────────────────────────────────────────────
  // Three test keys: one active read-only, one active admin, one revoked.
  await knex("api_keys")
    .insert([
      {
        key_hash: "dev_readonly_key_hash_placeholder_aabbccddee",
        description: "Dev – read-only dashboard key",
        role: "viewer",
        is_active: true,
      },
      {
        key_hash: "dev_admin_key_hash_placeholder_112233445566",
        description: "Dev – admin key (local testing only)",
        role: "admin",
        is_active: true,
      },
      {
        key_hash: "dev_revoked_key_hash_placeholder_aabbcc001122",
        description: "Dev – revoked key (tests that expect 401)",
        role: "viewer",
        is_active: false,
      },
    ])
    .onConflict("key_hash")
    .ignore();

  // ── Circuit-breaker overrides for dev bridges ─────────────────────────────
  // Lower thresholds so the dev environment trips faster during manual testing.
  await knex("circuit_breaker_configs")
    .insert([
      {
        bridge_name: "Stellar USDC Bridge",
        threshold_percentage: 2.0,
        window_seconds: 120,
        min_sample_size: 5,
        is_active: true,
      },
      {
        bridge_name: "Aquarius AMM Bridge",
        threshold_percentage: 5.0,
        window_seconds: 300,
        min_sample_size: 10,
        is_active: true,
      },
    ])
    .onConflict("bridge_name")
    .ignore();

  // ── Sample alert rules ────────────────────────────────────────────────────
  // Simple threshold rules exercising the alert evaluation pipeline locally.
  await knex("alert_rules")
    .insert([
      {
        name: "Dev – USDC reserve below 90%",
        metric_name: "reserve_ratio",
        asset_symbol: "USDC",
        operator: "lt",
        threshold: 0.9,
        severity: "warning",
        is_active: true,
        notification_channels: JSON.stringify(["console"]),
      },
      {
        name: "Dev – XLM depeg detected",
        metric_name: "depeg_basis_points",
        asset_symbol: "XLM",
        operator: "gt",
        threshold: 50,
        severity: "critical",
        is_active: true,
        notification_channels: JSON.stringify(["console"]),
      },
    ])
    .onConflict("name")
    .ignore();
}
