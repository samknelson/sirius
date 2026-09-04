---
name: Counting served work off the response lifecycle
description: How to count "we did this work" for an inbound HTTP request without counting refusals, double-counting, or coupling the count to the caller's transaction.
---

A usage counter over inbound requests is a different question from the request
log, and the difference decides its shape: the log is per-request and pruned on
a retention schedule, the counter is a small bounded table that has to still
answer months later. Do not try to derive one from the other.

## The rule

Three separate decisions, each easy to get wrong on its own:

1. **Mark, don't infer.** Set an explicit flag on `res.locals` immediately
   before the handler is invoked, and count only when it is set. A status code
   cannot tell you whether work happened — a refusal and a handler that threw
   both come out 500/404-shaped, and a "reached the service" count must include
   the throw and exclude every refusal above it.
2. **Count on `close`, log on `finish`.** `finish` means we sent the whole
   response; `close` means the exchange is over either way, and fires exactly
   once in both cases. A caller who hangs up halfway through a long response
   still made us do the work, so the count belongs on `close`. The log keeps
   `finish` — a response nobody received has no status worth recording.
3. **Write outside the caller's transaction**, fire-and-forget, failure caught
   and logged. On the caller's client a failed upsert aborts the caller's
   transaction and turns a best-effort statistic into a fatal error; and a
   handler that later rolls back would erase the record of work that really
   happened.

**Why:** each of the three has a silent failure mode — counting refusals makes
"usage" include people probing the URL space, `finish` undercounts exactly the
expensive calls, and an in-transaction write either kills the request or
disappears with it.

**How to apply:** any per-day usage counter over a request pipeline. Dimensions
should be registry constants (plugin id, operation name) rather than
per-database record ids, so counts stay meaningful across environments and
survive the thing they name being retired; the one dimension that IS a record
(the calling client) is a cascading reference, because a usage count that
cannot say whose usage it was is not worth keeping.

Testing note: the atomicity of insert-or-increment is provable without a
database by asserting the statement's shape (one upsert, no prior read) and
tying its conflict target to the declared unique constraint via
`getTableConfig`. Be explicit in the test's prose that this proves shape, not
Postgres behavior under real concurrency.
