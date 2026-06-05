# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Sirius — production container image for AWS ECS (Fargate or EC2).
#
# Multi-stage build:
#   1) builder  — installs ALL deps, builds the client (Vite -> dist/public)
#                 and bundles the server (esbuild -> dist/*.js).
#   2) runtime  — installs production-only deps and copies the built dist/.
#
# IMPORTANT: we deliberately do NOT run `npm run build` here. That script runs
# `npm run db:push` first, which this project forbids in production (schema
# changes must go through the migration framework, which runs at app startup).
# Instead we run the client build and the server bundle steps directly.
#
# Build-time public keys (baked into the client bundle by Vite) are passed as
# build args. They are PUBLIC keys, safe to embed in the frontend:
#   VITE_CLERK_PUBLISHABLE_KEY, VITE_STRIPE_PUBLIC_KEY, VITE_GOOGLE_MAPS_API_KEY
# Everything else is a RUNTIME env var/secret — see .aws/task-definition.json
# and docs/aws-deployment.md.
# ---------------------------------------------------------------------------

# ---- Stage 1: builder -----------------------------------------------------
FROM node:20.20.0-bookworm-slim AS builder
WORKDIR /app

ENV NODE_ENV=production

# Install dependencies first (better layer caching). Dev deps are needed here
# because Vite, esbuild, TypeScript, etc. live in devDependencies.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Copy the rest of the source.
COPY . .

# Public, client-side keys baked into the bundle at build time.
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ARG VITE_STRIPE_PUBLIC_KEY=""
ARG VITE_GOOGLE_MAPS_API_KEY=""
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
    VITE_STRIPE_PUBLIC_KEY=$VITE_STRIPE_PUBLIC_KEY \
    VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

# Build the client (-> dist/public) and bundle the server (-> dist/).
# Mirrors the `build` script in package.json minus the `db:push` step.
RUN npx vite build \
 && npx esbuild server/production-entry.ts server/app-init.ts \
      --platform=node --packages=external --bundle --format=esm \
      --splitting --outdir=dist

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:20.20.0-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000

# Install production dependencies only. The server bundle uses
# `--packages=external`, so all runtime packages must be present here.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the built artifacts (client static + bundled server).
COPY --from=builder /app/dist ./dist

# The container only serves HTTP on $PORT (default 5000).
EXPOSE 5000

# Container-level health check. Node 20 has a global fetch(); no curl needed.
# ECS can also be configured with its own healthCheck (see task-definition.json).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(j=>process.exit(j.status==='ready'?0:1)).catch(()=>process.exit(1))"

# Start the production server. Database migrations run during app startup
# (see server/production-entry.ts -> app-init.ts), not as a build step.
CMD ["node", "dist/production-entry.js"]
