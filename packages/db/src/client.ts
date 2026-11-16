import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

const cache = new Map<string, { db: Db; sql: postgres.Sql }>();

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? 'postgres://cl_app:cl_app_dev@127.0.0.1:5570/competence_lab';
}

/** One pooled connection per URL per process (survives Next.js dev reloads via globalThis). */
export function getDb(url = databaseUrl()): Db {
  const g = globalThis as unknown as { __clDb?: typeof cache };
  const store = (g.__clDb ??= cache);
  let hit = store.get(url);
  if (!hit) {
    const sql = postgres(url, { max: 10, onnotice: () => {} });
    hit = { db: drizzle(sql, { schema }), sql };
    store.set(url, hit);
  }
  return hit.db;
}

export async function closeDb(url = databaseUrl()) {
  const g = globalThis as unknown as { __clDb?: typeof cache };
  const hit = (g.__clDb ?? cache).get(url);
  if (hit) {
    await hit.sql.end({ timeout: 5 });
    (g.__clDb ?? cache).delete(url);
  }
}

export { schema };
