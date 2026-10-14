---
name: Browser verification transport
description: Puppeteer transport behavior in the Replit workspace during signed-in fixture checks.
---

For Puppeteer verification in this workspace, use the pipe transport when browser launch waits indefinitely for a debugging endpoint on stdout.

**Why:** Browser binaries available in the workspace could launch, but the default endpoint discovery timed out; `pipe: true` completed the same checks. This is a browser-launch issue, not an app readiness failure.

**How to apply:** For isolated browser checks, prefer pipe transport over repeatedly changing browser binaries. Signed-in UI behavior can be exercised with synthetic API responses intercepted only in the test browser; never add a server authentication bypass or change saved component enablement for verification.

Resolve the browser executable from PATH before searching the filesystem.

**Why:** Recursive searches and even wildcard listings of the Nix store stalled for minutes during browser verification, although a browser was already on PATH.

**How to apply:** Try `command -v chromium` first. Avoid traversing the entire Nix store just to locate a test executable.

For small signed-in component checks, prefer an isolated bundle of the actual
components with browser/session fixtures rather than hand-authored imports into
Vite's transformed development modules.

**Why:** Hand-authored module imports bypass Vite's CommonJS interop and React
refresh setup, and dependency URLs depend on the server's configured root. These
harness failures can obscure otherwise-working application behavior.

**How to apply:** Keep fixtures outside application authentication and outside
the permanent UI suite. Bundle with automatic JSX, exercise the real WebSocket
handler and shared UI, and inspect the rendered result.
