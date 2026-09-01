import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import {
  createDatabaseClient,
  DatabaseContext,
  DrizzleTransactionManager,
} from "@intelligence/database";
import { startPostgresTestContainer } from "@intelligence/testing";
import { RequestContextStore } from "../../../../request-context/index.js";
import { PostgresOutboxStore } from "./postgres-outbox.store.js";

describe("PostgresOutboxStore", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let database: DatabaseContext;
  let transactions: DrizzleTransactionManager;
  let store: PostgresOutboxStore;

  beforeAll(async () => {
    started = await startPostgresTestContainer();

    client = createDatabaseClient({
      databaseUrl: started.databaseUrl,
      maxPoolSize: 5,
    });

    database = new DatabaseContext(client.db);
    transactions = new DrizzleTransactionManager(client.db);

    const migration = `
      CREATE TABLE platform_outbox_events (
        id uuid PRIMARY KEY,
        event_type text NOT NULL,
        event_version integer NOT NULL,
        aggregate_type text,
        aggregate_id text,
        payload jsonb NOT NULL,
        request_id text,
        trace_parent text,
        occurred_at timestamptz NOT NULL,
        available_at timestamptz NOT NULL,
        attempt_count integer NOT NULL DEFAULT 0,
        lease_owner text,
        leased_until timestamptz,
        published_at timestamptz,
        last_error_code text,
        last_error_at timestamptz,
        created_at timestamptz NOT NULL
      );
    `;

    await client.db.execute(sql.raw(migration));

    store = new PostgresOutboxStore(database, new RequestContextStore());
  });

  afterAll(async () => {
    await client?.pool.end();
    await started?.container.stop();
  });

  it("rolls back the outbox row with the surrounding transaction", async () => {
    await expect(
      transactions.run(async () => {
        await store.enqueue({
          type: "TEST_ROLLBACK",
          version: 1,
          payload: {
            resourceId: "resource-1",
          },
        });

        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    const rows = await client.db.execute(sql`
      SELECT count(*)::int AS count
      FROM platform_outbox_events
      WHERE event_type = 'TEST_ROLLBACK'
    `);

    expect(Number(rows.rows[0]?.count)).toBe(0);
  });

  it("claims the committed event once for an active lease", async () => {
    await transactions.run(async () => {
      await store.enqueue({
        type: "TEST_COMMIT",
        version: 1,
        payload: {
          resourceId: "resource-2",
        },
      });
    });

    const first = await store.claim({
      leaseOwner: "dispatcher-a",
      batchSize: 10,
      leaseDurationMs: 30_000,
    });

    const second = await store.claim({
      leaseOwner: "dispatcher-b",
      batchSize: 10,
      leaseDurationMs: 30_000,
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});
