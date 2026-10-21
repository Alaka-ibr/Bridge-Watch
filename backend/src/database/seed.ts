/**
 * Database seed CLI
 *
 * Usage (run from the backend/ directory):
 *
 *   npm run seed                       Run all seed files
 *   npm run seed:specific -- <file>    Run one seed file by name
 *
 * Environment behaviour:
 *   NODE_ENV=production  — prints a warning and requires the --force flag to
 *                          prevent accidental data seeding in production.
 *   NODE_ENV=test        — silences the interactive warning; seeds run normally.
 *
 * Seed file resolution:
 *   All seed files live in src/database/seeds/.
 *   When a specific file is supplied the .ts extension is optional.
 *
 * Examples:
 *   npm run seed
 *   npm run seed:specific -- 01_assets_and_bridges
 *   npm run seed:specific -- 01_assets_and_bridges.ts
 *   NODE_ENV=production npm run seed -- --force
 */

import { getDatabase } from "./connection.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

const env = config.NODE_ENV ?? "development";

function isForced(): boolean {
  return process.argv.includes("--force");
}

function guardProduction(): void {
  if (env !== "production") return;

  if (!isForced()) {
    logger.error(
      "Seeding is disabled in production. " +
        "Pass --force to override: NODE_ENV=production npm run seed -- --force"
    );
    process.exit(1);
  }

  logger.warn(
    "⚠  Running seeds against a PRODUCTION database (--force flag detected). " +
      "Ensure this is intentional."
  );
}

async function runAll(): Promise<void> {
  guardProduction();

  const db = getDatabase();
  try {
    logger.info(`Running all seed files [env: ${env}]…`);
    await db.seed.run();
    logger.info("All seeds completed successfully.");
  } catch (error) {
    logger.error({ error }, "Seeding failed.");
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

async function runSpecific(file: string): Promise<void> {
  guardProduction();

  // Normalise: ensure the filename ends with .ts (or .js for compiled output)
  const normalised = file.endsWith(".ts") || file.endsWith(".js") ? file : `${file}.ts`;

  const db = getDatabase();
  try {
    logger.info(`Running seed file: ${normalised} [env: ${env}]…`);
    await db.seed.run({ specific: normalised });
    logger.info(`Seed "${normalised}" completed successfully.`);
  } catch (error) {
    logger.error({ error }, `Seed "${normalised}" failed.`);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
// process.argv: [node, script, command?, ...args]
const [, , subcommand, ...rest] = process.argv;

// Filter out the --force flag from the positional args
const positional = rest.filter((a) => a !== "--force");

if (subcommand === "run" && positional.length > 0) {
  // npm run seed:specific -- <file>
  runSpecific(positional[0]);
} else {
  // npm run seed  OR  npm run seed -- --force
  runAll();
}
