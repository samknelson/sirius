---
name: Loader rerun reject-class stability
description: Fast-path skips must feed in-run dedup registries and resolution caches, or reject classes flip between runs
---

Rule: **a loader re-run over unchanged data must reproduce the same reject classes.** Daily syncs re-run every loader; any class flip turns an allowed reject into a disallowed one and fails the fleet gate every day after day 1.

Two ways this breaks, both hit in rehearsal:

1. **First-wins dedup registries skip fast-pathed winners.** employee-ids: on run 1 the duplicate-code winner claims the (shop,code) key and losers reject as `duplicate_code` (allowed). On run 2 the winner fast-paths on its unchanged fingerprint WITHOUT registering its claim, so the fp-less loser becomes the registry "first", reaches the S2 ownership check, and flips to `code_owned_by_other_worker` (disallowed). Fix: fast-path skip still registers the claim from staged fields (key the registry so no storage resolution is needed — shop nid, not type id).
2. **Resolution caches fed only on some dispositions.** load-options: the industry-by-tid cache was fed on the fast-path skip and on the wet id_map write, but not under dry-run/force-reconcile — so `--dry-run --force-reconcile` re-runs crashed resolution. Fix: feed intra-run caches on EVERY disposition that observes the row (including dry-run), not just paths that write.

**Why:** rejects never advance fingerprints, so rejected rows reprocess forever; their classification must not depend on which sibling rows fast-path this run.
**How to apply:** when adding any in-run registry/cache to a loader, trace every `continue` before it — fast-path, dry-run, reject — and ask whether skipping the bookkeeping changes a later row's outcome.
