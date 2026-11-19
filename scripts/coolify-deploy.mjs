#!/usr/bin/env node
/**
 * Deploys igo-lab on Coolify v4 (docs/DEPLOY.md). Token abilities: read + deploy.
 *
 *   COOLIFY_URL=https://coolify.example.com COOLIFY_TOKEN=… PRODUCTION_URL=https://igo-lab.toantranmei.com \
 *   PRODUCTION_BASIC_AUTH=user:pass GITHUB_SHA=<sha> node scripts/coolify-deploy.mjs [--dry-run]
 *
 * Applications carrying the Coolify tag `igo-lab` (COOLIFY_TAG) and pulling ghcr.io/toantranmei/igo-lab are deployed in
 * order: the web first (ROLE=web applies migrations on start), waited for until its Coolify deployment finishes and
 * PRODUCTION_URL/api/health reports GITHUB_SHA; then the worker. A failed or stuck step stops the run, so a worker is
 * never newer than the schema.
 */
const URL_ = (process.env.COOLIFY_URL ?? '').replace(/\/+$/, '');
const TOKEN = process.env.COOLIFY_TOKEN ?? '';
const TAG = process.env.COOLIFY_TAG ?? 'igo-lab';
const IMAGE = 'ghcr.io/toantranmei/igo-lab';
const SHA = process.env.GITHUB_SHA ?? '';
const PROD = (process.env.PRODUCTION_URL ?? '').replace(/\/+$/, '');
const BASIC = process.env.PRODUCTION_BASIC_AUTH ?? '';
const DRY = process.argv.includes('--dry-run');
const TIMEOUT_MS = Number(process.env.DEPLOY_TIMEOUT_S ?? 900) * 1000;

const die = (title, msg) => {
  console.log(`::error title=${title}::${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function coolify(method, path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${URL_}/api/v1${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json' } });
      const body = await r.text();
      if (!r.ok) die('Coolify API error', `${method} ${path} answered ${r.status}: ${body.slice(0, 300)}`);
      return body ? JSON.parse(body) : null;
    } catch (e) {
      if (attempt >= 3) die('Coolify unreachable', `${method} ${path}: ${e.message}`);
      await sleep(attempt * 5000);
    }
  }
}

if (!URL_ || !TOKEN) die('Missing configuration', 'COOLIFY_URL and COOLIFY_TOKEN are required');
const apps = (await coolify('GET', `/applications?tag=${encodeURIComponent(TAG)}`)) ?? [];
const ours = apps.filter((a) => String(a.docker_registry_image_name ?? '').toLowerCase().replace(/:.*$/, '') === IMAGE);
const roleOf = (a) => (/worker/i.test(a.name ?? '') ? 'worker' : 'web');
const web = ours.filter((a) => roleOf(a) === 'web');
const worker = ours.filter((a) => roleOf(a) === 'worker');
console.log(`apps with tag ${TAG}: ${ours.map((a) => `${a.name} (${roleOf(a)}, tag ${a.docker_registry_image_tag ?? '-'})`).join(', ') || 'none'}`);
if (!ours.length) {
  console.log(`::notice title=Nothing to deploy::no Coolify application tagged ${TAG} pulls ${IMAGE}`);
  process.exit(0);
}
if (web.length !== 1) die('Web app', `expected exactly one web app (name without "worker"), found ${web.length}`);
for (const a of ours) if ((a.docker_registry_image_tag ?? 'main') !== 'main') die('Pinned image tag', `${a.name} pulls tag ${a.docker_registry_image_tag}; set it back to main`);
if (DRY) {
  console.log(`dry run: would deploy ${web[0].name}, then ${worker.map((a) => a.name).join(', ') || '(no worker)'}`);
  process.exit(0);
}

async function deploy(app) {
  const r = await coolify('POST', `/deploy?uuid=${app.uuid}`);
  const dep = r?.deployments?.[0]?.deployment_uuid;
  if (!dep) die(`${app.name} not queued`, JSON.stringify(r).slice(0, 300));
  const t0 = Date.now();
  let last = '';
  for (;;) {
    const d = await coolify('GET', `/deployments/${dep}`);
    if (d.status !== last) console.log(`${app.name}: ${d.status}`);
    last = d.status;
    if (d.status === 'finished') return;
    if (d.status === 'failed' || d.status === 'cancelled-by-user') die(`${app.name} deploy ${d.status}`, `see Coolify → ${app.name} → Deployments`);
    if (Date.now() - t0 > TIMEOUT_MS) die(`${app.name} deploy timed out`, `still ${d.status}`);
    await sleep(10000);
  }
}
async function waitVersion() {
  if (!PROD || !SHA) return console.log('version check skipped (PRODUCTION_URL or GITHUB_SHA not set)');
  const headers = BASIC ? { authorization: `Basic ${Buffer.from(BASIC).toString('base64')}` } : {};
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${PROD}/api/health`, { headers });
      if (r.status === 401) return console.log('::warning title=Version not checked::/api/health answered 401: set the PRODUCTION_BASIC_AUTH secret');
      const j = await r.json().catch(() => null);
      if (j?.ok && j.version === SHA) return console.log(`web serves ${SHA}`);
    } catch {
      /* the new container is starting */
    }
    if (Date.now() - t0 > TIMEOUT_MS) die('Version check timed out', `${PROD}/api/health does not report ${SHA}`);
    await sleep(10000);
  }
}

await deploy(web[0]);
await waitVersion();
for (const w of worker) await deploy(w);
console.log('deploy done');
