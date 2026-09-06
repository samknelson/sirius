---
name: Task dependency ordering hole
description: Why a late-planned consumer task can end up with no dependency on its prerequisites, and what to do about it.
---

A task's `dependsOn` may only name tasks that are already **accepted** (PENDING or
later), and dependencies **cannot be configured once the task is assigned** —
the attempt fails outright.

Those two rules combine into a trap. Plan a chain where the last task consumes
the output of one still sitting in Drafts, and you cannot declare the link at
creation time. By the time the prerequisite is accepted, the consumer may already
have been assigned, and then it is too late to declare it at all. The consumer
gets scheduled with an empty dependency list and arrives before anything it needs
exists.

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
