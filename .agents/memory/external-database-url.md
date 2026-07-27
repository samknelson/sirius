---
name: EXTERNAL_DATABASE_URL resolution and Neon pooler rewrite
description: Resolution rule for DB URL across all consumers, and why the Neon pooler URL must be rewritten to the direct endpoint for the serverless driver.
---

# EXTERNAL_DATABASE_URL resolution

## The rule
`process.env.EXTERNAL_DATABASE_URL || process.env.DATABASE_URL` — everywhere, no exceptions.

Applies to: `server/storage/db.ts`, `server/logger.ts`, `server/config/assemble-database-url.ts`, `drizzle.config.ts`, `scripts/db-push.ts`.

**Why:** Replit injects `DATABASE_URL` and it cannot be unset. Any consumer that reads only `DATABASE_URL` will target the Replit-injected DB instead of the external one — split-brain between app and schema tooling, the worst property for destructive tooling.

**How to apply:** Whenever adding a new DB consumer, use `process.env.EXTERNAL_DATABASE_URL || process.env.DATABASE_URL` at the top, never `process.env.DATABASE_URL` alone.

## ECS URL assembler
`assembleDatabaseUrl()` in `server/config/assemble-database-url.ts` is a no-op when `EXTERNAL_DATABASE_URL` is set (checked before `DATABASE_URL`). An assembled URL must never win over an explicit external URL.

## Neon pooler URL rewrite (db.ts)
When the Neon serverless driver is selected and the URL contains `-pooler.` in the hostname, `rewriteNeonPoolerUrl()` strips `-pooler` to target the direct compute endpoint.

**Why:** The Neon pooler (`-pooler.` subdomain) runs PgBouncer in transaction mode, which:
1. Blocks session-level startup parameters including `search_path`
2. Is redundant — the Neon serverless NeonPool already manages connections over WebSocket

Neon defaults `search_path = ''` (empty). Without the rewrite, unqualified table names (`variables`, `workers`, etc.) fail with "relation does not exist" — even after `ALTER DATABASE SET search_path TO public`, because the pooler reuses old backend connections.

**How to apply:** The rewrite is automatic in `db.ts`. For new Neon databases, also run `ALTER DATABASE <dbname> SET search_path TO public;` once via psql to ensure direct connections also inherit the correct default.

## DDL visibility banners
`drizzle.config.ts` and `scripts/db-push.ts` both print:
```
[drizzle|db:push] Target database: <hostname><pathname> (from EXTERNAL_DATABASE_URL|DATABASE_URL)
```
Never log the full URL (contains credentials). Use `new URL(url).hostname + pathname`.
