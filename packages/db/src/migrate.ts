import postgres from 'postgres';
import { runMigrations } from './migrate-fn';

const url = process.env.DATABASE_OWNER_URL ?? 'postgres://cl_owner:cl_owner_dev@127.0.0.1:5570/competence_lab';
runMigrations(url)
  .then(async () => {
    // Compose passes the app role's password so POSTGRES_APP_PASSWORD takes effect (initdb only sets the dev default).
    const pw = process.env.CL_APP_PASSWORD;
    if (pw) {
      const sql = postgres(url, { max: 1, onnotice: () => {} });
      await sql.unsafe(`alter role cl_app password '${pw.replace(/'/g, "''")}'`);
      await sql.end();
    }
    console.log('migrations applied');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
