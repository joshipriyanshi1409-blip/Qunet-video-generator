# CreatorDNA Studio - API (REST + WebSocket).
#
# Multi-stage so the runtime image carries no compiler, no dev dependencies and
# no source. The build stage needs the whole monorepo because the workspace
# packages are consumed from their built `dist`, not from source.
#
# Build from the repository root, not from this directory:
#   docker build -f apps/api/Dockerfile -t creatordna-api .
#
# The `.dockerignore` at the repository root matters here: `pnpm deploy` copies
# the package directory, and that includes a stray `.env`. Without the ignore
# rule, a developer's local credentials end up baked into the production image.

# --- build ------------------------------------------------------------------
FROM node:20-slim AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /repo

# Manifests first, so a source edit does not invalidate `pnpm install`.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/prompts/package.json packages/prompts/
COPY packages/render/package.json packages/render/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --ignore-scripts

# Sources, then build in dependency order. `--topological` is what guarantees
# shared and prompts exist before the apps try to import their `dist`.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/prompts packages/prompts
COPY packages/render packages/render
COPY apps/api apps/api
RUN pnpm --filter @creatordna/shared \
      --filter @creatordna/prompts \
      --filter @creatordna/render \
      --filter @creatordna/api \
      build

# A self-contained production bundle: the API's `dist` plus its runtime
# dependencies, including the workspace packages' own `dist`. `--legacy` is
# required on pnpm 10 unless the workspace opts into injected dependencies.
# Verified against this repository: the output boots in production mode.
RUN pnpm --filter @creatordna/api deploy --legacy --prod /prod

# --- runtime ----------------------------------------------------------------
FROM node:20-slim AS runtime

# dumb-init reaps zombies and forwards SIGTERM. Without it a container told to
# stop can hang until the platform SIGKILLs it, which is exactly the
# graceful-shutdown path this app implements.
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# Cloud Run injects PORT. The default is for a local `docker run`.
ENV PORT=4000
ENV HOST=0.0.0.0

WORKDIR /app

COPY --from=build /prod ./

# Never run as root: a compromised process should not own the filesystem.
USER node

EXPOSE 4000

# Cloud Run's HTTP health check hits this. It is unauthenticated by design and
# reports real dependency state, so a broken instance is drained rather than
# sent traffic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
