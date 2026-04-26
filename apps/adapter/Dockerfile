FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/adapter/package.json apps/adapter/
COPY packages/schemas/package.json packages/schemas/
COPY packages/openclaw-client/package.json packages/openclaw-client/
COPY packages/tsconfig/package.json packages/tsconfig/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @openclaw-wrapper/adapter... build

FROM node:24-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/adapter/dist ./dist
COPY --from=build /repo/apps/adapter/package.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
EXPOSE 4000
CMD ["node", "dist/server.js"]
