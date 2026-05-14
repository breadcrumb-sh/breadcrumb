FROM node:20-alpine AS build
WORKDIR /repo

# Copy all package.jsons for workspace resolution
COPY package.json package-lock.json ./
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/ai-sdk/package.json ./packages/ai-sdk/
COPY app/shared/package.json ./app/shared/
COPY app/server/package.json ./app/server/
COPY app/web/package.json ./app/web/

# Install all workspace deps
RUN npm ci

# Copy source
COPY packages ./packages
COPY app/shared ./app/shared
COPY app/server ./app/server
COPY app/web ./app/web
COPY infra/clickhouse/migrations ./infra/clickhouse/migrations
COPY tsconfig.base.json turbo.json ./

# Build everything
RUN npx turbo run build

# Production image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy server build + dependencies
COPY --from=build /repo/app/server/dist ./dist
COPY --from=build /repo/node_modules ./node_modules
# Overlay server-specific dependency versions (npm may nest versions that differ from hoisted ones)
COPY --from=build /repo/app/server/node_modules/ ./node_modules/
COPY --from=build /repo/app/server/package.json ./

# Copy web build as static files
COPY --from=build /repo/app/web/dist ./public

# Copy ClickHouse migrations — read at runtime by the migration runner
COPY --from=build /repo/infra/clickhouse/migrations ./migrations/clickhouse

# Copy Drizzle (Postgres) migrations — read at runtime by drizzle-orm migrator
COPY --from=build /repo/app/server/drizzle ./drizzle

EXPOSE 3100
CMD ["node", "dist/index.js"]
