---
name: Browser verification transport
description: Browser launch, isolated real-component fixtures, and stylesheet handling for UI verification.
---

For Puppeteer verification in this workspace, use the pipe transport when browser launch waits indefinitely for a debugging endpoint on stdout.

**Why:** Browser binaries available in the workspace could launch, but the default endpoint discovery timed out; `pipe: true` completed the same checks. This is a browser-launch issue, not an app readiness failure.

**How to apply:** For isolated browser checks, prefer pipe transport over repeatedly changing browser binaries. Signed-in UI behavior can be exercised with synthetic API responses intercepted only in the test browser; never add a server authentication bypass or change saved component enablement for verification.

The DevTools pipe is also usable directly if no browser automation package is installed.

**Why:** This workspace can have Chromium on PATH without Puppeteer or a native Node WebSocket implementation. Direct pipe commands avoid adding dependencies just for a one-off check. Serializing a React-owned DOM node by value can fail with “Object reference chain is too long.”

**How to apply:** Use the browser's null-delimited JSON pipe protocol with child-process file descriptors 3 and 4. Return booleans or plain data, never DOM nodes, from evaluations (including open/close checks). Bundle real components and use browser-only fixture data, never an application auth bypass.

Process a standalone bundle's CSS with the existing PostCSS/Tailwind pipeline before using its screenshots for visual verification.

**Why:** Esbuild bundles CSS but does not expand Tailwind directives; an otherwise working fixture appears entirely unstyled.

**How to apply:** Reuse the project's existing style configuration, not hand-authored replacements.

Resolve the browser executable from PATH before searching the filesystem.

**Why:** Recursive searches and even wildcard listings of the Nix store stalled for minutes during browser verification, although a browser was already on PATH.

**How to apply:** Try `command -v chromium` first. Avoid traversing the entire Nix store just to locate a test executable.

For small signed-in component and navigation-count checks, prefer an isolated
bundle of the actual components with browser/session fixtures rather than
hand-authored imports into Vite's transformed development modules or stubs of
Vite's runtime exports.

**Why:** Hand-authored module imports bypass Vite's CommonJS interop and React
refresh setup, and dependency URLs depend on the server's configured root. The
development SPA can also perform unrelated document navigations; stubbing its
hot-reload runtime can prevent rendering entirely. These harness failures can
obscure otherwise-working application behavior.

**How to apply:** Keep fixtures outside application authentication and outside
the permanent UI suite. Bundle with automatic JSX, exercise the real WebSocket
handler and shared UI, and inspect the rendered result.

For centered Radix dialog fixtures, do not retain browser element handles
across preview changes or dialog close/reopen transitions. Prefer independently
seeded dialog states when checking separate flows.

**Why:** Replacing a tall preview moves the centered dialog while close
animations and focus restoration are still running. Fixture pointer clicks
can silently hit the wrong position or use a detached node, despite the
application handler working correctly.

**How to apply:** Wait for the prior dialog to finish closing, query the current
element again, and separate export checks from an import-dialog closing flow.
Distinguish automation timing failures from application failures in the report.
