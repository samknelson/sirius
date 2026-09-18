---
name: Browser fixture lifecycle
description: Standalone Vite browser tests can mask assertion failures during shutdown; portal animations also affect keyboard focus.
---

Report browser failures before awaiting fixture-server cleanup, and bound cleanup with a referenced timeout.

**Why:** Vite shutdown waited on unfinished transforms after releasing its handles; Node exited with code 13, hiding the original navigation failure. A cold frontend compile also exceeded a short navigation timeout.

**How to apply:** For standalone browser runners, distinguish navigation time from interaction time and print the primary error before cleanup. After confirming or cancelling a Radix alert, wait until its portal disappears before typing into the underlying editor: value hydration can complete while the closing overlay still intercepts clicks.