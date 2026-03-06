FROM node:20-alpine AS build
WORKDIR /app

# Copy all package.jsons for workspace resolution
COPY package.json package-lock.json ./
COPY packages/sdk-typescript/package.json ./packages/sdk-typescript/
COPY packages/ai-sdk/package.json ./packages/ai-sdk/
COPY services/server/package.json ./services/server/
COPY apps/web/package.json ./apps/web/

# Install all workspace deps
RUN npm ci

# Copy source
COPY packages ./packages
COPY services/server ./services/server
COPY apps/web ./apps/web
COPY infra/clickhouse/migrations ./infra/clickhouse/migrations
COPY tsconfig.base.json turbo.json ./

# Build everything
RUN npx turbo run build

# Production image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy server build + dependencies
COPY --from=build /app/services/server/dist ./dist
COPY --from=build /app/node_modules ./node_modules
# Overlay server-specific dependency versions (npm may nest versions that differ from hoisted ones)
COPY --from=build /app/services/server/node_modules/ ./node_modules/
COPY --from=build /app/services/server/package.json ./

# Copy web build as static files
COPY --from=build /app/apps/web/dist ./public

# Copy ClickHouse migrations — read at runtime by the migration runner
COPY --from=build /app/infra/clickhouse/migrations ./migrations/clickhouse

# Copy Drizzle (Postgres) migrations — read at runtime by drizzle-orm migrator
COPY --from=build /app/services/server/drizzle ./drizzle

EXPOSE 3100
CMD ["node", "dist/index.js"]
