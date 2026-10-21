import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("contract_event_subscriptions", (table) => {
    table.string("id").primary();
    table.string("name").notNullable();
    table.text("description");
    table.string("contract_address").notNullable();
    table.string("network").notNullable().defaultTo("stellar-mainnet");
    table.specificType("event_topics", "text[]").notNullable().defaultTo("{}");
    table.jsonb("filter_rules").notNullable().defaultTo("{}");
    table.string("delivery_target").notNullable().defaultTo("webhook"); // webhook | websocket | queue | kafka | alert
    table.jsonb("delivery_config").notNullable().defaultTo("{}");
    table.string("status").notNullable().defaultTo("active"); // active | paused | disabled | errored
    table.integer("rate_limit_per_min").notNullable().defaultTo(60);
    table.integer("retry_limit").notNullable().defaultTo(3);
    table.integer("batch_size").notNullable().defaultTo(1);
    table.integer("delivered_count").notNullable().defaultTo(0);
    table.integer("failed_count").notNullable().defaultTo(0);
    table.timestamp("last_delivered_at").nullable();
    table.text("last_failure_reason").nullable();
    table.string("created_by").notNullable().defaultTo("system");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["contract_address"]);
    table.index(["network"]);
    table.index(["status"]);
    table.index(["created_at"]);
  });

  await knex.schema.createTable("contract_event_delivery_logs", (table) => {
    table.string("id").primary();
    table.string("subscription_id").notNullable();
    table.string("event_id").notNullable();
    table.string("contract_address").notNullable();
    table.string("topic").notNullable();
    table.jsonb("payload").notNullable().defaultTo("{}");
    table.string("delivery_status").notNullable(); // delivered | retrying | failed | filtered
    table.integer("status_code").nullable();
    table.integer("latency_ms").nullable();
    table.text("error_message").nullable();
    table.integer("attempt").notNullable().defaultTo(1);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["subscription_id"]);
    table.index(["delivery_status"]);
    table.index(["created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("contract_event_delivery_logs");
  await knex.schema.dropTableIfExists("contract_event_subscriptions");
}
