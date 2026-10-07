---
name: Queued task completion boundaries
description: Main-thread task proposals, user-selected background execution, and avoiding mismatches between completed code and queued task records.
---

Direct implementation in chat can leave its task entry queued rather than assigned as active; the completion control then refuses it. Do not assume a queued task has a local-start action, and do not recommend background execution solely to repair its status.

**Why:** Repeated completion attempts were rejected, and the owner reported that the queued-task menu offered only build in the background or cancel. Earlier advice to start it here was not supported by that UI. The owner explicitly requires a completed record for finished work; cancellation is not an acceptable replacement.

**How to apply:** Check the current task state and the controls actually available to the user before giving instructions. If completed code already exists, distinguish code completion from task tracking. When the owner requests a completed record, do not offer cancellation or dependency removal as a substitute. Do not rerun the feature solely to repair tracking or claim completion when the task system rejects it.

All project task proposals belong in the main conversation as standard draft cards. Background execution is the owner's choice through "build in the background", not a routing decision to make for them.

**Why:** The owner explicitly clarified this project's workflow after confusion between direct chat implementation, queued task records, and a dependent background task.

**How to apply:** Propose without starting work. Before implementing a tracked task here, verify that its assignment is recognized for this session; if not, explain the tracking limitation before changing code. Never start duplicate work alongside an existing background task. Dependency edits can release accepted queued work automatically, so make that consequence clear and obtain consent before releasing a background job.
