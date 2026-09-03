import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const root = process.cwd();
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

function walk(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, result);
    else if (
      entry.isFile() &&
      entry.name.endsWith(".sql") &&
      full.includes(`${path.sep}migrations${path.sep}`)
    ) {
      result.push(full);
    }
  }
  return result;
}

// Cross-module foreign keys require a stable dependency order on a fresh database.
// Paths within one owner remain lexically ordered so numbered migrations retain order.
const ownerOrder = [
  "/platform/events/outbox/",
  "/modules/workspace/",
  "/modules/case/",
  "/modules/investigation/",
];

const migrations = walk(path.join(root, "apps")).sort((left, right) => {
  const leftPath = left.split(path.sep).join("/");
  const rightPath = right.split(path.sep).join("/");
  const leftOwner = ownerOrder.findIndex((owner) => leftPath.includes(owner));
  const rightOwner = ownerOrder.findIndex((owner) => rightPath.includes(owner));
  const leftRank = leftOwner === -1 ? ownerOrder.length : leftOwner;
  const rightRank = rightOwner === -1 ? ownerOrder.length : rightOwner;
  return leftRank - rightRank || leftPath.localeCompare(rightPath);
});
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_schema_migrations (
      path text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const file of migrations) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const sql = fs.readFileSync(file, "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");

    const existing = await pool.query(
      "SELECT checksum FROM platform_schema_migrations WHERE path = $1",
      [rel],
    );

    if (existing.rowCount === 1) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Applied migration checksum changed: ${rel}`);
      }
      console.log(`skip ${rel}`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO platform_schema_migrations(path, checksum) VALUES ($1, $2)",
        [rel, checksum],
      );
      await client.query("COMMIT");
      console.log(`applied ${rel}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
