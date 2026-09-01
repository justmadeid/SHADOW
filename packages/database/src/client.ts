import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { PlatformDatabase } from "./types.js";

export type DatabaseClientOptions = {
  databaseUrl: string;
  applicationName?: string;
  maxPoolSize?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
};

export type DatabaseClient = {
  pool: Pool;
  db: PlatformDatabase;
};

export function createDatabaseClient(options: DatabaseClientOptions): DatabaseClient {
  const pool = new Pool({
    connectionString: options.databaseUrl,
    application_name: options.applicationName ?? "intelligence-platform-api",
    max: options.maxPoolSize ?? 20,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
  });

  const db = drizzle(pool);

  return { pool, db };
}
