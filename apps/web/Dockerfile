# Next.js storefront + Chaos Lab. Build from the repo root:
#   docker build -f apps/web/Dockerfile .
FROM node:24-alpine AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@11 --no-fund --no-audit
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@bsdemo/web..."

FROM deps AS build
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time (@logtail/next browser logging).
ARG NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN=
ARG NEXT_PUBLIC_BETTER_STACK_INGESTING_URL=
ARG NEXT_PUBLIC_BETTER_STACK_PROXY_PATH=/betterstack
ARG APP_RELEASE=dev
ENV NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN=$NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN \
    NEXT_PUBLIC_BETTER_STACK_INGESTING_URL=$NEXT_PUBLIC_BETTER_STACK_INGESTING_URL \
    NEXT_PUBLIC_BETTER_STACK_PROXY_PATH=$NEXT_PUBLIC_BETTER_STACK_PROXY_PATH \
    APP_RELEASE=$APP_RELEASE \
    NEXT_TELEMETRY_DISABLED=1
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter ./apps/web build

FROM node:24-alpine AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
