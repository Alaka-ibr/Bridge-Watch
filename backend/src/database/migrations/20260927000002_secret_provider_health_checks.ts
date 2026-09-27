import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("secret_providers", (table) => {
    table.string("id").primary();
    table.string("provider_type").notNullable(); // vault | aws_secrets_manager | gcp_secret_manager | azure_key_vault | kubernetes_secrets | environment
    table.string("name").notNullable();
    table.text("description");
    table.string("endpoint").notNullable();
    table.string("status").notNullable().defaultTo("unknown"); // healthy | degraded | unhealthy | unknown
    table.boolean("is_primary").notNullable().defaultTo(false);
    table.string("fallback_provider_id").nullable();
    table.integer("token_ttl_seconds").nullable();
    table.integer("consecutive_failures").notNullable().defaultTo(0);
    table.integer("last_latency_ms").nullable();
    table.text("last_error").nullable();
    table.timestamp("tls_expiry_date").nullable();
    table.timestamp("last_checked_at").nullable();
    table.jsonb("config").notNullable().defaultTo("{}"); // Redacted / safe configuration parameters
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["provider_type"]);
    table.index(["status"]);
    table.index(["is_primary"]);
  });

  await knex.schema.createTable("secret_provider_health_logs", (table) => {
    table.string("id").primary();
    table.string("provider_id").notNullable();
    table.string("status").notNullable();
    table.integer("latency_ms").notNullable();
    table.string("error_code").nullable();
    table.text("error_message").nullable();
    table.jsonb("checks").notNullable().defaultTo("{}"); // detailed check items (ping, auth, read_permission, tls)
    table.timestamp("timestamp").notNullable().defaultTo(knex.fn.now());

    table.index(["provider_id"]);
    table.index(["status"]);
    table.index(["timestamp"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("secret_provider_health_logs");
  await knex.schema.dropTableIfExists("secret_providers");
}
