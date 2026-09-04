---
name: Dual DB driver + empty-DB bootstrap
description: Gotchas around the Neon-vs-pg driver selection in server/storage/db.ts and the empty-database bootstrap path
---

# Dual DB driver + empty-DB bootstrap

- DB resolution prefers **EXTERNAL_DATABASE_URL** when set (Neon serverless driver); when it is absent the app boots the plain **`pg` driver** against `$DATABASE_URL`. Which one a workspace uses has FLIPPED over time (2026-08-11: EXTERNAL set, Neon in use; 2026-09-04: EXTERNAL unset, helium `$DATABASE_URL` IS the app DB and `psql "$DATABASE_URL"` shows the live state). Never assume — read the `[db] Target database: ... (from <VAR>)` boot log line first.
- **Why it matters:** when EXTERNAL_DATABASE_URL is set, `psql "$DATABASE_URL"` in the shell does NOT show the app's DB state — verify via a tsx one-off importing `server/db` (same resolution incl. Neon pooler rewrite). Whichever driver branch a dev boot skips is unexercised locally.
- Dev DB may have NO note types (`options_note_type` empty) and no general-type case statuses; BAO case tests/one-offs that need a worker note type must create one (the DB suites bring their own).
- The direct `pg` + `@types/pg` dependency resolves a NEWER @types/pg than the one bundled inside `@neondatabase/serverless`; Neon's `Pool` type is missing newer props (`expiredCount`, `ending`, `ended`, `options`), so a NeonPool no longer satisfies `pg.Pool` at type level. The shared pool export is typed `pg.Pool` (cast) because connect-pg-simple wants that; `db` stays typed `NeonDatabase<typeof schema>` to avoid type ripple through transaction-context.
- Empty-DB bootstrap (`ALLOW_EMPTY_DB_BOOTSTRAP=1`) runs all DDL + version stamping inside ONE transaction (Postgres DDL is transactional) so a mid-failure leaves the DB empty rather than in the refused "tables but no variables" state.
- **How to test boot paths cheaply:** `psql "$DATABASE_URL" -c "CREATE DATABASE x"` then run `DATABASE_URL=<modified> PORT=57xx timeout 60 npx tsx server/index.ts` and grep the log; exit 124 = server stayed up.
- `npx tsc --noEmit` on this repo dies silently (OOM) without `NODE_OPTIONS=--max-old-space-size=6144`.
