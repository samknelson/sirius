---
name: Employer payment assignment authority
description: Approved all-assigned-employers scope for employer payment and saved-method permissions.
---

Employer self-service payments intentionally use permission plus current contact
assignment. A payment or methods permission covers every employer assigned to
that contact, regardless of former per-link grant flags. Do not reintroduce
per-employer exceptions, replacement flags, or automatic rights from Billing type.

**Why:** The approved simplification removes employer-by-employer grant
distinctions rather than relocating them. Legacy grants must not synthesize roles
or role memberships.

**How to apply:** Keep pay and method management independent, check live
assignments using the effective user's resolved contact, and do not delegate
authority to a generic employer policy's staff shortcut. Staff/admin identity
alone is not authority here; worker and separate administrator-on-behalf
workflows retain their own rules.
