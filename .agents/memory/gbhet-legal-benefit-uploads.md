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
