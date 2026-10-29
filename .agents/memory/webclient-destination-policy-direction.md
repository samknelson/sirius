---
name: Webclient destination policy direction
description: Owner-selected architecture for manifest defaults and deployment overrides governing vendor destinations.
---

Vendor destination restrictions belong inside the existing webclient framework, not a parallel outgoing-request architecture. Plugins may declare a required allowlist and defaults; a deployment policy can replace defaults and can constrain optional plugins too.

**Why:** the owner wants the vendor declaration to supply safe defaults while keeping deployments able to choose destinations, without duplicating the framework already wrapping vendor operations.

**How to apply:** use stable plugin IDs, replacement rather than union semantics, and actual request-time enforcement. The owner requested wildcard subdomain defaults for Freeman and Teamsters631. Preserve normal environment precedence and the existing no-privileged-variable-denylist decision.

Keep destination refusals sticky across the complete vendor invocation, not
just exceptions from an individual transport call.

**Why:** legacy handlers intentionally catch request errors and can otherwise
convert a security refusal into a successful, cacheable answer.

**How to apply:** remember refusals in the invocation-bound HTTP capability and
rethrow after the handler, before the framework records counts or cache state.
An unadapted browser/SDK must refuse active policies rather than claim to enforce
an allowlist on only its initial URL.

Private-network support must be a generic policy available to any vendor, not
a Freeman-specific exception or environment-specific code.

**Why:** the owner explicitly rejected baking a Freeman exception into code
after the deployment's intended endpoint resolved to private addresses.

**How to apply:** the owner approved an explicit per-plugin private-address
opt-in within the existing deployment policy, retaining public-only behavior
for old entries and no individual IP/subnet lists. Continue blocking loopback,
link-local and cloud metadata endpoints; permitting private networks is not
permission for every non-public address.
