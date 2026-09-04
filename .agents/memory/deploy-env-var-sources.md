---
name: Deploy-time env var sources
description: Where a deployed web service's container env actually comes from, per deployment family — Flight Control for bao-*, GitHub APP_* only for the Freeman pipeline; the repo can set neither.
---

# Deploy-time env var sources

**bao-dev / bao-stg / bao-prd (the S2 cutover targets)** are deployed by
**Flight Control** from the matching branch of `samknelson/sirius` (deployments
on that repo are created by `flightcontrol-ops[bot]`). Container env comes from
the web service's *Environment Variables* in the Flight Control dashboard, and a
change only reaches ECS on the next deploy. That repo carries **no** GitHub
Actions workflows and its GitHub Environments hold **no** variables — there is
no `APP_*` mechanism there, and no `flightcontrol.json` in the repo either
(dashboard-configured).

**Freeman (`freeman-dev` / `freeman-uat`, separate remote)** uses the
branch-scoped `.github/workflows/deploy-to-environment.yml`, where container
env = GitHub Environment vars/secrets prefixed `APP_*` (replace semantics per
deploy). A repo-managed `deploy/env.<env>.json` is referenced by that workflow's
docs but was never built — a value set there is a silent no-op.

**Why:** the RUNBOOK and setup docs once said "GitHub `APP_TZ`" for the bao web
apps, copied from the Freeman pipeline; an operator following it would find
nothing to set and the time-zone pin would never land. Verified 2026-09-04 via
the GitHub API (0 workflows, 0 environment variables, flightcontrol-ops
deployments).

**How to apply:** when a task asks to put a variable "in the deployment", first
identify the family. For bao-* the repo cannot do it — write the Flight Control
step + the boot-log evidence line into the runbook and say so in drift_reason;
never bake site-specific values (like `TZ`) into the shared Dockerfile
`runtime` stage, other sites run the same image. The app's boot log names the
provenance of `TZ` (`from TZ in the environment` / `in-app ENV_TZ override` /
`container default`), which is the evidence a checklist accepts.
