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

# Runtime images: the slow-changing layers (system packages, the Claude CLI) come first so they keep the same digest
# from build to build; a deploy then pulls only the small app layers (a 355 MB layer re-pulled on every deploy was
# reset mid-transfer from GHCR, 19/11/2026).
FROM node:22-bookworm-slim AS web
# curl: Coolify runs the health check inside the container
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --chown=node:node packages/db/migrations ./migrations
# occupation lists (VSCO 2020, O*NET, crosswalk) read by B2; found from the working directory upward
COPY --chown=node:node data/reference data/reference
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /app/dist/worker/migrate.mjs ./migrate.mjs
COPY --chown=node:node --chmod=755 docker/start.sh docker/start.sh
ARG GIT_SHA=dev
ENV NODE_ENV=production DATA_DIR=/data NEXT_TELEMETRY_DISABLED=1 GIT_SHA=${GIT_SHA} ROLE=web PORT=3100 CL_MIGRATIONS_DIR=/app/migrations
USER node
EXPOSE 3100
CMD ["/app/docker/start.sh"]

FROM node:22-bookworm-slim AS worker
# Claude Code CLI, pinned (one native binary, ≈ 355 MB): the worker calls `claude -p`, logged in with
# CLAUDE_CODE_OAUTH_TOKEN. ca-certificates: the CLI uses the system trust store. Bump CLAUDE_CODE_VERSION on purpose.
ARG CLAUDE_CODE_VERSION=2.1.328
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --chown=node:node data/reference data/reference
COPY --from=build --chown=node:node /app/dist/worker/main.mjs ./main.mjs
COPY --chown=node:node --chmod=755 docker/start.sh docker/start.sh
ARG GIT_SHA=dev
ENV NODE_ENV=production DATA_DIR=/data GIT_SHA=${GIT_SHA} ROLE=worker
USER node
CMD ["/app/docker/start.sh"]
