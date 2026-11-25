---
name: Vitest import-time mock lifecycle
description: Import-time registration assertions and automatic mock cleanup in Vitest 5.
---
Observe import-time side effects after the runner's per-test cleanup, rather than relying on mock call history from static imports.

**Why:** Vitest 5.1.1 defaults `clearMocks` to true. A correctly registered plugin can therefore appear never to have registered when its module was imported during test collection. This is call-history cleanup, not broken application registration.

**How to apply:** For tests asserting registration, reset the module cache and dynamically import the subject in per-test setup, after mock initialization. Keep asserting the actual registrar call and exported plugin identity; do not manually invoke registration, replay saved calls, or disable cleanup globally.
