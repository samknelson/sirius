---
name: HoundDog log-PII remediation
description: What actually clears HoundDog "email/name/address sent to Logs" findings — and what doesn't.
---

Masking does NOT clear HoundDog findings. Any flow from a sensitive-named
identifier (`email`, `firstName`, `address.street`, …) into a recognized sink
(`logger.*`, `console.*`) in the same file is flagged, even through a
cross-module mask helper (`maskEmail(email)`), a hoisted renamed const, or a
boolean coercion (`!!contactEmail`, `!!req.body?.email`).

**How to apply:** to reduce the count, remove the sensitive identifier from the
log flow entirely — log stable ids instead (userId/workerId/contactId/commId,
provider externalId for pre-account auth attempts, recipient counts for
senders); address fields and staff-supplied free text (subjects, descriptions)
stay out of logs entirely. For genuinely acceptable sites (synthetic seed
data, boolean flags named `results.email`), add a "PII triage (accepted…)"
comment; those still count in the scan but are documented (matches the
accepted-medium IP precedent in logger.ts/app-init.ts).

**Why:** masking/renaming does not break the scanner's identifier dataflow, so
only removing sensitive identifiers from log flows clears findings. Also audit
failure/early-return log paths and free-text fields (e.g. staff-entered email
subjects), not just the happy-path send log.
