---
name: Flex toolbar width measurement
description: Browser layout quirk when fitting optional controls in a flex toolbar
---

When measuring free space for optional flex toolbar actions, do not add a computed `margin-left: auto` to the fixed cost of existing controls. Browsers can return its *used pixel width*, which already occupies all remaining space, so the calculated free width becomes zero even in a very wide editor.

**Why:** A measured toolbar appeared to have no available room at a wide viewport despite hundreds of free pixels. The auto margin had expanded to consume them.

**How to apply:** Include fixed child widths and ordinary margins, but exclude auto margins from the baseline cost; reserve a small gap/safety allowance and verify width changes in a real browser.