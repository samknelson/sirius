---
name: node-postgres connectionString ssl overrides explicit ssl
description: Why an explicit pg.Pool ssl config is silently ignored when sslmode is in the connection string, and how that surfaces as an Aurora "unable to get local issuer certificate" boot crash.
---

Symptom: prod/Aurora boot crash `unable to get local issuer certificate` at
`pg-pool`, even though the pool was created with an explicit
`ssl: { rejectUnauthorized: false }`. Dev is fine.

**Why the explicit ssl is ignored:** `pg`'s `ConnectionParameters` does
`config = Object.assign({}, config, parse(config.connectionString))`
(`pg/lib/connection-parameters.js`). The values parsed **from the connection
string win** over the explicit config object. So if the URL carries
`?sslmode=require`, `pg-connection-string` sets `ssl = {}` (its default path
treats `require`/`prefer`/`verify-ca` as aliases for `verify-full`), and that
`{}` — `rejectUnauthorized` defaults to `true` → full CA verification —
overrides your explicit `{ rejectUnauthorized: false }`. Aurora/RDS presents a
cert signed by the AWS RDS CA that Node does not trust by default → the crash.

**Why dev doesn't hit it:** dev uses `sslmode=disable`, which parses to
`ssl:false` (no TLS at all), so there is nothing to verify and no conflict. Only
a TLS-required server (`sslmode=require`) exposes the bug.

**The rule:** if you compute the pg `ssl` config yourself and pass it
explicitly, you must **strip the ssl* query params from the connection string**
(`sslmode`, `ssl`, `sslcert`, `sslkey`, `sslrootcert`, `sslnegotiation`) before
handing it to `pg.Pool`. With no ssl* params present, `parse()` yields no `ssl`
key and your explicit config is the one that takes effect. Do NOT rely on
passing both and expecting the explicit one to win — it won't.

**How to apply:** anywhere a `pg.Pool`/`pg.Client` is built from a
connectionString that may contain `sslmode` while also passing an explicit `ssl`
object. Verify with `pg/lib/connection-parameters.js`'s `ConnectionParameters`
(construct it and inspect `.ssl`) rather than by connecting. `require` should
yield `{rejectUnauthorized:false}`, `verify-full` `{rejectUnauthorized:true}`,
`disable` `false`. Note pg-connection-string v3 / pg v9 will switch `require` to
libpq semantics — stripping the param makes us independent of that change.
