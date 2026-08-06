# syntax=docker/dockerfile:1

# ============================================================================
# Sirius — production Docker image
# ----------------------------------------------------------------------------
# Multi-stage build:
#   1. deps      — installs all deps (incl. the toolchain for native modules
#                  like bcrypt) and copies the source tree.
#   2. builder   — builds the Vite client and the esbuild server bundle,
#                  then prunes dev dependencies.
#   3. migration — fat one-off image (full source + all node_modules + tsx)
#                  for the S1 migration inside the prod boundary; build with
#                  `docker build --target migration ...`. Never serves traffic.
#   4. runtime   — a lean image with only production node_modules + dist/
#                  (the default target).
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
# Stage 1: deps — full dependency install + source copy, shared by both the
# production builder and the migration image.
# ----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS deps

# Toolchain required to compile native modules (bcrypt, bufferutil).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# node:20-bookworm-slim ships npm 10.8.2, which has the known
# "Exit handler never called!" bug: npm can exit 0 with the install left
# incomplete, so buildkit caches a broken node_modules layer and the next
# step fails with e.g. "vite: not found". Upgrade npm before any npm command
# runs (this also busts any previously cached broken `npm ci` layer).
RUN npm install -g npm@11

WORKDIR /app

# Install dependencies first (better layer caching). Full install incl. dev
# dependencies because Vite/esbuild/etc. are devDependencies.
# The sanity check makes an incomplete install fail the layer loudly instead
# of being cached as DONE: the build toolchain binaries must exist.
COPY package.json package-lock.json ./
RUN npm ci \
    && test -x node_modules/.bin/vite \
    && test -x node_modules/.bin/esbuild

# Copy the rest of the source needed to build (client, server, shared,
# scripts, and the build config files). See .dockerignore for exclusions.
COPY . .


# ----------------------------------------------------------------------------
# Stage 2: builder — client + server bundle build, then dev-dep prune
# ----------------------------------------------------------------------------
FROM deps AS builder

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
# Stage 3: migration — one-off S1→S2 migration image (NOT the web app)
# ----------------------------------------------------------------------------
# A fat image for running scripts/s1-migration/* inside the HIPAA boundary as
# a long-lived one-off process (e.g. an ECS one-off task in the same VPC as
# the target DB). Unlike `runtime` it keeps the full source tree, ALL
# node_modules (tsx is a devDependency), and no web server is started.
#
# BUILD (only this target — skips the vite/esbuild build entirely):
#   docker build --target migration -t sirius-migration:latest .
#
# RUN (each runbook step is a command override; see
# scripts/s1-migration/RUNBOOK.md §1 "Running in the prod boundary"):
#   docker run --rm \
#     -e EXTERNAL_DATABASE_URL="postgres://..." \
#     -e S1_DATABASE_URL="mysql://...:3306/..." \
#     sirius-migration:latest \
#     npx tsx scripts/s1-migration/bootstrap-target.ts
# ----------------------------------------------------------------------------
FROM deps AS migration

ENV NODE_ENV=production
WORKDIR /app
USER node

# No default command: every invocation is an explicit runbook step passed as
# the container command (ECS containerOverrides.command). Running the image
# bare prints usage instead of doing anything to a database.
CMD ["node", "-e", "console.error('sirius-migration: pass a runbook command, e.g.\\n  npx tsx scripts/s1-migration/bootstrap-target.ts\\nSee scripts/s1-migration/RUNBOOK.md'); process.exit(2)"]


# ----------------------------------------------------------------------------
# Stage 4: runtime
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
