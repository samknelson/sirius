---
name: Loader writes precede the reject gate
description: S1 loaders perform all writes, then exit 1 on disallowed rejects — a "failed" run has already mutated S2.
---
The S1 loaders write as they scan; the `--allow-rejects` gate only decides the exit code at the very end.
**Why:** a harness that runs without allowances, sees exit 1, and retries with allowances gets a second-run report with zeroed create/correction counters — the first attempt already did the work.
**How to apply:** determine the expected reject classes up front (a dry run reports them without writing) and allow them on the FIRST real run whenever the report's counters matter.
