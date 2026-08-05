---
name: Security scanner taint is file-local
description: How to structurally clear HoundDog/semgrep PII & secret findings
---

The PII-dataflow scanner (HoundDog) and semgrep secret rules track taint within a single file only.

**Why:** Logger calls that only log `worker.id` still flag CRITICAL SSN when the worker was fetched via `getWorkerBySSN` in the same file; `bcrypt.hash(randomHex, ...)` flags "hardcoded secret" because the `'hex'` literal in `crypto.randomBytes(n).toString('hex')` propagates to the bcrypt call.

**How to apply:** Move the sensitive step into its own module — e.g. `server/auth/identity-verification.ts` does the SSN parse/lookup with NO logging and returns only non-sensitive fields (workerId, match booleans); `server/utils/random-token.ts` generates random hex away from bcrypt imports. Callers then log freely. Never add logger calls or SSN returns to identity-verification.ts. Remaining accepted mediums: IP addresses in request/audit logs (needed for abuse investigation) — marked with "PII triage (accepted)" comments.
