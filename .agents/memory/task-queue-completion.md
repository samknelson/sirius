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

A main-chat-directed task may still be queued while the conversation remains in Plan mode. A queued menu offering background execution does not mean the owner originally selected background execution.

**Why:** The owner selected "build here", but the resulting main-directed queued entry still offered only background execution or cancellation; the conversation had not switched modes or received an active assignment.

**How to apply:** Inspect execution destination, active assignment, and the current conversation mode separately. Do not ask the owner to select background execution to repair this handoff, and do not promise that switching mode alone guarantees activation.

In Build mode, `markTaskInProgress({taskRef})` can activate a main-directed queued task, not only resume an implemented one.

**Why:** The skill describes only resuming implemented work, but a verified call on a main-directed queued task returned an active main assignment. Earlier conclusions that there was no available activation control were incorrect.

**How to apply:** An explicit "build here" request in Build mode is the go-ahead; do not ask for another confirmation. Activate through this callback before writing code, confirm the returned assignment is active in the main project, then implement and call completion for that same task. A queue update alone is not authorization. If activation is rejected, explain the actual rejection rather than recommending duplicate background work or claiming no activation control exists.
