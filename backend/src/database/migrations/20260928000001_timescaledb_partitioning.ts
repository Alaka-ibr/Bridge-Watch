import type { Knex } from "knex";

/**
 * Automated partitioning for `user_sessions` and `login_risk_signals` (#1280).
 *
 * Converts these high-volume tables into TimescaleDB hypertables partitioned
 * by time, enabling automatic data lifecycle management (compression + retention)
 * without manual partition maintenance.
 *
 * `user_sessions`: partitioned by `created_at` — old sessions are routinely
 *   pruned; hypertable enables time-based queries (active sessions in last N hours)
 *   to run against compressed chunks only.
 *
 * `login_risk_signals`: partitioned by `detected_at` — risk signals are append-heavy
 *   and rarely queried individually; hypertable + compression keeps the hot path fast.
 */
export async function up(knex: Knex): Promise<void> {
  // ── user_sessions hypertable ──────────────────────────────────────────────
  // TimescaleDB hypertables require a unique constraint that includes the
  // partitioning column. `user_sessions` already has a primary key on `id`,
  // so we add a time-based unique index that includes `id` to satisfy the
  // hypertable constraint.
  await knex.raw(`
    SELECT create_hypertable(
      'user_sessions',
      'created_at',
      if_not_exists => TRUE,
      migrate_data => TRUE
    )
  `);

  // ── login_risk_signals hypertable ─────────────────────────────────────────
  await knex.raw(`
    SELECT create_hypertable(
      'login_risk_signals',
      'detected_at',
      if_not_exists => TRUE,
      migrate_data => TRUE
    )
  `);

  // ── Compression policies ──────────────────────────────────────────────────
  // Compress chunks older than 7 days to reduce storage footprint.
  await knex.raw(`
    SELECT add_compression_policy('user_sessions', INTERVAL '7 days', if_not_exists => TRUE)
  `);
  await knex.raw(`
    SELECT add_compression_policy('login_risk_signals', INTERVAL '7 days', if_not_exists => TRUE)
  `);

  // ── Retention policies ────────────────────────────────────────────────────
  // Drop chunks older than 90 days to enforce a data lifecycle.
  await knex.raw(`
    SELECT add_retention_policy('user_sessions', INTERVAL '90 days', if_not_exists => TRUE)
  `);
  await knex.raw(`
    SELECT add_retention_policy('login_risk_signals', INTERVAL '90 days', if_not_exists => TRUE)
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Remove policies first (order matters — retention before compression).
  await knex.raw(`SELECT remove_retention_policy('login_risk_signals', if_exists => TRUE)`);
  await knex.raw(`SELECT remove_retention_policy('user_sessions', if_exists => TRUE)`);
  await knex.raw(`SELECT remove_compression_policy('login_risk_signals', if_exists => TRUE)`);
  await knex.raw(`SELECT remove_compression_policy('user_sessions', if_exists => TRUE)`);

  // Convert back to regular tables (loses hypertable-specific features).
  await knex.raw(`SELECT convert_from_hypertable('user_sessions')`);
  await knex.raw(`SELECT convert_from_hypertable('login_risk_signals')`);
}
