# Build context is apps/admin/ (this directory):
#   docker build -t juple-admin .
# A separate image from apps/web - the Admin Web is built, deployed and scaled on its own (admin.<domain>).

# The same pinned Node as apps/web/Dockerfile (satisfies Next.js 16's "node": ">=20.9.0").
FROM node:22.12.0-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22.12.0-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No build-time environment: every value (JUPLE_ADMIN_*) is read by the running container (lib/adminConfig.ts), so one image is
# deployable to every environment unchanged.
RUN npm run build

FROM node:22.12.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER node
# Container Apps ingress terminates TLS in front of this container; HOSTNAME=0.0.0.0 lets ingress reach it.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
ENTRYPOINT ["node", "server.js"]
