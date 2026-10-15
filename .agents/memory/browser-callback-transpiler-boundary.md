---
name: Browser callbacks and transpiler helpers
description: Why a callback that passes Vitest can fail when Puppeteer serializes it under tsx.
---

Browser-evaluated callbacks must be free of compiler-generated closure dependencies, not only explicit imports. Avoid assigning nested functions inside a serialized callback; inline callbacks avoid inferred-name helper injection in the current toolchain.

**Why:** The development runtime preserves function names by adding a helper from the surrounding Node module. Puppeteer sends only the callback source to Chromium, so the helper is undefined there. Vitest's transform can omit this helper and falsely pass the same real-browser test; the production transform may differ again.

**How to apply:** For renderer changes, exercise actual Chromium in a separate development-runtime process and a production-shaped bundle. Test every browser evaluation, including image decode and layout checks. Never patch a helper onto the browser global or change global build-name settings to conceal the boundary.
