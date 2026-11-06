// Creates a fresh database that looks like a Supabase project and applies all migrations.
// Usage: node tests/db/setup-db.mjs <dbname>   (needs a local Postgres; see tests/README.md)
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? "postgresql://postgres:postgres@localhost:54329/postgres";

export async function createTestDb(name) {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(readFileSync(join(root, "tests/db/supabase-stub.sql"), "utf8"));
  const dir = join(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    try {
      await c.query(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new Error(`${f}: ${e.message}${e.position ? ` (pos ${e.position})` : ""}${e.where ? `\n${e.where}` : ""}`);
    }
  }
  await c.end();
  return url;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = await createTestDb(process.argv[2] ?? "sarees_dev");
  console.log(url);
}
