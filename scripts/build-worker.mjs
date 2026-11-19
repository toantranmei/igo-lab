/**
 * node scripts/build-worker.mjs → dist/worker/{main,migrate}.mjs
 *
 * Bundles the worker and the migration runner (TypeScript workspace packages and their npm dependencies) into single
 * ESM files, so the worker image needs no node_modules, no pnpm and no tsx at run time (docker/Dockerfile).
 */
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'warning',
  // CommonJS dependencies inside an ESM bundle still call require / __dirname
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
  },
};
await build({ ...common, entryPoints: { main: 'apps/worker/src/main.ts', migrate: 'packages/db/src/migrate.ts' }, outdir: 'dist/worker', outExtension: { '.js': '.mjs' } });
console.log('dist/worker/main.mjs, dist/worker/migrate.mjs');
