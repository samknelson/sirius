---
name: Carrier EDI reference convention
description: Where carrier eligibility-file specs, layout pins, and golden tests live, and the Delta rulings.
---

# Carrier EDI reference convention

Rule: every trust-provider EDI carrier gets (1) a spec-transcribed doc in
`docs/edi/` (template in `docs/edi/README.md`), (2) a layout pinned in
`tests/edi/fixtures/legacy-layouts.ts` (the shared conformance suite FAILS
any registered plugin without one), and (3) a carrier golden suite
`tests/edi/<carrier>-edi.test.ts`. Never derive the pinned layout from the
plugin source — transcribe it from the carrier spec.

**Why:** these files are parsed by byte offset by third parties; a
plugin-derived fixture proves nothing, and undocumented blank fields get
"fixed" with invented data later.

**How to apply:** when correcting or adding a carrier plugin, start from
the Delta entry (`docs/edi/smf-delta-dental.md`) as the model. Optional
carrier fields with no authoritative S2 source stay blank and get a
rationale row plus an "open carrier questions" entry.

Delta specifics worth keeping: handbook is the Enterprise SFL Traders
Handbook ver 1.1 (2,000-byte records; trailer count includes header +
trailer); QMSCO/RP → classification 13 is an established SMF arrangement
even though the handbook labels 13 "Non-Covered Subscriber" — recorded as
an open carrier question, do not "fix" it unilaterally. The .doc handbook
loses table rows under antiword/ReadFile; recover full field tables with
`strings` on the raw file.
