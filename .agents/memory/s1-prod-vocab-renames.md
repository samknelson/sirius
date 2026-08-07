---
name: S1 prod vocabulary renames
description: Real S1 prod taxonomy vocabulary names differ from the synthetic dev DB; loaders keyed to synthetic names silently find zero terms in prod.
---

The synthetic dev MariaDB uses different vocabulary machine names than real S1
prod for the same terms. Known pairs (synthetic → prod):
- `grievance_industry` → `sirius_industry`
- `sirius_reltype` → `sirius_contact_relationship_types`
- `sirius_election_type` → `sirius_trust_election_type`

**Why:** first real-data rehearsal (2026-08-07) surfaced 29 unhandled prod
vocabularies; among them the election-type rename would have made T16's
coded remap silently see zero terms.

**How to apply:** any loader querying `s1_staging.terms` by vocabulary must
accept BOTH names (IN-list). When load-options fails with UNHANDLED
VOCABULARIES, first check whether it's a rename of an already-handled
synthetic vocab before ruling it out of scope. Out-of-scope prod vocabs
(grievance config, dispatch, events, skills, benefit/ledger types) are
documented skips in load-options KNOWN_SKIPPED.
