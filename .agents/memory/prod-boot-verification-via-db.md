---
name: Verifying prod boot health from the workspace (no AWS access)
description: How to confirm the prod ECS app booted past the drift gate when you can't see CloudWatch or the CloudFront URL.
---

The workspace has no AWS CLI/credentials and the prod CloudFront URL is not in
the repo (sanitized). Startup-phase log lines (migration runner, drift gate)
never reach the `winston_logs` table — its DB transport only carries post-boot
events (source `storage`, auth, crons).

**How to verify prod boot health anyway (via `EXTERNAL_DATABASE_URL`):**
- `SELECT value FROM variables WHERE name='migrations_version'` — counter at or
  above the latest migration proves the runner reached it.
- Expected tables/seeds present (`information_schema.tables`, seed row counts).
- Liveness: recent `winston_logs` rows (cron storage ops, `Authentication
  event: login`) and fresh `sessions` rows. Because the drift gate refuses to
  boot on any drift, *any* post-fix serving activity implies the gate passed.

**Why:** the 1117/1120 version-collision incident — redeploy + self-heal were
confirmed entirely from DB evidence.

**How to apply:** any "did prod boot / did migration X run" question. Actual
image rebuild/rollout is human-run CloudShell per docs/s1-migration/FC-ENVIRONMENT-SETUP.md;
the stale-image trap is building before the fix commit is on origin/bao-prd —
check `git log origin/bao-prd` vs the fix commit before rebuilding.
