---
name: PUBLIC_URL is the only base-URL source
description: Replit domain env vars are unregistered; all public-origin needs go through PUBLIC_URL.
---

The rule: code needing the site's public origin reads PUBLIC_URL through the env registry (or the base-url helpers). The Replit platform domain variables are deliberately UNREGISTERED, so reading one throws "not registered" — that failure is the guardrail working, not a bug to patch by re-registering it.

**Why:** the app also deploys to external hosts where Replit variables don't exist. Scattered per-consumer fallback chains produced malformed SAML callback URLs and localhost links in outbound email. Exactly one place — the PUBLIC_URL declaration's transform — knows the platform fallback chain and normalizes the result to an https origin.

**How to apply:** never re-add a platform domain variable to reach a URL; add the consumer to the PUBLIC_URL path instead. Anything handed to an EXTERNAL service (provider status callbacks) must go through the comm URL builder, which withholds the localhost development fallback rather than sending an unreachable callback.
