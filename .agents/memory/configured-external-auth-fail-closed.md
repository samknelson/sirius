---
name: Configured external authentication fails closed
description: Preventing a configured external verifier from downgrading to default authentication when its component is unavailable.
---

Once a client selects an external authentication strategy, that saved selection is the authentication contract. Runtime component availability must not decide whether the strategy applies.

**Why:** Treating a disabled verifier component as “strategy not applicable” silently downgraded configured clients to the default secret or Basic path. The generated documentation still required external authentication, while runtime accepted weaker credentials.

**How to apply:** Resolve strategy applicability from durable client configuration alone. If its component, connection, or vendor is disabled or unavailable, keep the strategy selected and fail closed through a safe configuration-unavailable response. Never fall back to another credential mode.