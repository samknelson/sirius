---
name: Webclient destination policy direction
description: Owner-selected architecture for manifest defaults and deployment overrides governing vendor destinations.
---

Vendor destination restrictions belong inside the existing webclient framework, not a parallel outgoing-request architecture. Plugins may declare a required allowlist and defaults; a deployment policy can replace defaults and can constrain optional plugins too.

**Why:** the owner wants the vendor declaration to supply safe defaults while keeping deployments able to choose destinations, without duplicating the framework already wrapping vendor operations.

**How to apply:** use stable plugin IDs, replacement rather than union semantics, and actual request-time enforcement. The owner requested wildcard subdomain defaults for Freeman and Teamsters631. Preserve normal environment precedence and the existing no-privileged-variable-denylist decision. This records the agreed planning direction, not evidence that enforcement has shipped.
