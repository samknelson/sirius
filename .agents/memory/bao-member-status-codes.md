---
name: BAO member status scan code prerequisite
description: The BAO member status scan resolves options by code; dev DB options lack codes/industry links.
---
The BAO member status scan (`bao-member-status-scan` cron) resolves status options by `options_worker_ms.code` (EC100/EC80/H60 auto-set; EC60/P100/H40 manual, never touched) and derives each target industry from the option's own industry link.

**Why:** Names vary and industries must not be hardcoded; the scan fails explicitly ("configuration incomplete") when EC100/EC80/H60 codes are missing.

**How to apply:** The current dev DB's worker-ms options have NULL codes and all point at Hospitality — the scan will error there until codes/industry links are set (prod data must carry them). Smoke test seeds its own coded options inside a rolled-back tx (`scripts/oneoffs/bao-member-status-scan-smoke.ts`).
