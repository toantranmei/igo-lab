# One image for web, worker and migrate (compose picks the command).
# The worker needs the Claude CLI; web and migrate simply do not use it.
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
ENV NODE_ENV=production DATA_DIR=/data
# Claude Code CLI: the worker calls `claude -p`; it logs in with CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`).
RUN npm install -g @anthropic-ai/claude-code && mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3100
CMD ["pnpm", "start"]
