import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startPostgresTestContainer } from "@intelligence/testing";

describe("database migrations", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let fixtureRoot: string;
  let migrationPath: string;

  beforeAll(async () => {
    started = await startPostgresTestContainer();
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "migration-checksum-"));
    migrationPath = path.join(
      fixtureRoot,
      "apps/platform-api/src/platform/test/migrations/0001_fixture.sql",
    );
    fs.mkdirSync(path.dirname(migrationPath), { recursive: true });
    fs.writeFileSync(
      migrationPath,
      "CREATE TABLE checksum_fixture (id uuid PRIMARY KEY);\n",
    );
  });

  afterAll(async () => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    await started.container.stop();
  });

  it("rejects a changed checksum for an applied migration", () => {
    const initial = runMigration();
    expect(initial.status, initial.stderr || initial.stdout).toBe(0);

    fs.appendFileSync(migrationPath, "-- changed after application\n");

    const changed = runMigration();
    expect(changed.status).not.toBe(0);
    expect(changed.stderr).toContain("Applied migration checksum changed");
  });

  it("applies repository migrations in dependency order", () => {
    const migrated = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "tooling/db/migrate.mjs")],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: started.databaseUrl },
        encoding: "utf8",
      },
    );

    expect(migrated.status, migrated.stderr || migrated.stdout).toBe(0);
    const workspace = migrated.stdout.indexOf("modules/workspace");
    const caseDomain = migrated.stdout.indexOf("modules/case");
    const investigation = migrated.stdout.indexOf("modules/investigation");
    const governance = migrated.stdout.indexOf("modules/governance");
    expect(workspace).toBeGreaterThanOrEqual(0);
    expect(caseDomain).toBeGreaterThan(workspace);
    expect(investigation).toBeGreaterThan(caseDomain);
    expect(governance).toBeGreaterThan(investigation);
  });

  function runMigration(): ReturnType<typeof spawnSync> {
    return spawnSync(
      process.execPath,
      [path.join(process.cwd(), "tooling/db/migrate.mjs")],
      {
        cwd: fixtureRoot,
        env: {
          ...process.env,
          DATABASE_URL: started.databaseUrl,
        },
        encoding: "utf8",
      },
    );
  }
});
