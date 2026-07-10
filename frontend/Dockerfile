FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8040/api/v1
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ARG NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID=
ARG NEXT_PUBLIC_MICROSOFT_OAUTH_CLIENT_ID=
ARG NEXT_PUBLIC_MICROSOFT_OAUTH_TENANT=consumers
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID
ENV NEXT_PUBLIC_MICROSOFT_OAUTH_CLIENT_ID=$NEXT_PUBLIC_MICROSOFT_OAUTH_CLIENT_ID
ENV NEXT_PUBLIC_MICROSOFT_OAUTH_TENANT=$NEXT_PUBLIC_MICROSOFT_OAUTH_TENANT
COPY next.config.ts ./
COPY tsconfig.json ./
COPY next-env.d.ts ./
COPY eslint.config.mjs ./
COPY postcss.config.mjs ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
EXPOSE 3040
CMD ["npm", "run", "start"]
