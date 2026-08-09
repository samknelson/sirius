---
name: S1 deleted-node dangling references
description: History bundles keep field refs to deleted S1 nodes; *_unmapped rejects are often deletions, not loader gaps
---
Drupal 7 (S1) deletes nodes without cleaning `field_data_*` references held by other bundles, so long-lived history bundles (e.g. `sirius_trust_worker_benefit`) dangle on deleted nodes.

Benefit-history triage evidence (2026-08): 15,778 of 37,520 distinct relation refs pointed at deleted relationship nodes (→ 71,964 span rejects); benefit nid 2457521 deleted (6,863 rejects, exactly one benefit); every sampled `worker_unmapped` nid deleted; `subscriber_worker_mismatch` partner nids absent from worker id_map (likely deleted too).

**Why:** id_map coverage is ≈100% of *live* nodes, so `*_unmapped` rejects usually mean the referenced node no longer exists — identity unrecoverable, needs a fund allow-ruling (documented loss), not a loader fix.

**How to apply:** before suspecting a loader/mapping gap, LEFT JOIN the referenced nids to S1 `node` (`SUM(n.nid IS NULL)`); if deleted, pin the allow-ruling in RUNBOOK instead of chasing code.
