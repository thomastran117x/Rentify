FROM node:24-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
# The schema and Prisma config are needed before install: the postinstall hook
# runs `prisma generate`.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

FROM deps AS build
COPY openapi ./openapi
COPY tsconfig.json tsconfig.app.json tsconfig.base.json ./
COPY src ./src
RUN npm run prisma:generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/openapi ./openapi
COPY --from=build /app/prisma ./prisma
# `prisma migrate deploy` below reads the datasource URL from this config.
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/dist ./dist
EXPOSE 8040
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
