# Worker-ban boot recovery

This recovery is independent of worker Sirius ID ownership. Do not revert or
rerun the Sirius ID authority migration to address a worker-ban conversion
failure.

## Read-only evidence

Run this against the intended target before any repair:

```sh
npx tsx scripts/oneoffs/worker-ban-seed-preflight.ts
```

The report contains the live `worker_bans.type` type and width, every relevant
constraint and non-internal trigger, the canonical `DISPATCH` option state,
and the count of legacy literal `dispatch` rows. It does not write data.

The declared compatible shape is a nullable `varchar` (or unconstrained
`text`) soft reference. One or zero `DISPATCH` option rows is expected. Do not
blindly cast an enum, domain, narrow varchar, duplicate option set, or values
whose meaning is unclear. An existing canonical option must include the
`all-dispatch` behavior; startup refuses conversion rather than weakening an
active ban. The conversion also verifies the affected rows before commit, so
a trigger that suppresses or rewrites the update causes a rollback.

## Deployment

1. Save the preflight output with the deployment review.
2. If startup reports an incompatibility, review the exact constraint,
   trigger, column type, and PostgreSQL error fields in the
   `worker-ban-seed` log. Approve and apply only the schema/data repair named
   by that diagnosis.
3. Pause edits to the canonical Dispatch ban type during the deployment.
   Deploy the application normally. Concurrent instances serialize this seed
   with a transaction-scoped advisory lock, and conversion revalidates both
   the option and converted rows before commit.
4. Check `/boot-status` and `/api/boot-status`; both must report `ready`.
5. Run the preflight again. There must be one canonical `DISPATCH` option and
   zero safely convertible legacy rows.
6. Confirm a representative active Dispatch ban still refuses Dispatch work.
   The application enforces literal `dispatch` before/during recovery and the
   canonical option after conversion.

For a non-production rehearsal database, the isolated end-to-end verifier
creates and removes a fixture ban and checks legacy, repeated, concurrent, and
converted behavior:

```sh
npx tsx scripts/oneoffs/verify-worker-ban-seed.ts
```

## Rollback

Roll back the application deployment if the new build has an unrelated
failure. Do not delete the canonical option, rewrite converted bans to an
ambiguous value, or roll back the Sirius ID authority migration. The seed is
idempotent: after correcting the diagnosed worker-ban blocker, redeploy or
restart and it will safely resume the conversion.