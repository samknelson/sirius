---
name: Employer-contacts multi-link semantics
description: employer_contacts allows multiple links per (contact, employer) — one per contact type; authorization and consumers must handle multi-row results.
---

**Rule:** a contact may hold several links to the same employer — uniqueness is the
(contact, employer, contact type) triple, including the NULL-type case, enforced at
the storage layer (no DB unique constraint).

**Why:** fund ruling for the S1 migration — the old one-link-per-(contact, employer)
rule would have silently dropped hundreds of legitimate type assignments.

**How to apply:**
- Consumers listing links may see several rows per (contact, employer): key UI rows
  by link id and dedupe employer/contact id lists.
- **Authorization:** contact-scoped resources (phones, postal addresses) must never
  authorize against the first linked employer — link order is not authorization-safe.
  Grant when the actor passes the employer policy for ANY linked employer; deny only
  if none grant. Follow this pattern for every new contact-scoped route.
- Changing a link's type can collide with a sibling link; storage raises the same
  duplicate error and routes surface it as a 409.
