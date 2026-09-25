---
name: Linked-image moves in contentEditable
description: Why direct template image movement must avoid the browser's native contentEditable drag.
---

When moving an image that is the only child of a link, move its anchor as the flow unit. Do not rely on the browser's native drag inside contentEditable: it may detach and relocate only the image, leaving its link behind. Treat pointer movement as provisional and commit one validated DOM insertion on release; cancellation must never mutate the document.

**Why:** A real Chromium pointer drag of a linked image stripped its surrounding anchor despite a custom drop handler. Synthetic drag-event tests alone did not expose this behavior.

**How to apply:** Any new image drag/drop or keyboard move path in the template visual editor should move the linked wrapper when it owns only that image, validate the target before insertion, and test with actual pointer movement as well as synthetic events.