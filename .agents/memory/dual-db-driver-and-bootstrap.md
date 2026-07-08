---
name: Dual DB driver + empty-DB bootstrap
description: Gotchas around the Neon-vs-pg driver selection in server/storage/db.ts and the empty-database bootstrap path
---

# Dual DB driver + empty-DB bootstrap

- The Replit dev DATABASE_URL here is **plain Postgres** (host `helium`, `?sslmode=disable`), NOT a `.neon.tech` host — so normal dev boots exercise the node-postgres (`pg`) driver path, not the Neon serverless path. The Neon path only runs against real Neon URLs (or `DATABASE_DRIVER=neon`).
- **Why it matters:** don't assume dev traffic validates the Neon branch; conversely, any pg-driver regression breaks dev immediately.
- The direct `pg` + `@types/pg` dependency resolves a NEWER @types/pg than the one bundled inside `@neondatabase/serverless`; Neon's `Pool` type is missing newer props (`expiredCount`, `ending`, `ended`, `options`), so a NeonPool no longer satisfies `pg.Pool` at type level. The shared pool export is typed `pg.Pool` (cast) because connect-pg-simple wants that; `db` stays typed `NeonDatabase<typeof schema>` to avoid type ripple through transaction-context.
- Empty-DB bootstrap (`ALLOW_EMPTY_DB_BOOTSTRAP=1`) runs all DDL + version stamping inside ONE transaction (Postgres DDL is transactional) so a mid-failure leaves the DB empty rather than in the refused "tables but no variables" state.
- **How to test boot paths cheaply:** `psql "$DATABASE_URL" -c "CREATE DATABASE x"` then run `DATABASE_URL=<modified> PORT=57xx timeout 60 npx tsx server/index.ts` and grep the log; exit 124 = server stayed up.
- `npx tsc --noEmit` on this repo dies silently (OOM) without `NODE_OPTIONS=--max-old-space-size=6144`.
