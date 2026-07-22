# Dockerfile for Phus
# Multi-stage build:
#   - builder: install deps + build
#   - runtime:  minimal image with production deps and built artifacts
# Pin exact versions for supply-chain safety.

# Dockerfile for Phus
# Multi-stage build:
#   - builder: install deps + build the workspace
#   - runtime: install prod deps from the lockfile, then overlay the
#              built dist on top so `node dist/phus.mjs` works as
#              documented (HEALTHCHECK, ENTRYPOINT, docker-compose.yml,
#              install.sh all reference that path)
# Pin exact versions for supply-chain safety.

# ---- builder ----
FROM node:20-alpine AS builder

# Install pnpm globally via corepack (shipped with Node 20).
# Pin pnpm to 9.x: pnpm 10+ requires `node:sqlite` (Node 22.5+) which isn't
# in the Node 20 base image, so the in-Docker `pnpm install` would fail with
# ERR_UNKNOWN_BUILTIN_MODULE before the build ever starts.
RUN corepack enable && corepack prepare pnpm@9 --activate

# better-sqlite3 + koffi (+ protobufjs) compile from source on Alpine
# because none of them ship a musl prebuilt. node-gyp needs python / make /
# g++; koffi additionally needs cmake. Alpine doesn't ship any of these
# by default, so install the full toolchain once before `pnpm install`.
RUN apk add --no-cache python3 make g++ cmake musl-dev

WORKDIR /app

# Copy the whole monorepo. .dockerignore excludes node_modules, .git,
# .phus (which carries API keys), logs/, *.sqlite*, dist/, etc. — so the
# build context stays small while every file `pnpm -r build` needs is
# present. The previous Dockerfile (v0.1.0 single-package layout) only
# COPY'd package.json + pnpm-lock.yaml + tsconfig.json, which worked when
# dist/ sat at the repo root but breaks now that the build walks every
# workspace package.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ---- runtime ----
FROM node:20-alpine AS runtime

# Install pnpm for runtime dependency installation.
# Same version pin as the builder stage — see note above.
RUN corepack enable && corepack prepare pnpm@9 --activate

# Runtime also needs to compile better-sqlite3 / koffi / protobufjs from
# source (no musl prebuilt for the alpine image). Same toolchain as
# the builder — see note above.
RUN apk add --no-cache python3 make g++ cmake musl-dev

WORKDIR /app

# Copy the monorepo metadata + every workspace package so pnpm can set
# up the same workspace symlinks the builder did. The runtime install
# uses --prod to skip devDeps (vitest, typescript, etc.). .dockerignore
# keeps .phus, logs, sqlite, and node_modules out of this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.base.json ./
COPY packages/ packages/
COPY apps/ apps/
RUN pnpm install --prod --frozen-lockfile

# Overlay the built dist trees on top of the workspace install. pnpm
# already wired the symlinks (`apps/cli/node_modules/@phus/runtime →`
# `../../../../packages/runtime`, etc.) via the previous step, so the
# phus bin's deep imports like `@phus/runtime/infra/config/index.js`
# resolve to `packages/runtime/dist/...` in this image. The source
# `packages/*/` in the runtime layer never built anything, so we copy
# every workspace's `dist/` (and the cli's own `dist/`) from the
# builder on top of them.
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/runtime/dist ./packages/runtime/dist
COPY --from=builder /app/packages/tui/dist ./packages/tui/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/cli/dist ./apps/cli/dist

# Phus home dir (mount as a volume in production).
RUN mkdir -p /app/.phus /app/logs

# Run as non-root.
RUN addgroup -S phus && adduser -S phus -G phus && chown -R phus:phus /app
USER phus

# Default env vars (override at runtime).
ENV PHUS_HOME=/app/.phus \
    PHUS_LOG_FILE=/app/logs/phus.jsonl \
    PHUS_TAPE_DB=/app/.phus/tape.sqlite \
    PHUS_SKILLS_DIR=/app/.phus/skills \
    NODE_ENV=production

# Health check: `phus health` must exist for this to work.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node apps/cli/dist/phus.mjs health || exit 1

# Default to gateway mode (override with `docker run phus run "..."`).
ENTRYPOINT ["node", "apps/cli/dist/phus.mjs"]
CMD ["gateway", "--websocket", "8080"]
