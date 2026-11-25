---
name: Early document credentials and speculative loading
description: Why first-in-head cleanup needs an HTTP referrer policy, including static-only services.
---
An inline cleanup script placed first in the head cannot by itself prevent
speculative asset preloads from sending the original credential-bearing document
URL in their referrer. Enforce no-referrer on the document response before parsing,
in addition to synchronous URL cleanup and pre-React credential consumption.

**Why:** A real production-build browser check showed modulepreload and stylesheet
requests retaining the original URL even though the cleanup script ran first.
The development build did not expose this behavior.

**How to apply:** Scope the HTTP policy to the sensitive document; include
database-free static-only services, which never run application startup hooks.
Verify production HTML in a real browser, inspecting subresource referrers, not
just script order or the cleaned address bar. Use only synthetic credentials.
