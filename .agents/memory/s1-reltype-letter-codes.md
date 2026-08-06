---
name: S1 relation-type letter-code sirius_ids
description: Relation-type options carry S1 letter codes (ES→EX override), not tids; EDI plugins match codes.
---

`options_worker_relation_type.sirius_id` must hold the S1 **letter code**
(C/SP/SC/DP/QMSCO/G/AC/RP/H/EX) from the taxonomy term's `field_sirius_id`
— every EDI carrier plugin matches these codes, and it is the ONE options
type where T4 does not stamp the tid.

**Why:** S1 code `ES` (Ex Spouse) collided with spouse-like entries in
carrier mappings — ex-spouses would have emitted as covered spouses in
carrier files. Fund ruling: `ES` rewrites to `EX` at import and is banned
from mapping lists; `EX` is never spouse-like or self (emits blank/Other).
`RP` is QMSCO-equivalent everywhere (use the shared QMSCO predicate in the
provider-edi base rather than per-plugin string lists).

**How to apply:** anything consuming relation types (election loader,
validations, new EDI plugins) must key on letter codes, handle ALL codes
including EX/RP, and never re-introduce `ES`. A new carrier mapping that
omits EX/RP silently classifies them as self/subscriber — add explicit
cases and cover them in the reltype smoke test. Full tid→code table +
rulings: local `docs/s1-migration/02-mapping.md` §4.1.
