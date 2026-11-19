import postgres from 'postgres';
import { runMigrations } from './migrate-fn';

/**
 * Migration entry (`pnpm db:migrate`, `node migrate.mjs` in the web image). Runs as the owner role (DATABASE_OWNER_URL).
 * Before the migrations it prepares what a fresh database needs, so a managed Postgres (Coolify) needs no manual SQL:
 *  - the extensions `vector` and `pg_trgm` (needs a superuser or a role allowed to create them; skipped with a warning
 *    when not allowed, e.g. a local database where initdb.sql already created them);
 *  - the least-privileged role `cl_app` used by web and worker, created with CL_APP_PASSWORD when missing, or given that
 *    password when it exists. runMigrations then grants it the table rights.
 */
const url = process.env.DATABASE_OWNER_URL ?? 'postgres://cl_owner:cl_owner_dev@127.0.0.1:5570/competence_lab';
const appRole = process.env.CL_APP_ROLE ?? 'cl_app';

async function prepare() {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const ext of ['vector', 'pg_trgm']) {
      try {
        await sql.unsafe(`create extension if not exists ${ext}`);
      } catch (e) {
        console.warn(`migrate: extension ${ext} not created (${(e as Error).message})`);
      }
    }
    const pw = process.env.CL_APP_PASSWORD;
    if (pw) {
      const quoted = pw.replace(/'/g, "''");
      const [{ exists }] = await sql`select exists(select 1 from pg_roles where rolname = ${appRole}) as exists`;
      await sql.unsafe(exists ? `alter role ${appRole} login password '${quoted}'` : `create role ${appRole} login password '${quoted}'`);
      if (!exists) console.log(`migrate: role ${appRole} created`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

prepare()
  .then(() => runMigrations(url, appRole))
  .then(() => {
    console.log('migrations applied');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
