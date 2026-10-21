#!/usr/bin/env ts-node
/**
 * validate-migration-names.ts
 *
 * Checks that every file in backend/src/database/migrations/ conforms to one
 * of the two accepted naming conventions:
 *
 *   Sequential:  NNN_snake_case_description.ts   (e.g. 001_initial_schema.ts)
 *   Timestamp:   YYYYMMDD[HHMMSS]_snake_case.ts  (e.g. 20260828120000_feature.ts)
 *
 * Files that match neither pattern are printed to stderr and the process exits
 * with code 1, failing CI.  Backup files (.bak, .sql) are skipped.
 *
 * Usage:
 *   npx ts-node scripts/validate-migration-names.ts
 *   node --loader ts-node/esm scripts/validate-migration-names.ts
 */

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const MIGRATIONS_DIR = resolve(
  new URL(".", import.meta.url).pathname,
  "../backend/src/database/migrations"
);

// NNN_snake_case.ts  — one or more leading digits, underscore, snake_case body
const SEQUENTIAL_RE = /^\d+_[a-z][a-z0-9_]*\.ts$/;

// YYYYMMDD_snake_case.ts  or  YYYYMMDDHHMMSS_snake_case.ts
const TIMESTAMP_RE = /^\d{8}(\d{6})?_[a-z][a-z0-9_]*\.ts$/;

const SKIP_EXTENSIONS = new Set([".bak", ".sql"]);

function validate(): void {
  let entries: string[];
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    console.error(`[validate-migration-names] Cannot read migrations dir: ${MIGRATIONS_DIR}`);
    console.error(err);
    process.exit(2);
  }

  const violations: string[] = [];

  for (const entry of entries) {
    // Skip non-TypeScript files (backups, SQL patches, etc.)
    const ext = entry.slice(entry.lastIndexOf("."));
    if (SKIP_EXTENSIONS.has(ext)) continue;
    if (!entry.endsWith(".ts")) {
      violations.push(`${entry}  ← not a .ts file`);
      continue;
    }

    if (!SEQUENTIAL_RE.test(entry) && !TIMESTAMP_RE.test(entry)) {
      violations.push(entry);
    }
  }

  if (violations.length === 0) {
    console.log(
      `[validate-migration-names] All ${entries.length} migration files conform to the naming convention.`
    );
    process.exit(0);
  }

  console.error(
    `[validate-migration-names] ${violations.length} migration file(s) do not match the expected naming convention.`
  );
  console.error("Expected patterns:");
  console.error("  Sequential : NNN_snake_case_description.ts  (e.g. 001_initial_schema.ts)");
  console.error("  Timestamp  : YYYYMMDD[HHMMSS]_snake_case.ts (e.g. 20260828_feature.ts)");
  console.error("\nViolations:");
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

validate();
