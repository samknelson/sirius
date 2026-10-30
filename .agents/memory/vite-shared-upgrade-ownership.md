---
name: Shared Vite upgrade ownership
description: Non-obvious ws listener interference and proxy-specific HMR verification.
---

When sharing an HTTP server with Vite, a ws server's `path` option is not a passive routing filter: the automatic upgrade listener returns HTTP 400 for a different path before another listener can accept it.

**Why:** This caused development HMR failures independently of the Node runtime upgrade. An invalid localhost fallback was a secondary symptom, not proof of a Node regression.

**How to apply:** The application notification socket deliberately claims only `/ws` in every environment; origin refusal must not touch another listener's paths. Preserve configured HMR options when supplying middleware-mode server options. Verify the actual proxied browser receives a 101 and a rendered hot update, not merely that the HTTP page loads.

The notification socket requires the canonical PUBLIC_URL Origin even from
non-browser clients; missing Origin is not a machine-client exemption.

**Why:** Session cookies authorize this socket, so exemptions based on missing
browser headers would bypass the cross-origin boundary. Non-browser clients
can supply Origin but must still authenticate independently with their session.

**How to apply:** Keep machine integrations on independently authenticated web
services, or require explicit canonical Origin plus a session on `/ws`.

A localhost screenshot does not exercise the Replit proxy's TLS/port behavior.

**Why:** With Replit's configured wss/443 HMR endpoint, direct HTTP localhost capture can show connection refusal even though the proxied HTTPS browser connects and hot-updates correctly.

**How to apply:** Use a browser visiting the development domain for HMR checks; use the screenshot only for visual rendering. Revert temporary client edits and observe their reversal without a document reload.
