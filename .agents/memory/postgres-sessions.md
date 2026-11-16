---
name: Postgres session boundaries
description: Index of connection initialization and idle-session activity decisions.
---

- [Checkout initialization](postgres-checkout-initialization.md) — database session setup must finish before handing a connection to its borrower.
- [Idle-session status](idle-session-status-checks.md) — reading a deadline must not renew it.

**Why:** Connection readiness and user activity are separate guarantees; background checks must not silently change either.

**How to apply:** Consult the relevant linked decision before changing connection setup or session polling.
