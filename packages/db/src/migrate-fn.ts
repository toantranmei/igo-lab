import path from 'node:path';
import { existsSync } from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

export const DEFAULT_WORKSPACE_ID = 'ws_default';

/** Finds packages/db/migrations by walking up from the working directory (works from the repo root, apps/* and Docker). */
function migrationsDir() {
  if (process.env.CL_MIGRATIONS_DIR) return process.env.CL_MIGRATIONS_DIR;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'packages/db/migrations');
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('Không tìm thấy packages/db/migrations; đặt CL_MIGRATIONS_DIR.');
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
