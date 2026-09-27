import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("container_resource_metrics", (table) => {
    table.string("id").primary();
    table.string("container_id").notNullable();
    table.string("container_name").notNullable();
    table.string("service_name").notNullable();
    table.string("node_name").notNullable().defaultTo("node-1");
    table.integer("cpu_usage_millicores").notNullable().defaultTo(0);
    table.integer("cpu_limit_millicores").notNullable().defaultTo(1000);
    table.integer("cpu_throttled_time_ms").notNullable().defaultTo(0);
    table.bigInteger("memory_usage_bytes").notNullable().defaultTo(0);
    table.bigInteger("memory_limit_bytes").notNullable().defaultTo(1073741824); // 1 GiB default
    table.bigInteger("memory_rss_bytes").notNullable().defaultTo(0);
    table.bigInteger("network_rx_bytes_per_sec").notNullable().defaultTo(0);
    table.bigInteger("network_tx_bytes_per_sec").notNullable().defaultTo(0);
    table.bigInteger("disk_read_bytes_per_sec").notNullable().defaultTo(0);
    table.bigInteger("disk_write_bytes_per_sec").notNullable().defaultTo(0);
    table.string("status").notNullable().defaultTo("running"); // running | stopped | restarted | oom_killed
    table.integer("restart_count").notNullable().defaultTo(0);
    table.timestamp("recorded_at").notNullable().defaultTo(knex.fn.now());

    table.index(["container_name"]);
    table.index(["service_name"]);
    table.index(["recorded_at"]);
  });

  await knex.schema.createTable("container_resource_alerts", (table) => {
    table.string("id").primary();
    table.string("container_id").notNullable();
    table.string("container_name").notNullable();
    table.string("alert_type").notNullable(); // cpu_throttle | memory_near_oom | frequent_restarts | disk_saturation
    table.string("severity").notNullable().defaultTo("warning"); // info | warning | critical
    table.text("message").notNullable();
    table.boolean("resolved").notNullable().defaultTo(false);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("resolved_at").nullable();

    table.index(["container_id"]);
    table.index(["severity"]);
    table.index(["resolved"]);
    table.index(["created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("container_resource_alerts");
  await knex.schema.dropTableIfExists("container_resource_metrics");
}
