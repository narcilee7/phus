# Dockerfile for Phus
# Multi-stage build per pi-mono convention:
#   - builder:  install + build
#   - runtime:  minimal node, pinned deps, no dev tooling
# Pin exact versions for supply-chain safety.

# ---- builder ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install all deps (including dev) so we can build.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Build TS to dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runtime

WORKDIR /app

# Production deps only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

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

# Health check: the `phus health` command must exist for this to work.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node dist/phus.js health || exit 1

# Default to gateway mode (override with `docker run phus run "..."`).
ENTRYPOINT ["node", "dist/phus.js"]
CMD ["gateway", "--websocket", "8080"]
