---
name: Freeman worker ID precedence
description: Identity precedence when Freeman supplies both an employee EIN and a Teamsters 631 ID.
---

Use the normalized Freeman EIN as the authoritative worker match. Only query the normalized T631 ID when EIN has no match. If EIN matches, use that worker even when the supplied T631 ID belongs to a different worker; do not reject, move, or duplicate the T631 ID.

**Why:** The owner explicitly rejected cross-ID conflict failures. These identifiers are ordered evidence, not co-equal identifiers that must agree.

**How to apply:** Strip non-numeric characters before comparison. Preserve ambiguity refusal within the ID type currently being used. If EIN has no match and T631 does, use the T631 worker and attach the unmatched EIN when safe. Create a worker only when neither type matches.