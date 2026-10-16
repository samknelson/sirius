---
name: Browser fixture lifecycle
description: Standalone Vite browser tests can mask assertion failures during shutdown; portal animations also affect keyboard focus.
---

Keyboard events do not cross an iframe's document boundary.

**Why:** Preview interaction can leave focus inside the child document. Parent-dialog dismissal and child-document keyboard behavior are separate contracts.

**How to apply:** Test parent-owned controls in the parent document rather than assuming a page-level keyboard event reaches them.

Report browser failures before awaiting fixture-server cleanup, and bound cleanup with a referenced timeout.

**Why:** Vite shutdown waited on unfinished transforms after releasing its handles; Node exited with code 13, hiding the original navigation failure. A cold frontend compile also exceeded a short navigation timeout.

**How to apply:** For standalone browser runners, distinguish navigation time from interaction time and print the primary error before cleanup. After confirming or cancelling a Radix alert, wait until its portal disappears before typing into the underlying editor: value hydration can complete while the closing overlay still intercepts clicks.

Authenticated fixtures must wait for both resolved authentication and the hydrated user before mounting a protected route.

**Why:** A fixture that mounts protected routing immediately can navigate to sign-in between a successful mocked auth response and context hydration. That is a fixture readiness failure, not evidence of denied staff permissions.

**How to apply:** Keep the real route guard; gate fixture mounting on the auth context's ready/authenticated answer. After closing help or other Radix dialogs, wait for the whole dialog portal and body pointer lock to clear before clicking the next control.

Separate browser-launch failure from page failure in fixture diagnosis.

**Why:** The browser wrapper could report a valid version yet fail to expose its debugging endpoint; a different executable completed the same fixture. The default launch timeout also proved too short under load.

**How to apply:** When a fixture times out before navigation, check the browser binary and launch timeout before changing app code or layout assertions.

Assert initial viewport geometry before clicking or focusing the control being tested, and include the surrounding page chrome in layout fixtures.

**Why:** Browser automation can scroll an offscreen control into view before interacting with it, masking a first-load placement defect. An isolated sidebar without its normal-flow header can also pass while the real page fails.

**How to apply:** Check bounding rectangles and document scroll position before interaction; cover both saved menu states, variable-height headers, and asynchronous siblings above the tested layout. ResizeObserver reports size changes, not position-only shifts caused by newly inserted siblings.

Compare rich-editor output at the persistence boundary, not raw live `innerHTML`, and wait for the specific preview request containing the new content rather than the first preview frame.

**Why:** The browser's CSS serialization can add whitespace and semicolons that the editor's normalized saved HTML omits. A previous preview frame can already exist while a debounced new PDF request has not run.

**How to apply:** In browser fixtures, assert image identity and structure across saved/reopened values; for an asynchronous preview, observe its incoming request or rendered document tied to the changed source before claiming success.
After changing a dialog between regular and maximized layouts, let its transform/position transition settle before testing real pointer hits on a menu.

**Why:** During the transition, the automation target can move between hit-test and click; the menu remains visibly open while the pointer lands on a different row.

**How to apply:** Wait for stable dialog geometry before pointer-interaction assertions in both layout modes; a visible selector alone does not prove the position is stable.

Standalone Vite browser fixtures rooted at the workspace may exhaust Linux file watchers by traversing the hidden local package store; ignore `.local` in fixture watch settings.

**Why:** A layout fixture failed before rendering with ENOSPC while Vite watched cached package-store files unrelated to the app.

**How to apply:** Scope or ignore hidden local dependency stores in new Vite fixture servers; when a cold compile is slow, wait for DOM readiness and the target element rather than requiring network-idle.

Cold navigation to a full production page in an isolated Vite fixture can exceed the browser's default 30-second navigation timeout even while individual module requests answer.

**Why:** A full Summary/layout fixture repeatedly timed out before HTML delivery but completed all interaction and layout checks with a bounded 120-second navigation budget; the app itself was healthy.

**How to apply:** Allow a bounded cold-navigation budget, then wait for the specific UI. Keep assertions at normal short timeouts and fail explicitly on unexpected API calls rather than weakening the checks.

For CSS `auto-fit` grids, computed `gridTemplateColumns` can include collapsed zero-width tracks.

**Why:** A four-tile grid reported five computed tracks even though only four tracks had width and all tiles were contained.

**How to apply:** In layout tests, count nonzero tracks and assert element geometry, not the raw space-separated track count.
