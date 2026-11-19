# Two images from one build (docs/DEPLOY.md):
#   --target web     Next standalone server (+ migration runner); no node_modules tree, no pnpm, no Claude CLI
#   --target worker  esbuild bundle of the worker (+ Claude CLI, the only process that calls it)
# Build tools, dev dependencies and the pnpm store stay in the `build` stage and never reach a runtime image.

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY apps apps
COPY scripts/build-worker.mjs scripts/
# web: .next/standalone (traced server files only); worker + migrations: single-file ESM bundles in dist/worker
RUN pnpm build && node scripts/build-worker.mjs

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production DATA_DIR=/data NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
# occupation lists (VSCO 2020, O*NET, crosswalk) read by B2; found from the working directory upward
COPY --chown=node:node data/reference data/reference
COPY --chown=node:node --chmod=755 docker/start.sh docker/start.sh

FROM runtime AS web
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA} ROLE=web PORT=3100 CL_MIGRATIONS_DIR=/app/migrations
# curl: Coolify runs the health check inside the container
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /app/dist/worker/migrate.mjs ./migrate.mjs
COPY --chown=node:node packages/db/migrations ./migrations
USER node
EXPOSE 3100
CMD ["/app/docker/start.sh"]

FROM runtime AS worker
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA} ROLE=worker
# Claude Code CLI (one native binary, ≈ 355 MB): the worker calls `claude -p`, logged in with CLAUDE_CODE_OAUTH_TOKEN.
# ca-certificates: the CLI uses the system trust store for its HTTPS calls.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code && npm cache clean --force
COPY --from=build --chown=node:node /app/dist/worker/main.mjs ./main.mjs
USER node
CMD ["/app/docker/start.sh"]
