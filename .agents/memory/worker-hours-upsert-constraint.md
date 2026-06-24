---
name: worker_hours upsert ON CONFLICT depends on a unique constraint that drifts out of the DB
description: Why upsertWorkerHours fails with "no unique or exclusion constraint matching the ON CONFLICT specification" and how the fix propagates to prod.
---

# worker_hours upsert ON CONFLICT vs. actual DB constraints

`storage.workerHours.upsertWorkerHours` does `INSERT ... ON CONFLICT` targeting
`(worker_id, employer_id, year, month, day)`. That requires a matching UNIQUE
constraint to physically exist on the `worker_hours` table.

**Gotcha:** `shared/schema.ts` declaring `unique().on(...)` does NOT mean the
constraint exists in the actual database. The constraint can be absent from both
the dev AND prod databases even though the schema file declares it — declaring it
in the schema only takes effect once it is pushed to the DB.

**Symptom:** "there is no unique or exclusion constraint matching the ON CONFLICT
specification" on `worker-hours.upsertWorkerHours`. In the GBHE Legal feed this is
caught per-row and the row is reported as success-with-issues, so hours silently
do NOT get written; in a direct edit path it can surface as a 500.

**Why it drifts:** changes to constraints in `shared/schema.ts` only reach a
database via `npm run db:push` (dev) and a re-Publish (prod). If neither was run,
the live tables lack the constraint.

**How to apply the fix to prod:** the production schema is owned by the Publish
flow, which diffs the dev DB against the prod DB. So the constraint must first
exist in the **dev database**, then the user must **re-Publish** to propagate it
to prod. Never run DDL against prod directly (prod is read-only anyway).

**Before adding any UNIQUE constraint:** check for duplicate rows on the key
columns first, or the ALTER will fail.
