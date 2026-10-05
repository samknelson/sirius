---
name: Browser verification transport
description: Puppeteer transport behavior in the Replit workspace during signed-in fixture checks.
---

For Puppeteer verification in this workspace, use the pipe transport when browser launch waits indefinitely for a debugging endpoint on stdout.

**Why:** Browser binaries available in the workspace could launch, but the default endpoint discovery timed out; `pipe: true` completed the same checks. This is a browser-launch issue, not an app readiness failure.

**How to apply:** For isolated browser checks, prefer pipe transport over repeatedly changing browser binaries. Signed-in UI behavior can be exercised with synthetic API responses intercepted only in the test browser; never add a server authentication bypass or change saved component enablement for verification.
