#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const migrationRoots = [
  path.join(root, "apps", "platform-api", "src"),
  path.join(root, "packages"),
];

const destructivePatterns = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+TABLE\b[\s\S]*?\bDROP\b/i,
  /\bDROP\s+SCHEMA\b/i,
];

const approvalPattern = /--\s*migration-safety:\s*allow-destructive\s+ADR-\d+/i;

const files = [];

for (const migrationRoot of migrationRoots) {
  walk(migrationRoot, files);
}

const sqlFiles = files.filter((file) => file.endsWith(".sql"));
const violations = [];

for (const file of sqlFiles) {
  const sql = fs.readFileSync(file, "utf8");

  const dangerous = destructivePatterns.some((pattern) => pattern.test(sql));

  if (dangerous && !approvalPattern.test(sql)) {
    violations.push(
      `${path.relative(root, file)} contains destructive DDL without ` +
        "`-- migration-safety: allow-destructive ADR-<number>`",
    );
  }
}

if (violations.length > 0) {
  console.error("Migration safety violations:\n");

  for (const violation of violations) {
    console.error(`- ${violation}`);
  }

  process.exitCode = 1;
} else {
  console.log(
    `Migration safety validation passed (${sqlFiles.length} SQL migration(s)).`,
  );
}

function walk(dir, output) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".next" ||
      entry.name === ".turbo"
    ) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full, output);
    } else if (entry.isFile()) {
      output.push(full);
    }
  }
}
