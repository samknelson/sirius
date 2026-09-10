---
name: Task dependency ordering hole
description: Why a late-planned consumer task can end up with no dependency on its prerequisites, and what to do about it.
---

Dependencies **cannot be configured once the task is assigned** — the attempt
fails outright. Assignment, not acceptance, is the real deadline: pointing a
Drafts task's `dependsOn` at another Drafts task does work.

That single rule is still a trap. Plan a chain, hand the consumer over while a
prerequisite is unfinished, and the link can no longer be declared at all — the
consumer is scheduled with an empty dependency list and arrives before anything
it needs exists.

**Why:** it happened on the catalog chain — the browser task could not be pointed
at the read-route task during planning, and was later handed over while both of
its prerequisites were still queued.

**How to apply:** when planning a chain, create the whole chain in ONE batch and
use batch aliases in `dependsOn` — aliases work freely within a batch and sidestep
the accepted-only rule entirely. If a task must be added to an existing chain
later, wire its dependency the moment its prerequisite is accepted, before it can
be assigned. If one still arrives out of order, do not build it against absent
prerequisites and do not mark it complete: say what is missing and let the user
reorder.
