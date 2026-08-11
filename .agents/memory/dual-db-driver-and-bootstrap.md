---
name: Dual DB driver + empty-DB bootstrap
description: Gotchas around the Neon-vs-pg driver selection in server/storage/db.ts and the empty-database bootstrap path
---

# Dual DB driver + empty-DB bootstrap

- (Updated 2026-08-11) DB resolution prefers **EXTERNAL_DATABASE_URL** when set — and it IS set in this workspace — so the dev workflow boots the **Neon serverless driver** against the external Neon DB (boot log: `[db] Target database: ... (from EXTERNAL_DATABASE_URL)`). The plain-Postgres helium `$DATABASE_URL` is a stale leftover (its `migrations_version` is frozen far behind).
- **Why it matters:** `psql "$DATABASE_URL"` in the shell does NOT show the app's DB state — verify via a tsx one-off importing `server/db` (same resolution incl. Neon pooler rewrite) or read the `[db] Target database:` boot log line. Conversely, the `pg` driver branch is now UNexercised by dev boots here; it only runs where EXTERNAL_DATABASE_URL is absent.
- The direct `pg` + `@types/pg` dependency resolves a NEWER @types/pg than the one bundled inside `@neondatabase/serverless`; Neon's `Pool` type is missing newer props (`expiredCount`, `ending`, `ended`, `options`), so a NeonPool no longer satisfies `pg.Pool` at type level. The shared pool export is typed `pg.Pool` (cast) because connect-pg-simple wants that; `db` stays typed `NeonDatabase<typeof schema>` to avoid type ripple through transaction-context.
- Empty-DB bootstrap (`ALLOW_EMPTY_DB_BOOTSTRAP=1`) runs all DDL + version stamping inside ONE transaction (Postgres DDL is transactional) so a mid-failure leaves the DB empty rather than in the refused "tables but no variables" state.
- **How to test boot paths cheaply:** `psql "$DATABASE_URL" -c "CREATE DATABASE x"` then run `DATABASE_URL=<modified> PORT=57xx timeout 60 npx tsx server/index.ts` and grep the log; exit 124 = server stayed up.
- `npx tsc --noEmit` on this repo dies silently (OOM) without `NODE_OPTIONS=--max-old-space-size=6144`.
