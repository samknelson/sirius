---
name: S1 docs blocked GitHub pushes
description: docs/s1-migration contains live S1 connection details; GitHub push protection rejects any history containing it
---
GitHub push protection on samknelson/sirius rejects EVERY push (any branch, force or not) whose history contains `docs/s1-migration/` or the strategy-revision attached assets — they hold live S1 MariaDB connection details. The rejection surfaces only as an opaque `PUSH_REJECTED` from gitPush; it looks like missing write access.

**Why:** 2026-08-03 all pushes failed until the docs were filter-branched out of the unpushed range; the very next push succeeded.

**UPDATE 2026-08-06:** `docs/s1-migration/` is now TRACKED — the current contents were verified credential-free (only the s1-schema.sql dump header held the full RDS hostname; scrubbed to `[redacted]`), and a fresh `git add` introduces only clean content into history, so push protection no longer applies to it. The raw pasted attachments (`attached_assets/06-strategy-revision*`, `Pasted--ledger-*`, `Pasted--payment-*`) held the prod RDS host and record-level prod exports; they were DELETED from disk and their gitignore patterns remain as tripwires against re-uploads.

**How to apply:**
- Never track raw pasted S1 evidence (the tripwire gitignore patterns); scrub full hostnames from any new dump/export before tracking.
- If a `PUSH_REJECTED` reappears, first check `git log <pushed-range> -- docs/s1-migration` and any other credential-bearing paths before suspecting permissions.
- Leftover `subrepl-*` branches from old task agents may still reference the pre-scrub history locally; that's harmless for pushes (only the pushed branch's ancestry matters) but don't merge those branches directly.
