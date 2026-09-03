import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(here, "check-boundaries.mjs");
const require = createRequire(import.meta.url);

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function run(root) {
  return spawnSync(process.execPath, [checker, "--root", root, "--json"], {
    encoding: "utf8",
  });
}

function makeRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "architecture-boundaries-"));
}

test("P0-002 allows imports inside the same frontend product", () => {
  const root = makeRepo();

  write(
    root,
    "apps/platform-web/src/products/shadow/features/a.ts",
    `import { x } from "../shared/x"; export const value = x;`,
  );
  write(root, "apps/platform-web/src/products/shadow/shared/x.ts", `export const x = 1;`);

  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("P0-002 rejects SHADOW importing ECHO internals", () => {
  const root = makeRepo();

  write(
    root,
    "apps/platform-web/src/products/shadow/features/a.ts",
    `import { x } from "../../echo/internal/x"; export const value = x;`,
  );
  write(root, "apps/platform-web/src/products/echo/internal/x.ts", `export const x = 1;`);

  const result = run(root);
  assert.equal(result.status, 1);

  const output = JSON.parse(result.stdout);
  assert.equal(output.violations[0].rule, "frontend-product-isolation");
});

test("P0-003 allows cross-module import via target module public index", () => {
  const root = makeRepo();

  write(
    root,
    "apps/platform-api/src/modules/resolution/application/use-case.ts",
    `import { EntityRegistryFacade } from "../../entity-registry"; export const use = EntityRegistryFacade;`,
  );
  write(
    root,
    "apps/platform-api/src/modules/entity-registry/index.ts",
    `export class EntityRegistryFacade {}`,
  );

  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("P0-003 rejects another backend module's infrastructure import", () => {
  const root = makeRepo();

  write(
    root,
    "apps/platform-api/src/modules/resolution/application/use-case.ts",
    `import { repo } from "../../entity-registry/infrastructure/persistence/repo"; export const use = repo;`,
  );
  write(
    root,
    "apps/platform-api/src/modules/entity-registry/infrastructure/persistence/repo.ts",
    `export const repo = {};`,
  );

  const result = run(root);
  assert.equal(result.status, 1);

  const output = JSON.parse(result.stdout);
  assert.equal(output.violations[0].rule, "backend-module-public-boundary");
});

test("P0-003 allows a backend module to import its own internals", () => {
  const root = makeRepo();

  write(
    root,
    "apps/platform-api/src/modules/entity-registry/application/use-case.ts",
    `import { port } from "../domain/port"; export const use = port;`,
  );
  write(
    root,
    "apps/platform-api/src/modules/entity-registry/domain/port.ts",
    `export const port = {};`,
  );

  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("dependency graph excludes generated build artifacts", () => {
  const configuration = require(path.join(here, "../..", ".dependency-cruiser.cjs"));
  const excluded = new RegExp(configuration.options.exclude);

  assert.equal(excluded.test("apps/platform-web/.next/server/chunks/app.js"), true);
  assert.equal(excluded.test("apps/platform-api/dist/main.js"), true);
  assert.equal(excluded.test("apps/platform-api/src/main.ts"), false);
});
