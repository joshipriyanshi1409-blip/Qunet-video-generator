# CreatorDNA Studio - worker (BullMQ + the render pipeline).
#
# This is the only image that needs media tools. The API never renders: heavy
# work runs here, so the encoder and the headless browser live here and nowhere
# else. Keeping them out of the API image is what lets the API stay small and
# scale on request latency rather than on CPU.
#
# Build from the repository root:
#   docker build -f apps/worker/Dockerfile -t creatordna-worker .

# --- build ------------------------------------------------------------------
FROM node:20-slim AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/prompts/package.json packages/prompts/
COPY packages/render/package.json packages/render/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/prompts packages/prompts
COPY packages/render packages/render
COPY apps/worker apps/worker
RUN pnpm --filter @creatordna/shared \
      --filter @creatordna/prompts \
      --filter @creatordna/render \
      --filter @creatordna/worker \
      build

RUN pnpm --filter @creatordna/worker deploy --legacy --prod /prod

# --- runtime ----------------------------------------------------------------
FROM node:20-slim AS runtime

# ffmpeg: the encoder behind `RENDER_COMPOSER=ffmpeg`. Installed from Debian
# rather than an npm wrapper so the binary is the distro's, patched with the
# rest of the image, and on PATH with no `FFMPEG_PATH` to set.
#
# chromium: not used by the pipeline today - `packages/render` composes with
# ffmpeg, and Remotion (the intended production composer) is what will need it.
# It is installed now so enabling Remotion is a config change, not a rebuild.
#
# fonts-liberation: without a font, drawtext/filter-based text renders as boxes,
# and a caption track with no glyphs is a bug that looks like a codec problem.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      dumb-init \
      ffmpeg \
      chromium \
      fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Chromium refuses to run as root without this, and this image does run as a
# non-root user below.
ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1

ENV NODE_ENV=production
# The worker is a queue consumer, not a server: it has no port to expose.
ENV WORKER_DATA_DIR=/data

WORKDIR /app

COPY --from=build /prod ./

# Scratch space for per-job working files and the local-disk asset store used
# when Firebase Storage is not configured. A volume here survives a redeploy,
# which matters because a failed stage retries against assets already written.
RUN mkdir -p /data && chown node:node /data
USER node

# ffmpeg writes to a scratch directory; make sure it has one it owns.
ENV TMPDIR=/tmp

# No HEALTHCHECK: a queue consumer has nothing to HTTP-probe. Liveness is the
# BullMQ heartbeat - if the worker stops consuming, jobs stop completing and
# the queue depth alarm fires, which is a better signal than a 200.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
