# One image for web and worker (ROLE=web | worker, docker/start.sh); compose and Coolify pick the role.
# The worker needs the Claude CLI; the web simply does not use it.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages packages
RUN pnpm install --frozen-lockfile
COPY apps apps
RUN pnpm build

FROM build AS runner
ARG GIT_SHA=dev
# HOST: Next listens on every interface inside the container (the proxy in front decides what is public).
ENV NODE_ENV=production DATA_DIR=/data HOST=0.0.0.0 GIT_SHA=${GIT_SHA}
# curl: Coolify runs the health check inside the container.
# Claude Code CLI: the worker calls `claude -p`; it logs in with CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`).
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code && mkdir -p /data && chown -R node:node /data /app
# occupation lists (VSCO 2020, O*NET, crosswalk) read by B2
COPY --chown=node:node data/reference data/reference
COPY --chown=node:node --chmod=755 docker/start.sh docker/start.sh
USER node
EXPOSE 3100
CMD ["/app/docker/start.sh"]
