---
name: Break-glass admin from environment variables
description: What LOCAL_AUTH_EMAIL / LOCAL_AUTH_PASSWORD_HASH now promise, and the invariants any change to that boot step must keep.
---

# Break-glass admin account

The two variables state an END STATE, not a precondition: while both are set,
every boot guarantees the account exists (creating it), is active, holds a role
granting the `admin` permission, and carries that bcrypt hash. It replaced an
attach-only seeder that could not help a half-initialized database — the
interactive first-run screen closes as soon as ANY user row exists, so a
deployment with a few abandoned rows and an unknown password had no way back in.

**Invariants**

- Every refusal (provider not enabled, hash not a complete 60-char bcrypt
  string, email's local identity owned by another user) must be decided BEFORE
  the first write. Ownership conflicts discovered late mean the run already
  created and escalated an account while reporting "nothing was written".
- Validate the WHOLE hash, not the `$2x$NN$` prefix: a truncated or
  shell-expanded value produces exactly the same "invalid email or password"
  as a wrong password, which is the failure this refusal exists to catch.
- Each guarantee is checked before it is written, so a correct boot writes
  nothing and stays out of the log. A noisy log line therefore always means
  something changed.
- No transaction wraps the run; a partial failure is repaired by the next boot.

**Why it is not as locked down as it looks:** registered env vars are
overridable from the in-app admin environment screen, so the `admin`
permission — not just deploy access — can set these. It grants nothing that
holder does not already have, which is why the compensating control is
auditability (console block + storageLogger), not a denylist.

**Still open:** removing the variables does not revoke the account, and a
deployment with AUTH_LOCAL_PEPPER set will accept a pepper-less hash that can
never verify.
