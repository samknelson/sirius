---
name: S1 docs blocked GitHub pushes
description: docs/s1-migration contains live S1 connection details; GitHub push protection rejects any history containing it
---
GitHub push protection on samknelson/sirius rejects EVERY push (any branch, force or not) whose history contains `docs/s1-migration/` or the strategy-revision attached assets — they hold live S1 MariaDB connection details. The rejection surfaces only as an opaque `PUSH_REJECTED` from gitPush; it looks like missing write access.

**Why:** 2026-08-03 all pushes failed until the docs were filter-branched out of the unpushed range; the very next push succeeded.

**How to apply:**
- `docs/s1-migration/` and `attached_assets/06-strategy-revision*` are gitignored and must stay untracked. The files still live on disk (local working copy only) — never `git add -f` them.
- If a `PUSH_REJECTED` reappears, first check `git log <pushed-range> -- docs/s1-migration` and any other credential-bearing paths before suspecting permissions.
- Leftover `subrepl-*` branches from old task agents may still reference the pre-scrub history locally; that's harmless for pushes (only the pushed branch's ancestry matters) but don't merge those branches directly.
