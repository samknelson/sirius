---
name: Worker Comms Compliance purpose
description: Owner's purpose and population semantics for tracking tagged worker communications.
---

Worker Comms Compliance is intended to track distributions such as SPDs and statements by checking whether workers in a defined population have communications with a chosen comm tag. The owner requires multi-select member statuses and benefits: any selected status combined with any selected benefit, plus the population's other filters. Workers must be enqueueable into new or existing bulk messages from the results.

**Why:** The owner needs to identify distribution gaps and act on the same worker list, not merely count communications globally.

**How to apply:** Preserve the worker-population-to-tagged-comm relationship across dashboard counts, report results and bulk selection. Do not treat queueing a recipient as evidence that the communication has been received.

The first version intentionally uses current-month benefit eligibility, not historical enrollment or an enrollment-relative distribution deadline.

**Why:** The agreed starting point is the worker list's population semantics; historical cohorts are a separate product decision rather than a different interpretation of the same filter.

**How to apply:** Keep the benefit month explicit in report and dashboard presentation. Do not silently change benefit filters into historical matching when extending the compliance criteria.

The owner subsequently requested explicit benefit-history choices: ever had a
selected benefit, had it in the last N months (for example six), or had it
between specified dates (for example January 1 through December 31, 2025).
These are benefit-population windows, separate from communication sent dates.

**Why:** Distribution tracking must include former benefit recipients, not
only workers who still qualify in the current month.

**How to apply:** Add explicit historical modes without silently changing old
definitions. Explain the monthly granularity of the source and keep dashboard,
report results and bulk-message recipient selection on the same cohort.

Historical matching uses any selected benefit in any one included month, not
continuous coverage throughout the window. A last-N-month window includes the
current site-calendar month plus N-1 preceding months; explicit date ranges
include any overlapping benefit month, with both endpoints inclusive.

**Why:** The approved history-filter scope extends the existing monthly benefit
population model; it does not claim daily enrollment precision or add a
communication deadline relative to enrollment.

**How to apply:** Keep the resolved period visible and retain current-month
behavior for definitions without an explicit history choice. Communication
sent-date filters remain independent of the benefit-population period.

The owner shares this component with a related, expanded codebase and wants
the two codebases to remain easy to merge.

**Why:** Independent copies that rename the component or replace shared
frameworks make later reconciliation harder.

**How to apply:** Preserve canonical component identity and source paths.
Transfer shared-framework changes surgically, retain a known source baseline,
and keep target-specific additions rather than overwriting complete files.
