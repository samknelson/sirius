---
name: Alternate tax identity policy
description: Owner-confirmed review and correction boundaries for SSN-column imports.
---

Shared placeholders require review through the existing import correction
surface, not automatic matching, automatic creation or an override queue.
An unmatched identifier does not establish that someone is new.

**Why:** The owner explicitly required review for identifiers shared by unrelated
people. Structural SSN validation is not issuance or ownership verification.

**How to apply:** Preserve this boundary in future import paths. Never add
name-only matching or automatic reconciliation between an unrelated new SSN and
an alternate-only record. Corrected SSNs belong on the worker staff identified;
retaining that worker's alternate ID is intentional. Historical bulk conversion
and the configurable ratings lookup are outside this matching policy.
