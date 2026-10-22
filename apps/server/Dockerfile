# Build stage: prepare dependencies and build
FROM node:22-bookworm-slim AS build

# Install git (required for vault operations)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace configuration and patches
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches

# Copy source code needed for the server
COPY apps/server ./apps/server
COPY packages/protocol ./packages/protocol
COPY packages/markdown-yjs ./packages/markdown-yjs

# Create stub workspace packages with minimal package.json for pnpm workspace validation
RUN mkdir -p apps/mobile apps/web mcp-server && \
    echo '{"name":"@tolaria/mobile","version":"0.0.0","private":true}' > apps/mobile/package.json && \
    echo '{"name":"@tolaria/web","version":"0.0.0","private":true}' > apps/web/package.json && \
    echo '{"name":"tolaria-mcp-server","version":"0.0.0"}' > mcp-server/package.json

# Enable pnpm and install dependencies
RUN corepack enable && \
    corepack prepare pnpm@10.33.0 --activate && \
    pnpm install --frozen-lockfile

# Production stage: minimal runtime image
FROM node:22-bookworm-slim

# Install git (required for vault operations)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash tolaria

WORKDIR /app

# Copy built application and dependencies from build stage
COPY --from=build --chown=tolaria:tolaria /app/node_modules ./node_modules
COPY --from=build --chown=tolaria:tolaria /app/apps/server ./apps/server
COPY --from=build --chown=tolaria:tolaria /app/packages ./packages
COPY --from=build --chown=tolaria:tolaria /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Create data directory with correct ownership
RUN mkdir -p /app/data && chown tolaria:tolaria /app/data

# Switch to non-root user
USER tolaria

# Expose default port
EXPOSE 8787

# Set default environment variables
ENV TOLARIA_SERVER_DATA_DIR=/app/data \
    TOLARIA_SERVER_HOST=0.0.0.0 \
    TOLARIA_SERVER_PORT=8787 \
    TOLARIA_SERVER_ALLOW_NON_LOOPBACK=1 \
    NODE_ENV=production

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8787/healthz', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Run the server
CMD ["pnpm", "server"]
