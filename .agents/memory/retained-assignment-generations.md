---
name: Retained assignment generations
description: Preventing stale EDLS writes after a cleared assignment is refilled under the same row ID.
---

An EDLS assignment row is durable across clearing and refilling. Its ID, worker, and date identify the long-lived record, **not** a particular active assignment. Every fill must have a fresh generation; clearing removes it. All writes originating from a previously read assignment (staff edits/removals, worker answers, and outbound message receipt writeback) must match the generation observed with that assignment.

**Why:** Crew and row ID are insufficient: clearing and refilling into the same crew restores both values. A delayed removal, public answer, or SMS receipt from the old filling could then modify the new filling; an old receipt could suppress the notification that the worker is owed.

**How to apply:** When adding an assignment action, carry the generation from the read or event snapshot into a conditional write. Do not fetch the current generation on behalf of a stale request or infer it from crew ID. Bulk lifecycle operations should use the generation read for each active row.