# Hydra publish API, one container. Build from the repo root:
#   docker build -f apps/api/deploy/Dockerfile -t hydra-api .
# Keeps the pnpm workspace layout: apps/api imports @hydra/core and serves
# packages/action/publish.mjs by relative path, and runs packages/indexer on POST /v1/indexer/run. No build step (Node 24 type stripping).
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Manifests first so the install layer caches across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
COPY packages/indexer/package.json packages/indexer/
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable \
 && pnpm install --prod --frozen-lockfile --filter @hydra/api... \
 && pnpm store prune

COPY packages/core/src packages/core/src
COPY packages/action packages/action
COPY packages/indexer/src packages/indexer/src
COPY packages/indexer/targets.json packages/indexer/
COPY apps/api/src apps/api/src

USER node
WORKDIR /app/apps/api
EXPOSE 8787
CMD ["node", "src/main.ts"]
