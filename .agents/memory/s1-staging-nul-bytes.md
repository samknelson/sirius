---
name: S1 staging NUL bytes
description: Real S1 prod data contains NUL (\u0000) chars; Postgres rejects them in text/jsonb (22P05); staging strips them at the write boundary.
---

Real S1 production data (observed in sirius_log JSON blobs) contains NUL
(`\u0000`) characters. Postgres cannot store NUL in `text` or `jsonb` —
inserts fail with error 22P05.

**Why:** the first full-stage rehearsal run crashed ~12h in on this.

**How to apply:** staging's write boundary (lib/staging.ts) deep-strips NUL
from every string (values AND keys) in all staged columns and jsonb, counts
affected values, and reports `nul-sanitized: N` in stage output + run report.
This is the ONE documented exception to "verbatim" staging. Any NEW staged
column or table must route through the same sanitizers, and any new script
writing source-derived strings to Postgres must assume NUL can appear.
