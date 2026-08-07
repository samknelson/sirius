# Rehearsal target region move: us-east-2 → us-west-2

Why: the ECS migration tasks run in the FC dev VPC (us-west-2); the original
rehearsal Neon project was in us-east-2. Every storage-layer write paid a
~50–60ms cross-region round trip → ~8 rows/s in load-contacts-workers.
Same-region round trips are ~1–2ms; expected speedup 10–30x with no code
changes. Neon has no us-west-1 region, so the production pairing will also be
a us-west-2 Neon next to a us-west-2 FC deployment.

Procedure (placeholders, never commit real URLs):

1. Stop any running loader task (`aws ecs stop-task`). Loaders are
   interrupt-safe; no cleanup needed.
2. Create a new Neon project in AWS us-west-2 (Oregon), same Postgres major
   version as the old project. Use the **direct** (non-pooler) endpoint URL.
3. From CloudShell (regular tab — internet access), install matching client
   tools and stream the staging schema old → new WITHOUT an intermediate file
   (CloudShell storage is ~1 GB):

   ```bash
   sudo dnf install -y postgresql16   # pg_dump must be >= server major
   # bootstrap FIRST (step 4) if restoring into the same session/order matters;
   # see ordering note below.
   pg_dump "<OLD_NEON_URL>" --schema=s1_staging -Fc \
     | pg_restore -d "<NEW_NEON_URL>" --no-owner --no-privileges
   ```

4. ORDERING: run `bootstrap-target.ts` on the NEW project BEFORE restoring
   staging — `--wipe` (and a future re-bootstrap) drops `s1_staging` CASCADE.
   Sequence: bootstrap (fresh) → restore staging → truncate bookkeeping.
5. After restore, clear cross-project bookkeeping (old id_map points at S2
   rows that don't exist in the new project):

   ```sql
   TRUNCATE s1_staging.id_map;
   TRUNCATE s1_staging.runs;
   ```

6. Verify row counts old vs new for the big tables (records, terms,
   raw_ledger_*, raw_users) before proceeding.
7. Point the deployment at the new project: update the Secrets Manager
   secret backing `EXTERNAL_DATABASE_URL` in the migration task definition
   (no new task-def revision needed if it references the secret ARN).
8. Re-run the loader sequence from the top (options → contacts-workers → …)
   per RUNBOOK §3. Deliberate staging deletions (e.g. the 19 sirius_id
   collisions) travel with the dump; do not redo them.
9. Confirm the speedup in the first heartbeats; if rates are still single-digit
   rows/s, something else is wrong — stop and investigate before burning hours.
