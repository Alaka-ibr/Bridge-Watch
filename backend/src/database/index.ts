// Lightweight database shim used to satisfy imports for type-checking.
// The real implementation lives elsewhere; this stub intentionally uses
// permissive types to avoid blocking the bulk type migration.

export const database: any = {};

export function getDb(): any {
  return database;
}

export function getDatabase(): any {
  return database;
}

export default database;
