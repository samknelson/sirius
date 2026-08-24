---
name: Credentials leak through two logging paths, not one
description: Any bearer-like value stored on an entity must be redacted in BOTH the storage audit payload and the API response preview; both persist to winston_logs.
---

A value that grants access on its own (an access UUID a link carries, a share
token, a one-off code) reaches `winston_logs` — readable in the admin log
viewer — by **two independent paths**. Closing one is not a fix.

1. **Storage audit payload.** The logging middleware persists `meta.args`,
   `meta.before`, `meta.after`, and the `meta.changes` diff derived from them.
   `logArgs` only projects the arguments; the before/after hooks are a separate
   leak carrying the whole row.
2. **API response preview.** The request logger stringifies every `/api`
   response body into `meta.responsePreview` through a redactor that matches an
   allowlist of **exact lowercased key names**. A new credential field is not
   covered until its name is added there.

A human-readable description that omits the value mitigates neither path.

**Why:** the audit trail's job is to record *that* a credential changed and who
changed it — never its value. Anyone able to read the log could otherwise mint
a working link for a subject they are not allowed to act for.

**How to apply:** project the row to identifiers plus presence booleans
(`hasX: boolean`) and log that shape from the before/after hooks. The booleans
double as what descriptions need to tell "issued" from "replaced", so no
unredacted variant has to exist anywhere. Add the field name to the response
redactor's list in the same change.

Verify with a canary, not by reading code: write a distinctive value through
every mutating path, then scan the whole table —
`SELECT ... FROM winston_logs WHERE meta::text LIKE '%CANARY%'` — and require
zero rows.
