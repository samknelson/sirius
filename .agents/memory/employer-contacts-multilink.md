---
name: Employer-contacts multi-link semantics
description: employer_contacts allows multiple links per (contact, employer) — one per type; authorization and consumers must handle multi-row results.
---

**Rule:** `employer_contacts` is MULTI-LINK (since 2026-08-05): a contact may hold
several links to the same employer, one per `contact_type_id`. Uniqueness is the
(contact, employer, type) triple — enforced at storage level only (no DB unique),
including the NULL-type case. The duplicate error message routes match on is
"This contact is already linked to this employer with this contact type".

**Why:** a fund ruling for the S1 migration (multi-type shop contacts would have
lost hundreds of type assignments under the old one-link-per-pair rule). The old
storage guard threw on ANY second link for the pair.

**How to apply:**
- Any consumer of `listByContactId`/`listByEmployer` may now see several rows per
  (contact, employer). Key UI rows by link id, dedupe employer/contact id lists.
- **Authorization:** contact-scoped routes (phone numbers, postal addresses) must
  NOT authorize against `employerContacts[0]` — that pick is order-dependent and
  was a real bug. Grant when the actor passes the policy for ANY linked employer:
  loop distinct employer ids with `checkAccessInline(req, 'employer.manage', id)`
  and 403 only if none grant. Follow this pattern for any new contact-scoped route.
- Retyping a link (`update` with `contactTypeId`) also collides with siblings —
  storage throws the same error; routes surface it as 409.
