import { runMigrations } from './migrate-fn';

const url = process.env.DATABASE_OWNER_URL ?? 'postgres://cl_owner:cl_owner_dev@127.0.0.1:5570/competence_lab';
runMigrations(url)
  .then(() => {
    console.log('migrations applied');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
