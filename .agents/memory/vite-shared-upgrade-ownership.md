---
name: Shared Vite upgrade ownership
description: Non-obvious ws listener interference and proxy-specific HMR verification.
---

When sharing an HTTP server with Vite, a ws server's `path` option is not a passive routing filter: the automatic upgrade listener returns HTTP 400 for a different path before another listener can accept it.

**Why:** This caused development HMR failures independently of the Node runtime upgrade. An invalid localhost fallback was a secondary symptom, not proof of a Node regression.

**How to apply:** Preserve production routing when changing development upgrade ownership. Preserve configured HMR options when supplying middleware-mode server options. Verify the actual proxied browser receives a 101 and a rendered hot update, not merely that the HTTP page loads.

A localhost screenshot does not exercise the Replit proxy's TLS/port behavior.

**Why:** With Replit's configured wss/443 HMR endpoint, direct HTTP localhost capture can show connection refusal even though the proxied HTTPS browser connects and hot-updates correctly.

**How to apply:** Use a browser visiting the development domain for HMR checks; use the screenshot only for visual rendering. Revert temporary client edits and observe their reversal without a document reload.
