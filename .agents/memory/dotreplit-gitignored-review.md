---
name: .replit is gitignored — workflow changes invisible to task review
description: How to land .replit workflow changes when the completion code review only sees the git diff
---

**Rule:** In this repo `.replit` is gitignored (like the deploy branches' convention), so workflow additions/edits never appear in a task's git diff. The completion code review will reject with "the workflow is absent from the commit" even though the change is live.

**Why:** Completion review audits the committed diff only; `.replit` changes are delivered via the environment config (verifyAndReplaceDotReplit), not git — same as the pre-existing Push to bao-dev/bao-prd blocks.

**How to apply:** After changing `.replit`, verify the workflow shows up in the configured-workflows list, then call markTaskComplete with a `drift_reason` explaining that `.replit` is gitignored by repo policy and the change is persisted in the environment. Also watch for auto-attached `attached_assets/Pasted-*` logs sneaking into task commits — remove them before completing.
