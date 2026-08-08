---
name: S1 load-options required-column gaps
description: Option tables with NOT NULL columns beyond name (e.g. gender.code) need explicit derivation in load-options' create path.
---

Staged S1 terms carry only name/weight/tid, but some options tables require more:

- `options_gender.code` is NOT NULL UNIQUE. Loader derives it: Male/Female → `M`/`F` (the Kaiser EDI plugin maps M→01, F→02, else→03), anything else → uppercased alphanumeric name (Non-Binary → NONBINARY).
- The "adopt by name" path must skip `options.update` when the patch is empty (types with no sequence/sirius_id column) — Drizzle throws "No values to set" on `{}`.

**Why:** both crashes only surfaced on the fresh Oregon target with a truncated id_map — the old target's id_map made every term take the matched path, so create/adopt paths were untested against real data.

**How to apply:** when mapping a new vocabulary in VOCAB_TO_TYPE, check the target table's schema for NOT NULL columns without defaults and derive them explicitly; never rely on the matched path having covered the loader in a prior run.
