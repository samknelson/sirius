---
name: S1 relation-type letter-code sirius_ids
description: Relation-type options carry S1 letter codes (ES→EX override), not tids; EDI plugins match codes.
---

`options_worker_relation_type.sirius_id` must hold the S1 **letter code**
(C/SP/SC/DP/QMSCO/G/AC/RP/H/EX) from the taxonomy term's `field_sirius_id`
— every EDI carrier plugin matches these codes, and it is the ONE options
type where T4 does not stamp the tid.

**Why:** S1 code `ES` (Ex Spouse) collided with spouse-like `ES` entries in
carelon/hinge/vsp mappings — ex-spouses would have emitted as covered
spouses in carrier files. Ruling (2026-08-05): T4 rewrites `ES`→`EX` at
import; `ES` is banned from mapping lists; `EX` is explicitly never
spouse-like (emits blank/Other). `RP` is QMSCO-equivalent everywhere via
`isQmscoRelation` in provider-edi base (carrier code + no address
inheritance + QMSCO feed selection).

**How to apply:** anything consuming relation types (election loader,
validations, new EDI plugins) must key on letter codes, handle all 10
(incl. EX/RP), and never re-introduce `ES`. Full tid→code table + rulings:
`docs/s1-migration/02-mapping.md` §4.1 (prod pre-check: 07 §P7). Spouse/DP
carry Maximum Count=1 on the S1 term — candidate election validation, not
yet enforced.
