# Flight Control Deployment Guide for Sirius

A comprehensive guide documenting every problem encountered while deploying this Express + React (Vite) application to AWS via Flight Control, along with the solutions. Use this as a step-by-step reference when configuring a new environment or onboarding a new app to Flight Control.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Build System Configuration](#2-build-system-configuration)
3. [Controlled Release Deployment Model](#3-controlled-release-deployment-model)
4. [Session & Cookie Configuration (CloudFront/Proxy)](#4-session--cookie-configuration-cloudfrontproxy)
5. [Multi-Provider Authentication](#5-multi-provider-authentication)
6. [AWS Cognito Integration](#6-aws-cognito-integration)
7. [Database: Neon PostgreSQL](#7-database-neon-postgresql)
8. [Component Schema Creation (Drizzle ORM)](#8-component-schema-creation-drizzle-orm)
9. [Ephemeral PR Preview Environments](#9-ephemeral-pr-preview-environments)
10. [Secrets & Environment Variables](#10-secrets--environment-variables)
11. [Self-Hosted Production: Docker & ECR](#11-self-hosted-production-docker--ecr)
12. [Troubleshooting Checklist](#12-troubleshooting-checklist)
13. [Deploying to Production Branches](#deploying-to-production-branches)

---

## 1. Architecture Overview

This application uses a **monolithic deployment** pattern:

- **Frontend**: React 18 + Vite, compiled to static files in `dist/public/`
- **Backend**: Express.js, compiled to `dist/server/index.js`
- **Both served from the same process** on port 3000

This is important because Flight Control deploys a single Fargate container. The Express server serves the Vite-built static files AND handles API routes. There is no separate frontend deployment.

```
┌─────────────────────────────────────────┐
│           Fargate Container             │
│                                         │
│  Express Server (port 3000)             │
│  ├── /api/*        → API routes         │
│  ├── /dist/public/ → Vite static files  │
│  └── /*            → SPA fallback       │
│                                         │
└─────────────────────────────────────────┘
         ↑
    CloudFront CDN
         ↑
      End Users
```

### Why this matters
- Neon Auth and session cookies work because frontend and backend share the same domain
- Health checks hit `/api/health` on port 3000
- There is only one service to configure per environment

---

## 2. Build System Configuration

### Problem: esbuild output directory structure

When esbuild bundles multiple entry points, it preserves the directory structure relative to the common ancestor. This means:

```bash
# Input:
esbuild server/index.ts scripts/start-preview.ts --outdir=dist

# Output (NOT what you might expect):
dist/server/index.js        # NOT dist/index.js
dist/scripts/start-preview.js  # NOT dist/start-preview.js
```

### Solution

Always verify the actual output paths after building. Update your `package.json` scripts to match:

```json
{
  "scripts": {
    "build": "vite build && esbuild server/index.ts scripts/start-preview.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
    "start": "NODE_ENV=production node dist/server/index.js",
    "start:preview": "NODE_ENV=production node dist/scripts/start-preview.js"
  }
}
```

### Key build flags

| Flag | Purpose |
|------|---------|
| `--platform=node` | Target Node.js, not browser |
| `--packages=external` | Don't bundle node_modules (they'll exist at runtime in nixpacks) |
| `--bundle` | Bundle all local imports into single file |
| `--format=esm` | Output ES modules (required when `"type": "module"` in package.json) |

### Gotcha: ESM module format

If your `package.json` has `"type": "module"`, esbuild **must** output `--format=esm`. Using `--format=cjs` will cause import failures at runtime.

---

## 3. Controlled Release Deployment Model

### Git & Deployment Architecture

Sirius uses a 4-layer "Controlled Release" model to manage highly-coupled code across multiple clients with distinct deployment timelines.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Git Branch Strategy                         │
│                                                                    │
│  Layer 1: Dev           dev-hta ──┐    dev-btu ──┐                │
│  (direct commits)                 │              │                 │
│                                   ▼              ▼                 │
│  Layer 2: Integration        ┌─────────┐                           │
│  (PRs only)                  │  main   │ ◄── stable shared code   │
│                              └────┬────┘                           │
│                            ┌──────┼──────┐                         │
│                            ▼      ▼      ▼                         │
│  Layer 3: Hosted Prod   prod-hta  │   prod-btu                    │
│  (fast-forward PRs)     (AWS/FC)  │   (AWS/FC)                    │
│                                   │                                │
│  Layer 4: Self-Hosted             ▼                                │
│  (Docker/ECR)              ECR Image Build                         │
│                            (GitHub Actions)                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Layer Details

| Layer | Branches | Trigger | Deploys To |
|-------|----------|---------|------------|
| Dev | `dev-hta`, `dev-btu` | Direct commits | Nothing (local dev) |
| Integration | `main` | PR from `dev-*` → `main` | Ephemeral preview env (Flight Control) |
| Hosted Production | `prod-hta`, `prod-btu` | PR from `main` → `prod-*` | AWS Fargate (Flight Control) |
| Self-Hosted Production | `main` (on merge) | Push to `main` | Docker image → Amazon ECR |

### flightcontrol.json Structure

The Flight Control config defines one environment per production client plus a shared preview environment:

```json
{
  "$schema": "https://app.flightcontrol.dev/schema.json",
  "ci": { "type": "ec2", "instanceSize": "t3.large" },
  "environments": [
    {
      "id": "prod-hta",
      "name": "Production (HTA)",
      "source": { "branch": "prod-hta" },
      "services": [{
        "envVariables": {
          "DATABASE_URL": { "fromParameterStore": "DATABASE_URL" },
          "SESSION_SECRET": { "fromParameterStore": "SESSION_SECRET" }
        }
      }]
    },
    {
      "id": "prod-btu",
      "name": "Production (BTU)",
      "source": { "branch": "prod-btu" },
      "services": [{
        "envVariables": {
          "DATABASE_URL": { "fromParameterStore": "DATABASE_URL" },
          "SESSION_SECRET": { "fromParameterStore": "SESSION_SECRET" }
        }
      }]
    },
    {
      "id": "preview",
      "name": "PR Preview",
      "source": { "pr": true, "branch": "main" },
      "services": [{ "startCommand": "npm run start:preview", "envVariables": { "MOCK_AUTH": "true" } }]
    }
  ]
}
```

Sensitive env vars (`DATABASE_URL`, `SESSION_SECRET`) are stored in AWS Systems Manager Parameter Store and referenced via `fromParameterStore`. Preview environments auto-generate a session secret at runtime.

### Adding a New Client

1. Create a `prod-<client>` branch from `main`
2. Add a new environment block to `flightcontrol.json` with `"source": { "branch": "prod-<client>" }`
3. Set the client's `DATABASE_URL` and `SESSION_SECRET` in AWS Parameter Store
4. Configure client-specific Components via the Components admin UI (feature flags are database-driven, not code-driven)

### Problem: Health check failures

Fargate kills containers that fail health checks. If your app takes time to start (database migrations, plugin loading), the default health check timing may be too aggressive.

### Solution

- Ensure `/api/health` responds quickly, even before full initialization
- Return a basic `200 OK` from the health endpoint as early as possible in the Express setup
- Don't put the health endpoint behind authentication middleware

### Problem: Port mismatch

Flight Control expects the app to listen on the port specified in `flightcontrol.json`. If your app listens on a different port, the health check will fail and the container will restart in a loop.

### Solution

Always use `port: 3000` in flightcontrol.json and ensure your Express app binds to `0.0.0.0:3000` (not `localhost:3000`).

---

## 4. Session & Cookie Configuration (CloudFront/Proxy)

### Problem: Sessions not persisting after login

When deployed behind CloudFront (or any reverse proxy), session cookies were not being sent back to the server. Users would log in successfully but immediately appear logged out.

### Root cause

CloudFront forwards requests from a different origin. The browser treats this as a cross-site request and blocks cookies with `sameSite: 'lax'`.

### Solution

Set `sameSite: 'none'` and `secure: true` in production:

```typescript
cookie: {
  httpOnly: true,
  secure: isProduction,             // HTTPS required for sameSite: 'none'
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
}
```

### Important notes
- `sameSite: 'none'` **requires** `secure: true` (HTTPS). Without it, browsers silently drop the cookie.
- In development (localhost), use `sameSite: 'lax'` and `secure: false`.
- If you're NOT behind CloudFront (direct Fargate URL), `sameSite: 'lax'` works fine.

### Trust proxy setting

When behind CloudFront or an AWS load balancer, Express doesn't know the original request was HTTPS (the proxy terminates TLS). This can cause `secure` cookies to not be set. Add this near the top of your Express setup:

```typescript
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
```

This tells Express to trust the `X-Forwarded-Proto` header from the proxy, so `req.secure` returns `true` for HTTPS requests forwarded from CloudFront.

### Session secret

Always set a `SESSION_SECRET` environment variable in Flight Control. Never rely on a hardcoded fallback in production:

```typescript
secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
```

---

## 5. Multi-Provider Authentication

### Architecture

The app uses an `auth_identities` table to support multiple authentication providers per deployment:

```
┌──────────────┐     ┌─────────────────┐     ┌─────────────┐
│   Provider   │────▶│  auth_identities │────▶│    users    │
│ (Replit/SAML │     │  provider_type   │     │  id, email  │
│  /OAuth)     │     │  external_id     │     │  firstName  │
└──────────────┘     │  user_id (FK)    │     └─────────────┘
                     └─────────────────┘
```

### Provider detection order

```typescript
function getAuthProvider(): AuthProvider {
  if (isSamlConfigured()) return "saml";
  if (isCognitoConfigured()) return "oauth";
  if (process.env.REPL_ID) return "replit";
  return "replit"; // fallback
}
```

### Problem: Unified logout routing

Each provider has a different logout flow. The `/api/logout` endpoint must route to the correct provider-specific logout based on the session's `providerType`.

### Solution

Store `providerType` in the session during login, then route at logout time:

```typescript
app.get("/api/logout", async (req, res) => {
  const providerType = (req.user as any)?.providerType;

  if (providerType === "oauth" && cognitoConfigured) {
    return res.redirect("/api/auth/cognito/logout");
  }
  if (providerType === "saml" && samlConfigured) {
    return res.redirect("/api/saml/logout");
  }
  // Default: Replit OIDC logout
  // ... destroy session and redirect
});
```

### Problem: User linking across providers

When a user logs in via a new provider but already has an account (matched by email), the system should link the new identity rather than create a duplicate user.

### Solution

```typescript
// 1. Check if identity already exists
let authIdentity = await storage.authIdentities.getByProviderAndExternalId(providerType, externalId);

if (authIdentity) {
  // Known identity, get existing user
  user = await storage.users.getUser(authIdentity.userId);
} else {
  // New identity - check if user exists by email
  user = await storage.users.getUserByEmail(email);

  if (!user) {
    // Completely new user
    user = await storage.users.createUser({ email, firstName, lastName, isActive: true });
  }

  // Link the new identity to the user
  authIdentity = await storage.authIdentities.create({
    userId: user.id,
    providerType,
    externalId,
    email,
    displayName,
  });
}
```

---

## 6. AWS Cognito Integration

### Required environment variables

| Variable | Example | Notes |
|----------|---------|-------|
| `COGNITO_USER_POOL_ID` | `us-east-1_AbCdEfGhI` | From Cognito console |
| `COGNITO_CLIENT_ID` | `1abc2def3ghi...` | App client ID |
| `COGNITO_CLIENT_SECRET` | `secret...` | App client secret |
| `COGNITO_DOMAIN` | `myapp.auth.us-east-1.amazoncognito.com` | Full domain or prefix |
| `COGNITO_CALLBACK_URL` | `https://d2jlq...cloudfront.net/api/auth/cognito/callback` | Must match exactly in Cognito |
| `COGNITO_REGION` | `us-east-1` | Defaults to us-east-1 |
| `COGNITO_LOGOUT_URL` | `https://d2jlq...cloudfront.net/` | Post-logout redirect |

### Problem: Cognito domain URL format

Cognito hosted UI domains come in two formats:
1. Custom domain: `auth.myapp.com`
2. Amazon domain: `myapp.auth.us-east-1.amazoncognito.com`

The code must handle both:

```typescript
const baseUrl = domain?.includes(".amazoncognito.com")
  ? `https://${domain}`
  : `https://${domain}.auth.${region}.amazoncognito.com`;
```

### Problem: Callback URL must match exactly

Cognito is extremely strict about callback URL matching. The URL in `COGNITO_CALLBACK_URL` must match character-for-character with what's configured in the Cognito App Client settings. Common mismatches:

- Trailing slash: `https://example.com/callback` vs `https://example.com/callback/`
- Protocol: `http://` vs `https://`
- CloudFront domain vs Fargate domain

### Problem: Cognito logout redirect

Cognito's logout endpoint requires a `logout_uri` parameter that must also be registered in the App Client settings under "Allowed sign-out URLs".

```typescript
const cognitoLogoutUrl = `${logoutURL}?client_id=${clientId}&logout_uri=${encodeURIComponent(logoutUri)}`;
```

### Debug endpoint

During initial setup, a debug endpoint is invaluable for verifying configuration without digging through logs:

```typescript
app.get("/api/auth/cognito/debug", (_req, res) => {
  res.json({
    configured: true,
    callbackUrl: process.env.COGNITO_CALLBACK_URL,
    domain: process.env.COGNITO_DOMAIN,
    authorizationURL: urls.authorizationURL,
    clientId: process.env.COGNITO_CLIENT_ID?.substring(0, 8) + '...',
  });
});
```

> Remove or protect this endpoint before going live.

---

## 7. Database: Neon PostgreSQL

### Connection string format

```
postgresql://user:password@host/database?sslmode=require
```

### Problem: Connection pooling

Neon uses connection pooling by default (endpoint with `-pooler` suffix). For Drizzle ORM, use the pooler endpoint for most operations but be aware that prepared statements may not work with pgBouncer in transaction mode.

### Problem: SSL required

Neon requires SSL. Always include `?sslmode=require` in the connection string. Without it, connections will be rejected.

### Flight Control setup

Set `DATABASE_URL` as a secret/environment variable in the Flight Control dashboard for each environment. Never hardcode it in `flightcontrol.json`.

---

## 8. Component Schema Creation (Drizzle ORM)

### Problem: Dynamic table creation missing column types

The `component-schema-push.ts` service dynamically creates tables from Drizzle ORM schema definitions. The original implementation only handled a few column types, causing failures when components used JSONB, UUID, or other types.

### Root cause

The `getSqlType()` function mapped Drizzle column types to SQL types. It was missing:
- `PgJsonb` → `JSONB`
- `PgJson` → `JSON`
- `PgUUID` → `UUID`
- `PgDate` → `DATE`
- `PgTime` → `TIME`
- `PgNumeric` → `NUMERIC`
- `PgBigInt` → `BIGINT`
- `PgSmallInt` → `SMALLINT`
- `PgReal` / `PgDoublePrecision` → `DOUBLE PRECISION`

### Solution

Maintain a comprehensive type map that covers all Drizzle column types. Also add a fallback based on `dataType`:

```typescript
// Primary: match on Drizzle's internal columnType string
if (columnType?.includes("PgJsonb")) return "JSONB";

// Fallback: match on the generic dataType
if (dataType === "json") return "JSONB";
```

### Lesson learned

When dynamically generating SQL from ORM schema, always log the generated SQL before execution. This makes debugging much faster:

```typescript
console.log(`SQL: ${createSql}`);
try {
  await db.execute(sql.raw(createSql));
} catch (error) {
  console.error(`Failed to create table ${tableName}: ${error.message}`);
  console.error(`SQL was: ${createSql}`);
  throw error;
}
```

---

## 9. Ephemeral PR Preview Environments

### Overview

Every pull request gets its own isolated environment with a dedicated Neon database branch. This prevents PR testing from affecting production or staging data.

```
PR opened → Flight Control builds preview → App starts →
  start-preview.ts provisions Neon branch → Sets DATABASE_URL →
  Spawns the app with isolated DB

PR closed → GitHub Action fires → Deletes Neon branch
```

### Problem: Build-time vs runtime environment injection

**Initial (broken) approach**: Generate `.env` file during build, load at runtime.

Why it fails:
- Flight Control/Nixpacks may not preserve build workspace files in the runtime container
- `.env` files rely on implicit loading behavior (dotenv, `--env-file`)
- `source` is bash-specific, not POSIX compatible
- If the file is missing, the app silently falls back to the wrong database

**Correct approach**: Provision the database at runtime, inject env vars in-process.

### Solution: Runtime provisioning script

`scripts/start-preview.ts` runs at container startup:
1. Calls Neon API to create/find a branch for this PR
2. Gets the connection string
3. Sets `DATABASE_URL` in the process environment
4. Spawns the actual app (`dist/server/index.js`) with the correct env

```typescript
const child = spawn("node", ["dist/server/index.js"], {
  env: { ...process.env, DATABASE_URL: connectionString },
  stdio: "inherit",
});
```

### Problem: tsx not available at runtime

Development-only tools like `tsx` may not be in the production container. The preview start script must be compiled to JavaScript during build.

### Solution

Include the script in the esbuild entry points:

```json
"build": "vite build && esbuild server/index.ts scripts/start-preview.ts --platform=node --packages=external --bundle --format=esm --outdir=dist"
```

Then reference the compiled output:

```json
"start:preview": "NODE_ENV=production node dist/scripts/start-preview.js"
```

### Problem: Silent fallback to production database

If Neon credentials are missing, the preview should NOT start with whatever `DATABASE_URL` is set by default.

### Solution

Fail fast and loud:

```typescript
if (!NEON_API_KEY) {
  console.error("FATAL: NEON_API_KEY is required for preview environments");
  process.exit(1);
}
```

### Problem: flightcontrol.json PR source format

Flight Control expects `"pr": true` (a boolean), not an object. Using an object like `{ "commentEnabled": true, "labels": [] }` will cause a config parsing error. If you need to filter which PRs trigger previews, use a separate `filter` block:

```json
"source": {
  "pr": true,
  "filter": {
    "toBranches": ["main"],
    "labels": ["deploy-preview"]
  }
}
```

### Cleanup: GitHub Action

When a PR is closed, a GitHub Action deletes the Neon branch:

```yaml
name: Cleanup Preview Database
on:
  pull_request:
    types: [closed]
jobs:
  cleanup-neon-branch:
    runs-on: ubuntu-latest
    steps:
      - name: Delete Neon Branch
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          NEON_PROJECT_ID: ${{ secrets.NEON_PROJECT_ID }}
        run: |
          # Sanitize and find the branch, then delete via Neon API
```

### Neon API client notes

The `@neondatabase/api-client` uses mixed API signatures:

```typescript
// Some methods use object params:
neonClient.listProjectBranches({ projectId: PROJECT_ID });

// Others use positional params:
neonClient.createProjectBranch(PROJECT_ID, { branch: { ... } });
neonClient.listProjectBranchEndpoints(PROJECT_ID, branchId);
```

The `EndpointType` enum must be imported and used (not a string literal):

```typescript
import { EndpointType } from "@neondatabase/api-client";
// Use: EndpointType.ReadWrite (not "read_write")
```

---

## 10. Secrets & Environment Variables

### Where to set each secret

| Secret | Flight Control | GitHub Actions | Notes |
|--------|:-:|:-:|-------|
| `DATABASE_URL` | Yes (prod-*) | No | Per-client Neon connection string, via Parameter Store |
| `SESSION_SECRET` | Yes (prod-*) | No | Unique per environment, via Parameter Store |
| `COGNITO_*` | Yes (if using Cognito) | No | 5 variables total |
| `NEON_API_KEY` | Yes (preview only) | Yes | Same key, both places |
| `NEON_PROJECT_ID` | Yes (preview only) | Yes | Same ID, both places |
| `MOCK_AUTH` | Yes (preview only) | No | Set to `"true"` for previews |
| `NODE_ENV` | Yes (all) | No | Always `"production"` |
| `REPL_ID` | No | No | Only exists in Replit env |
| `AWS_ACCESS_KEY_ID` | No | Yes | For ECR push workflow |
| `AWS_SECRET_ACCESS_KEY` | No | Yes | For ECR push workflow |
| `AWS_REGION` | No | Yes | For ECR push workflow |
| `ECR_REPOSITORY` | No | Yes | ECR repo name for Docker images |

### Setting secrets in Flight Control (Parameter Store)

Production environments use AWS Systems Manager Parameter Store for sensitive values:

1. Go to your Flight Control dashboard
2. Select the environment (`prod-hta`, `prod-btu`, etc.)
3. Navigate to the service's environment variables
4. Variables with `fromParameterStore` are managed in AWS SSM
5. Set `DATABASE_URL` and `SESSION_SECRET` per client environment
6. Redeploy for changes to take effect

### Setting secrets in GitHub

1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Add repository secrets:
   - `NEON_API_KEY` and `NEON_PROJECT_ID` — used by preview cleanup workflow
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `ECR_REPOSITORY` — used by ECR build workflow

---

## 11. Self-Hosted Production: Docker & ECR

For clients that run the application on their own infrastructure (e.g., client FLS), we build a Docker image and push it to a private Amazon ECR registry whenever code is merged into `main`.

### Dockerfile

The `Dockerfile` uses a multi-stage build:

1. **Builder stage**: Installs all dependencies, runs `npm run build` (Vite + esbuild)
2. **Runtime stage**: Installs only production dependencies, copies build artifacts

```
Build output structure in container:
/app/
├── dist/
│   ├── public/              (Vite frontend)
│   ├── server/index.js      (esbuild server bundle)
│   └── scripts/start-preview.js
├── shared/                  (runtime schemas)
├── node_modules/            (production only)
└── package.json
```

The Dockerfile accepts build args for traceability:
- `GIT_COMMIT_SHA` — embedded as an OCI label
- `BUILD_DATE` — embedded as an OCI label

### GitHub Actions Workflow

The `.github/workflows/ecr-build-push.yml` workflow runs on every push to `main`:

1. Checks out the code
2. Configures AWS credentials (from GitHub Secrets)
3. Logs into Amazon ECR
4. Builds the Docker image with git metadata labels
5. Tags with both the commit SHA and `latest`
6. Pushes both tags to ECR

### Required GitHub Secrets for ECR

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user with `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:PutImage` etc. |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret key |
| `AWS_REGION` | e.g., `us-east-1` |
| `ECR_REPOSITORY` | ECR repository name (e.g., `sirius-app`) |

### Client Deployment

The self-hosted client's IT team pulls from ECR and runs with their own configuration:

```bash
docker pull <account-id>.dkr.ecr.<region>.amazonaws.com/sirius-app:latest
docker run -d \
  -e DATABASE_URL="postgresql://..." \
  -e SESSION_SECRET="..." \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -p 3000:3000 \
  sirius-app:latest
```

---

## 12. Troubleshooting Checklist

### Deployment won't start

- [ ] Is `port` in flightcontrol.json correct? (should be 3000)
- [ ] Does `/api/health` return 200 without requiring auth?
- [ ] Is `NODE_ENV` set to `production`?
- [ ] Does `npm run build` succeed locally?
- [ ] Are the `start` script paths correct for esbuild output structure?
- [ ] Is the app binding to `0.0.0.0` not `localhost`?

### Login works but session doesn't persist

- [ ] Is `sameSite: 'none'` set for production cookies?
- [ ] Is `secure: true` set for production cookies?
- [ ] Is the app behind HTTPS (required for `secure` cookies)?
- [ ] Is `SESSION_SECRET` set as an environment variable?
- [ ] Is the session store configured (not in-memory)?

### Cognito login redirects fail

- [ ] Does `COGNITO_CALLBACK_URL` match exactly in Cognito App Client settings?
- [ ] Is the Cognito domain format correct? (full URL vs prefix)
- [ ] Is the callback URL using `https://`?
- [ ] Are all 5 Cognito env vars set?
- [ ] Check `/api/auth/cognito/debug` for configuration details

### Preview environment uses wrong database

- [ ] Are `NEON_API_KEY` and `NEON_PROJECT_ID` set in Flight Control preview env?
- [ ] Is the start command `npm run start:preview` (not `npm run start`)?
- [ ] Check container logs for "FATAL: NEON_API_KEY is required"
- [ ] Verify the Neon branch was created in the Neon console

### Component tables fail to create

- [ ] Check the logged SQL statement for the table
- [ ] Verify all column types are mapped in `getSqlType()` in `component-schema-push.ts`
- [ ] Look for "Failed to create table" in the logs
- [ ] Ensure the database user has CREATE TABLE permissions

### Git push rejected

- [ ] Remote has commits not in local: `git pull --rebase origin main` then push
- [ ] Branch protection rules may block direct pushes to main
- [ ] Force push only if you're certain your local is authoritative: `git push --force origin main`

---

## Deploying to Production Branches

### Overview

Production deployments are controlled by advancing `prod-*` branches to specific commits on `main`. You choose exactly which commit each client gets — clients can be on different versions.

### Option A: Deploy the Latest from Main (GitHub UI)

Use this when you want to bring a client's production fully up to date with `main`.

1. Go to your GitHub repo
2. Click **Pull requests** → **New pull request**
3. Set **base:** `prod-hta` and **compare:** `main`
4. Create the PR, review the changes, and merge
5. Flight Control will automatically deploy

This always takes everything on `main` up to the latest commit.

### Option B: Deploy a Specific Commit (Command Line)

Use this when `main` has recent commits that aren't ready for a specific client.

```bash
# 1. Find the commit you want
git log main --oneline
# Example output:
# abc1234 Fix billing report
# def5678 Add new dashboard widget
# ghi9012 Update worker search
# jkl3456 Refactor auth module

# 2. Push that specific commit to the prod branch
git push origin abc1234:refs/heads/prod-hta
```

This sets `prod-hta` to exactly commit `abc1234`, skipping any newer commits that aren't ready.

### Example: Different Versions per Client

```bash
# HTA gets the latest (all commits up to today)
git push origin main:refs/heads/prod-hta

# BTU stays on last week's version
git push origin ghi9012:refs/heads/prod-btu
```

### Catching Up Later

When BTU is ready for the latest:
```bash
git push origin main:refs/heads/prod-btu
```

Or advance to a specific newer commit:
```bash
git push origin def5678:refs/heads/prod-btu
```

### Important Rules

- **Never commit directly to `prod-*` branches.** Always advance them from `main`.
- **Never force-push** to `prod-*` branches. The push should always be a fast-forward.
- If `git push` is rejected, it means the prod branch has diverged from main — investigate before proceeding.

---

## Quick Reference: Adding a New Client

1. Create a `prod-<client>` branch from `main`: `git checkout main && git checkout -b prod-<client>`
2. Add a new environment block to `flightcontrol.json` with `"source": { "branch": "prod-<client>" }`
3. Set `DATABASE_URL` and `SESSION_SECRET` in AWS Parameter Store for the new environment
4. Create the client's Neon database project (or use an existing one)
5. Push to the `prod-<client>` branch to trigger initial deployment
6. Configure client-specific Components via the admin UI
7. Create a `dev-<client>` branch for development work
8. Monitor Flight Control logs for build/start errors
9. Verify session cookies work if behind a CDN/proxy

---

## Quick Reference: Adding a New Auth Provider

1. Create a new file: `server/auth/<provider>.ts`
2. Implement the OAuth/SAML/OIDC strategy
3. Store `providerType` in the session user object
4. Link identities via `auth_identities` table (check email for existing users)
5. Add provider detection in `server/auth/index.ts` (`getAuthProvider()`)
6. Add logout routing in the unified `/api/logout` endpoint
7. Add the provider to the `/api/auth/providers` response
8. Update the `provider_type` enum in the schema if needed
