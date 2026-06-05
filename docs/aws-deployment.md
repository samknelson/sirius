# Deploying Sirius to AWS ECS

This repo ships a container image and a GitHub Actions pipeline that builds it,
pushes it to Amazon ECR, and rolls it out to an existing ECS service.

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage production image (Node 20). |
| `.dockerignore` | Keeps build context small and secret-free. |
| `.aws/task-definition.json` | ECS task definition **template** (fill in placeholders). |
| `.github/workflows/deploy-ecs.yml` | CI/CD: build → push to ECR → deploy to ECS. |

## What this does and does NOT do

- **Does:** build the image, push to ECR, register a new task-definition
  revision with the new image, and update the ECS service.
- **Does NOT:** create AWS infrastructure. You must already have an ECR repo, an
  ECS cluster + service (Fargate assumed), IAM execution/task roles, a log group,
  and a secrets store. Provision those with the AWS console, CloudFormation, or
  Terraform first.

## One-time AWS setup

1. **ECR repository** — e.g. `sirius`.
2. **ECS cluster + service** — Fargate, behind an Application Load Balancer.
   Point the target group health check at `/health` (the app returns
   `{"status":"ready"}` once fully initialized; `{"status":"starting"}` while it
   boots and runs migrations).
3. **IAM roles** —
   - *Task execution role*: pull from ECR, write logs, and read the secrets
     referenced in the task definition.
   - *Task role*: any AWS permissions the app itself needs at runtime.
4. **Secrets** — create the runtime secrets in AWS Secrets Manager (or SSM
   Parameter Store) and put their ARNs in `.aws/task-definition.json` under
   `secrets[].valueFrom`.
5. **Edit `.aws/task-definition.json`** — replace every `<PLACEHOLDER>`
   (account id, region, role ARNs, secret ARNs). Adjust `cpu`/`memory` as needed.

## GitHub configuration

Set these under **Settings → Secrets and variables → Actions**.

### Variables (non-secret)

| Variable | Example |
| --- | --- |
| `AWS_REGION` | `us-east-1` |
| `ECR_REPOSITORY` | `sirius` |
| `ECS_CLUSTER` | `sirius-cluster` |
| `ECS_SERVICE` | `sirius-service` |
| `ECS_CONTAINER_NAME` | `sirius` (must match the container name in the task def) |

### Secrets

| Secret | Notes |
| --- | --- |
| `AWS_ACCESS_KEY_ID` | Deploy credentials (ECR + ECS). Prefer OIDC — see below. |
| `AWS_SECRET_ACCESS_KEY` | |
| `VITE_CLERK_PUBLISHABLE_KEY` | Public Clerk key, baked into the frontend bundle. |
| `VITE_STRIPE_PUBLIC_KEY` | Public Stripe key, baked into the frontend bundle. |
| `VITE_GOOGLE_MAPS_API_KEY` | Public Maps key, baked into the frontend bundle. |

> **Prefer OIDC?** Replace the access-key inputs in the "Configure AWS
> credentials" step with `role-to-assume: <role-arn>` and add
> `permissions: { id-token: write, contents: read }` to the job. This avoids
> long-lived keys.

## Build-time vs runtime configuration

- **Build-time (`VITE_*`)** values are compiled into the static client bundle by
  Vite and cannot be changed without rebuilding the image. They are passed as
  Docker `--build-arg`s from GitHub secrets.
- **Runtime** values (database, session secret, auth, integrations) are injected
  by ECS from the task definition's `environment` and `secrets` — no rebuild
  needed to change them.

### Runtime environment the app expects

At minimum the container needs:

- `NODE_ENV=production` and `PORT=5000` (set in the image/task def).
- `DATABASE_URL` — PostgreSQL 16 connection string (e.g. RDS or Neon).
- `SESSION_SECRET` — session signing secret.
- Auth provider config — `AUTH_PROVIDER` plus the chosen provider's settings
  (SAML/Okta/Clerk/local). See "Known blockers" below.
- Any integration credentials your deployment actually uses (Stripe, Twilio,
  Google APIs, Weglot, site-specific T631/BTU, etc.). Add them as `secrets` in
  the task definition.

Database migrations run automatically at container startup (the startup path
loads and runs the migration framework). There is no separate migration step in
the build or the workflow.

## Known blockers (read before going live)

These are Replit-specific pieces that will not work on AWS as-is:

1. **Object Storage.** File upload/download uses the Replit Object Storage
   sidecar at `http://127.0.0.1:1106` (`server/services/objectStorage.ts`). That
   sidecar does not exist on ECS, so any file feature will fail until the storage
   layer is reworked to use Amazon S3 (the AWS S3 SDK is already a dependency).
   This is intentionally out of scope of the deploy pipeline.
2. **Replit Auth.** The default `replit` auth provider relies on Replit's OIDC
   and won't function off-platform. Configure `AUTH_PROVIDER` to a non-Replit
   provider (SAML/Okta/Clerk/local) and supply its config via the task
   definition before exposing the app to users.

## Deploy

Push to `main` (or run the workflow manually via **Actions → Build and deploy to
AWS ECS → Run workflow**). The workflow waits for the ECS service to reach a
stable state before succeeding.
