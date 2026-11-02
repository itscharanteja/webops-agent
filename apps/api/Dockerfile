FROM node:22.15.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/contracts ./packages/contracts
COPY supabase/migrations ./supabase/migrations
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @webops/contracts build
RUN pnpm --filter @webops/api build
FROM node:22.15.0-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
