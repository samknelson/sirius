---
name: npm run db:push is interactive and can prompt a destructive rename
description: Why a blanket db:push / --force in this repo is dangerous, and the safe targeted alternative.
---

# `npm run db:push` interactive rename hazard

`npm run db:push` (drizzle-kit push) pushes the FULL diff between
`shared/schema.ts` and the dev database, not just the one change you intended.

It is **interactive** and will stop to ask whether an added column is a new
column or a rename of an existing one (observed: `dispatch_jobs.running` vs
`start_date`). With no stdin it aborts at the prompt before applying anything
(safe), but running it with `--force` would auto-pick "create new column", which
can DROP the old column and lose data.

**Rule:** do not `--force` db:push to work around the prompt. If you only need one
targeted, additive, non-destructive change (e.g. a single UNIQUE constraint) in
the **dev** database, apply it directly with `executeSql({ environment:
"development" })` DDL instead — dev supports all SQL. The schema file remains the
source of truth, and re-Publish propagates dev→prod.

This also signals latent drift between `shared/schema.ts` and the dev DB
(schema-file-vs-database, separate from dev-vs-prod) worth flagging to the user.
