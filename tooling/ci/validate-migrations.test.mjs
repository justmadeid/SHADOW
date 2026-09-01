import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const validator = path.join(here, "validate-migrations.mjs");

function makeRepo(sql) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-validation-"));
  const dir = path.join(root, "apps/platform-api/src/platform/test/migrations");

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "0001.sql"), sql);

  return root;
}

test("allows additive migration", () => {
  const root = makeRepo("CREATE TABLE example (id uuid PRIMARY KEY);");

  const result = spawnSync(process.execPath, [validator], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("rejects destructive migration without ADR marker", () => {
  const root = makeRepo("DROP TABLE example;");

  const result = spawnSync(process.execPath, [validator], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
});

test("allows reviewed destructive migration with explicit ADR marker", () => {
  const root = makeRepo(`
    -- migration-safety: allow-destructive ADR-123
    DROP TABLE example;
  `);

  const result = spawnSync(process.execPath, [validator], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
