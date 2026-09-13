---
name: WC vendor declaration contract
description: Framework ownership rules for web-client vendor operation metadata and credential references.
---

Keep one source for a vendor's operation identities and metadata; do not create parallel action and description catalogs.

**Why:** Parallel operation lists drift silently. A generic declaration must also preserve operation-specific TypeScript checking and the maintenance lint's ability to see outbound handlers; abstraction helpers must not erase those checks.

**How to apply:** Any abstraction must preserve operation-specific type checking and static maintenance-guard analysis. If it weakens either, prefer a directly typed declaration.

Credential references are framework concerns; credential value formats are vendor concerns.

**Why:** Secret-name plumbing is identical across vendors, while credential value formats are vendor-specific. Keeping these boundaries separate avoids duplicated lookup behavior without moving secret values into configuration storage.

**How to apply:** Keep secret values outside configuration storage. A credential-free vendor must not expose or retain a reference field. Operation write gates also apply to in-process vendors.