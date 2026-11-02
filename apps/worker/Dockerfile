FROM node:22.15.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/worker ./apps/worker
COPY packages/contracts ./packages/contracts
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @webops/contracts build
RUN pnpm --filter @webops/worker build
FROM python:3.12.7-slim
WORKDIR /app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /app /app
COPY services/scanner ./services/scanner
RUN pip install --no-cache-dir uv==0.8.17 && cd services/scanner && uv sync --frozen && uv run playwright install --with-deps chromium
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/index.js"]
