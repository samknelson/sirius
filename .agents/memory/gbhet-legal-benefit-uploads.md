---
name: GBHET Legal benefit upload expectations
description: Required eligibility mapping and Legal-default policy for employer and staff uploads.
---

Monthly and correction GBHET Legal uploads require at least one mapped benefit eligibility column. Preselect the configured Legal benefit for missing associations, not the first active benefit. Preserve valid explicit or inherited associations.

**Why:** Employers were uploading without choosing a benefit mapping, so imports could omit eligibility records. The owner explicitly chose “Preselect the Legal benefit”; this does not mean populating blank eligibility cells.

**How to apply:** Keep the existing eligibility cell interpretation, three-month offset, and import modes. Obtain the default from enabled Legal charge configuration using its account-scoped employer overrides/global fallback. If surviving configurations do not agree on one active benefit, require an explicit choice rather than guessing by name or database ID.

Wizard readiness must check live benefit availability, not only stored progress or an old validation result.

**Why:** A stored association can refer to a benefit that is no longer available; an old “completed” flag must not authorize an import.

**How to apply:** Keep state checks and run-boundary validation aligned. Do not retroactively rewrite completed import history.

Blank hours and a standalone `-` mean zero in wizard uploads, including surrounding whitespace, not a required-value error or an omitted hours entry.

**Why:** The owner explicitly requested that blank hours and a `-` placeholder be treated as “0” in the Legal wizard and other wizards.

**How to apply:** Use the same interpretation during validation and processing, including when processing re-reads the original file. Preserve nonblank numbers and reject invalid nonblank values normally. Do not turn unrelated optional numeric fields into zero.

Legal upload completion recipients are the person who submitted the file plus
contacts at that employer whose contact types are selected in notification
settings; an empty type selection means uploader only.

**Why:** The owner explicitly confirmed this audience. The user who later
opens or processes a saved upload is not a substitute for the submitter.

**How to apply:** Preserve the effective uploader captured at file submission
(including masquerade), keep employer contacts employer-scoped, and use the
existing event-notifier/communications framework. Do not invent an uploader
for old drafts. Existing invoices are ledger account/month views, not separate
invoice records or a request for new invoice-generation infrastructure.
