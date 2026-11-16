import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { runMigrations } from '../../packages/db/src/migrate-fn';

const OWNER = 'postgres://cl_owner:cl_owner_dev@127.0.0.1:5570/competence_lab_test';
export const DATA_DIR = path.resolve(__dirname, '../../.e2e-data');

export async function resetDatabase() {
  await runMigrations(OWNER);
  const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
  const tables = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public' and tablename <> 'worker_status'`;
  await sql.unsafe(`truncate ${tables.map((t) => `"${t.tablename}"`).join(', ')} restart identity cascade`);
  await sql`insert into workspace (id, name) values ('ws_default', 'Workspace mặc định')`;
  await sql.end();
}
export default async function globalSetup() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  await resetDatabase();
}
