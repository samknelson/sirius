---
name: ECS deploy DATABASE_URL / SESSION_SECRET gap
description: The Terraform-owned ECS task def provides DB parts but not DATABASE_URL/SESSION_SECRET; how the repo compensates without AWS access.
---

The deployed ECS/Fargate task definition is owned by external Terraform
(`fm-workloads-fls`) and is NOT editable from this repo — and there may be no
AWS console access at all. It injects the DB connection **parts**
(`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SECRET`) but does **not** assemble a
`DATABASE_URL`, and does not provide `SESSION_SECRET`. The app hard-requires
`DATABASE_URL` at module load (`server/storage/db.ts`) and `SESSION_SECRET` in
production (`server/auth/config.ts`), so the container dies at boot.

**Repo-side compensation (no AWS, no secret in git):**
- `server/config/assemble-database-url.ts` builds `DATABASE_URL` from the parts
  at process start, called at the top of `production-entry.ts` `main()` BEFORE
  `import('./app-init')` (the earliest point before `db.ts` loads). It handles
  `DB_SECRET` as either a Secrets-Manager JSON blob or a raw password, and on
  failure throws an error listing only the **names** of present `DB_*` env vars
  (never values) — this is the remote-diagnosis channel when you can't inspect AWS.
- `SESSION_SECRET`: a real value always wins; when absent, a fixed stable
  fallback is used only if `ALLOW_INSECURE_SESSION_SECRET=1`. The fallback MUST
  be a constant, because the `ui` and `api` run as **separate containers** that
  must share the session secret (a random per-process value breaks login).

**Why:** secrets can't live in `deploy/env.<env>.json` (plaintext in git; the
deploy workflow validates it as non-secret name/value pairs). The env file is
for non-secret flags only. Assembling in code keeps the DB password in the
Terraform-owned secrets injection while satisfying the app's `DATABASE_URL` need.

**How to apply:** if a deploy dies at boot on a missing env var, first check
whether it's a *secret* (must come from Terraform secrets or a gated code
fallback) vs a *non-secret flag* (can go in `deploy/env.<env>.json`). Watch for
the next wall after DB connects: an empty Aurora DB refuses boot unless
`ALLOW_EMPTY_DB_BOOTSTRAP=1`.
