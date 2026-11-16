import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

export const DEFAULT_WORKSPACE_ID = 'ws_default';

function migrationsDir() {
  if (process.env.CL_MIGRATIONS_DIR) return process.env.CL_MIGRATIONS_DIR;
  const here = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../migrations');
}

/**
 * Runs schema migrations as the owner role, then (re)applies grants for the application role:
 * the app can never UPDATE or DELETE rows of the append-only `event` table.
 */
export async function runMigrations(ownerUrl: string, appRole = process.env.CL_APP_ROLE ?? 'cl_app') {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: migrationsDir() });
    const [{ exists }] = await sql`select exists(select 1 from pg_roles where rolname = ${appRole}) as exists`;
    if (exists) {
      await sql.unsafe(`grant usage on schema public to ${appRole}`);
      await sql.unsafe(`grant select, insert, update, delete on all tables in schema public to ${appRole}`);
      await sql.unsafe(`grant usage, select on all sequences in schema public to ${appRole}`);
      await sql.unsafe(`revoke update, delete, truncate on table event from ${appRole}`);
    }
    await sql`insert into workspace (id, name) values (${DEFAULT_WORKSPACE_ID}, 'Workspace mặc định') on conflict (id) do nothing`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
