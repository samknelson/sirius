---
name: Browser fixture lifecycle
description: Standalone Vite browser tests can mask assertion failures during shutdown; portal animations also affect keyboard focus.
---

Report browser failures before awaiting fixture-server cleanup, and bound cleanup with a referenced timeout.

**Why:** Vite shutdown waited on unfinished transforms after releasing its handles; Node exited with code 13, hiding the original navigation failure. A cold frontend compile also exceeded a short navigation timeout.

**How to apply:** For standalone browser runners, distinguish navigation time from interaction time and print the primary error before cleanup. After confirming or cancelling a Radix alert, wait until its portal disappears before typing into the underlying editor: value hydration can complete while the closing overlay still intercepts clicks.

Assert initial viewport geometry before clicking or focusing the control being tested, and include the surrounding page chrome in layout fixtures.

**Why:** Browser automation can scroll an offscreen control into view before interacting with it, masking a first-load placement defect. An isolated sidebar without its normal-flow header can also pass while the real page fails.

**How to apply:** Check bounding rectangles and document scroll position before interaction; cover both saved menu states, variable-height headers, and asynchronous siblings above the tested layout. ResizeObserver reports size changes, not position-only shifts caused by newly inserted siblings.