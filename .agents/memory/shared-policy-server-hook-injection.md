---
name: Shared access-policy → server hook injection
description: How shared/access-policies files reach server-only registries without importing server code
---

Shared access-policy modules are bundled into the client, so they must never
import server registries. For new component-owned alterations, use the shared
typed alter framework rather than inventing another resolver setter. Existing
bespoke resolver consumers are not automatically in scope for migration.

**Why:** direct import would pull server code into the client bundle. The owner
chose incremental extraction, not wholesale component packaging or a new plugin
framework. An unwired authorization boundary must fail closed.

**Also:** when a policy branch replaces a dedicated per-context route, it
must be authoritative — placed before generic shortcut grants (uploader /
staff / broad permissions), returning grant-or-deny, so access is exactly
what the old route allowed.

**How to apply:** keep declarations shared and implementations server-owned;
register regardless of enabled state and gate execution through injected
availability. Preserve each consumer's authority contract: a grant-preserving
extension must not become the template for an authoritative veto boundary.
Use the existing alter-hook documentation for the lifecycle and API.
