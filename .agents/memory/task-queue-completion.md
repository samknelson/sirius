---
name: Queued task completion boundaries
description: Avoid unsupported task-start advice and duplicate execution when work was built directly but its queue entry never activated.
---

Direct implementation in chat can leave its task entry queued rather than assigned as active; the completion control then refuses it. Do not assume a queued task has a local-start action, and do not recommend background execution solely to repair its status.

**Why:** Repeated completion attempts were rejected, and the owner reported that the queued-task menu offered only build in the background or cancel. Earlier advice to start it here was not supported by that UI.

**How to apply:** Check the current task state and the controls actually available to the user before giving instructions. If completed code already exists, distinguish code completion from task tracking. Obtain consent before changing downstream dependencies for queue cleanup, and explain that cancelling archives an entry rather than recording successful completion.
