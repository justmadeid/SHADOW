import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";

import { startPostgresTestContainer } from "@intelligence/testing";
import { HealthService } from "./health.service.js";

describe("HealthService", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    const started = await startPostgresTestContainer();
    container = started.container;
    pool = new Pool({ connectionString: started.databaseUrl });
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it("reports canonical PostgreSQL readiness", async () => {
    const service = new HealthService(pool);

    await expect(service.readiness()).resolves.toMatchObject({
      status: "ready",
      checks: {
        postgres: "up",
      },
    });
  });
});
