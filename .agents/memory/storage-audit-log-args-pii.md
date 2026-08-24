---
name: Storage audit log args PII
description: Logged storage methods persist raw call args into winston_logs; use logArgs/shouldLog hooks.
---

The storage logging middleware persists each logged method's full `args` array verbatim into the `winston_logs` table (`meta.args`), on success AND error paths.

**Why:** Enabling logging on `upsertSession` would have stored the entire express/passport session payload (identity, possibly provider tokens) in audit logs — flagged as a serious leak in review.

**How to apply:** When enabling logging on any method whose args carry payloads (session data, credentials, big blobs), set the per-method `logArgs: (args) => [...projected]` projection to redact them. Use `shouldLog: (args, result) => boolean` for conditional logging (e.g. upserts that log only on insert — detect insert via `RETURNING (xmax = 0)`). Both hooks live in `MethodLoggingConfig`.

Attribution: `getHostEntityId` puts an entry on an account log. Only ever use internal user ids (resolved dbUser.id), never external provider subjects (claims.sub) — misattribution risk. For deletes, derive the owner atomically from `DELETE ... RETURNING` (a pre-delete read races with concurrent row replacement).

Ownership-transition logging (sessions pattern): to log "owner changed" events from an upsert, capture the prior owner with SELECT ... FOR UPDATE in the same transaction as the overwrite — a snapshot CTE alongside INSERT ON CONFLICT can diverge from the row actually replaced under concurrency. Passport's req.logout() strips the identity via a session save BEFORE destroy, so logout attribution must come from the strip-upsert transition, not the delete.

Also: prune-style "scan candidates then delete" loops must re-qualify the predicate atomically in the DELETE (`WHERE id = X AND still-expired`), or a row renewed between scan and delete gets wrongly removed.
