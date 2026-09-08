# Build context is apps/web/ (this directory) - build with:
#   docker build -t juple-web .
# from apps/web/, or `docker build -f apps/web/Dockerfile apps/web/` from the repo root (mirrors
# backend/src/Juple.Api/Dockerfile's own build-context convention).

# Pinned to the Node version already required elsewhere in this repo (see
# apps/mobile/package.json's "engines": ">= 22.11.0") and satisfies Next.js 16's own
# "node": ">=20.9.0" requirement (node_modules/next/package.json).
FROM node:22.12.0-alpine AS deps
WORKDIR /app
# package.json + package-lock.json only, so `npm ci` gets its own Docker layer that is only
# invalidated when a dependency actually changes - not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22.12.0-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# No ARG/build-time env of any kind - every value this app reads (JUPLE_API_BASE_URL,
# GOOGLE_PLAY_URL, APP_STORE_URL, APP_STORE_APP_ID, IOS_APP_ID,
# ANDROID_ASSETLINKS_SHA256_FINGERPRINTS) is a genuine runtime env var, read fresh by the running
# container (see lib/publicApi.ts, lib/storeConfig.ts, and the two .well-known route handlers) -
# none of them are NEXT_PUBLIC_*, so `next build` needs no environment-specific input at all. This
# is what makes one built image deployable to Dev/Staging/Prod unchanged (see
# infra/azure/web/main.bicep, which supplies these as plain Container App env vars).
RUN npm run build

# next.config.ts's `output: 'standalone'` traces only the files `next start`'s server actually
# needs - this runtime image never needs the full node_modules or the Next.js compiler/CLI.
FROM node:22.12.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# No `public/` directory exists in this app yet (confirmed - apps/web has none today); add
# `COPY --from=builder /app/public ./public` here if one is introduced later (see the standalone
# output doc's own note that `public`/`.next/static` are not copied automatically).

# node:alpine already ships a non-root "node" user/group - the same reason
# backend/src/Juple.Api/Dockerfile switches off root for the API image.
USER node

# Container Apps ingress terminates TLS in front of this container (see infra/azure/web/main.bicep,
# same posture as infra/azure/app/main.bicep) - the container itself only ever needs to speak plain
# HTTP. HOSTNAME=0.0.0.0 is required so ingress (a different network namespace) can actually reach
# this, not just localhost - standalone's own server.js reads both PORT and HOSTNAME.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

ENTRYPOINT ["node", "server.js"]
