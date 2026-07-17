# Dockerfile for Phus
# Multi-stage build:
#   - builder: install deps + build
#   - runtime:  minimal image with production deps and built artifacts
# Pin exact versions for supply-chain safety.

# ---- builder ----
FROM node:20-alpine AS builder

# Install pnpm globally via corepack (shipped with Node 20).
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install all deps (including dev) so we can build.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build TS to dist/
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# ---- runtime ----
FROM node:20-alpine AS runtime

# Install pnpm for runtime dependency installation.
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Production deps only.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Built artifacts.
COPY --from=builder /app/dist ./dist

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
  CMD node dist/phus.mjs health || exit 1

# Default to gateway mode (override with `docker run phus run "..."`).
ENTRYPOINT ["node", "dist/phus.mjs"]
CMD ["gateway", "--websocket", "8080"]
