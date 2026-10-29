# Blocks Release expects a root Dockerfile and serves on 8080.
# Repo secrets are passed as Docker build-args during Kaniko; persist them as
# runtime ENV so the Next.js standalone server can read them.
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG ci_build=dev
ENV APP_MODE=live
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

ARG BLOCKS_PROJECT_KEY
ARG BLOCKS_API_URL
ARG BLOCKS_APP_DOMAIN
ARG BLOCKS_OIDC_URL=https://iam.seliseblocks.com
ARG BLOCKS_PUBLIC_CLIENT_ID
ARG BLOCKS_BACKEND_CLIENT_ID
ARG BLOCKS_BACKEND_CLIENT_SECRET
ARG BLOCKS_SIGNUP_CONFIGURATION_ID
ARG SESSION_SECRET
ARG APP_MODE=live
ARG APP_ORIGIN
ARG ci_build=dev

ENV BLOCKS_PROJECT_KEY=$BLOCKS_PROJECT_KEY \
    BLOCKS_API_URL=$BLOCKS_API_URL \
    BLOCKS_APP_DOMAIN=$BLOCKS_APP_DOMAIN \
    BLOCKS_OIDC_URL=$BLOCKS_OIDC_URL \
    BLOCKS_PUBLIC_CLIENT_ID=$BLOCKS_PUBLIC_CLIENT_ID \
    BLOCKS_BACKEND_CLIENT_ID=$BLOCKS_BACKEND_CLIENT_ID \
    BLOCKS_BACKEND_CLIENT_SECRET=$BLOCKS_BACKEND_CLIENT_SECRET \
    BLOCKS_SIGNUP_CONFIGURATION_ID=$BLOCKS_SIGNUP_CONFIGURATION_ID \
    SESSION_SECRET=$SESSION_SECRET \
    APP_MODE=$APP_MODE \
    APP_ORIGIN=$APP_ORIGIN

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
