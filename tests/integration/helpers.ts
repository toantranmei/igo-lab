import path from 'node:path';
import postgres from 'postgres';
import { closeDb, getDb, runMigrations, DEFAULT_WORKSPACE_ID, type Db } from '@cl/db';

export const OWNER_URL = process.env.TEST_DATABASE_OWNER_URL ?? 'postgres://cl_owner:cl_owner_dev@127.0.0.1:5570/competence_lab_test';
export const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://cl_app:cl_app_dev@127.0.0.1:5570/competence_lab_test';
export const FAKE_CLAUDE = path.resolve(__dirname, '../fake-claude/claude.mjs');
export const WS = DEFAULT_WORKSPACE_ID;

/** Fresh schema state for a test file: migrate, then empty every table (as owner — the app role cannot touch `event`). */
export async function resetDb(): Promise<Db> {
  process.env.DATABASE_URL = APP_URL;
  await runMigrations(OWNER_URL);
  const sql = postgres(OWNER_URL, { max: 1, onnotice: () => {} });
  const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
  const names = tables.map((t) => `"${t.tablename}"`).join(', ');
  if (names) await sql.unsafe(`truncate ${names} restart identity cascade`);
  await sql`insert into workspace (id, name) values (${WS}, 'Workspace mặc định')`;
  await sql.end();
  return getDb(APP_URL);
}
export async function closeTestDb() {
  await closeDb(APP_URL);
}
