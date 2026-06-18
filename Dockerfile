# syntax=docker/dockerfile:1

# ============================================================================
# Sirius — production Docker image
# ----------------------------------------------------------------------------
# Multi-stage build:
#   1. builder  — installs all deps (incl. the toolchain for native modules
#                 like bcrypt), builds the Vite client and the esbuild server
#                 bundle, then prunes dev dependencies.
#   2. runtime  — a lean image with only production node_modules + dist/.
#
# IMPORTANT: this build intentionally does NOT run `npm run build` directly,
# because that script begins with `npm run db:push`, which contacts a live
# database and is forbidden in production. Instead we run the Vite + esbuild
# steps on their own. Database schema is applied automatically by the
# migration runner when the server starts (it also refuses to boot if the DB
# is out of sync), so no database is needed at build time.
#
# ----------------------------------------------------------------------------
# BUILD
#   docker build \
#     --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxx \
#     -t sirius:latest .
#
#   VITE_CLERK_PUBLISHABLE_KEY is baked into the client bundle at build time
#   (it is a publishable, non-secret Clerk key). Omit it if Clerk is not used.
#
# RUN
#   docker run -p 5000:5000 \
#     -e DATABASE_URL="postgres://..." \
#     -e SESSION_SECRET="..." \
#     sirius:latest
#
# REQUIRED runtime environment variables (provide via `-e` / your deploy):
#   - DATABASE_URL          PostgreSQL / Neon connection string (required)
#   - PORT                  Port to listen on (optional, default 5000)
#   - SESSION_SECRET        Express session signing secret
#   OPTIONAL, depending on which features/components are enabled:
#   - Clerk:        CLERK_SECRET_KEY (+ VITE_CLERK_PUBLISHABLE_KEY at build)
#   - SendGrid:     SENDGRID_API_KEY
#   - Twilio:       TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, ...
#   - Stripe:       STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
#   - Object store: AWS_*/GCS credentials as configured
#   - SAML/Okta/OAuth and any SITESPECIFIC_* values used by your deployment
#   Provide whatever your enabled feature set requires — these are read from
#   the environment at runtime and are NOT baked into the image.
#
# CAVEAT: features that rely on `puppeteer-core` (e.g. some PDF generation)
# need a Chromium binary in the container. This image does not install one.
# If you use those features, install Chromium and set PUPPETEER_EXECUTABLE_PATH
# (or switch to full `puppeteer`) in a derived image.
# ============================================================================


# ----------------------------------------------------------------------------
# Stage 1: builder
# ----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

# Toolchain required to compile native modules (bcrypt, bufferutil).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching). Full install incl. dev
# dependencies because Vite/esbuild/etc. are devDependencies.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source needed to build (client, server, shared,
# scripts, and the build config files). See .dockerignore for exclusions.
COPY . .

# Publishable Clerk key is compiled into the client bundle at build time.
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
ENV NODE_ENV=production

# Build the client (-> dist/public) and the server bundle (-> dist/*.js).
# Mirrors the second and third steps of the package.json "build" script,
# deliberately skipping the leading `npm run db:push`.
RUN npx vite build \
    && npx esbuild server/production-entry.ts server/app-init.ts \
        --platform=node --packages=external --bundle --format=esm \
        --splitting --outdir=dist

# Drop dev dependencies so only production node_modules carry over. The
# already-compiled native modules (bcrypt) are retained.
RUN npm prune --omit=dev


# ----------------------------------------------------------------------------
# Stage 2: runtime
# ----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
# Default port; override with -e PORT=...
ENV PORT=5000

WORKDIR /app

# Copy only what is needed to run the compiled server.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Run as the unprivileged user that ships with the node image.
USER node

EXPOSE 5000

# Container-native health check hitting the always-on /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/production-entry.js"]
