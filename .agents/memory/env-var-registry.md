---
name: Environment variable registry policy
description: Project rule — env vars must be declared in the central registry and read through it; direct process-env access is banned outside the registry module.
---

Rule: every environment variable the app reads must be declared (description,
secret flag, category: core/platform/component) in the central env registry and
read through its getter; direct process-env access is banned outside the
registry module, enforced by an author-time check that also flags comments.

**Why:** the env contract must be explicit and enumerable (feeds the
system-status plugin), undeclared reads must fail loudly, and values need
transform/override hooks. The registry must stay a zero-import leaf so
pre-init boot code (DB URL assembly, production entry) can use it.

**How to apply:** when adding any new env var, register it in the owning
module at load time (registration is idempotent); dynamically-named lookups
register at parse/resolve time as secrets. Client-side VITE_* reads are
exempt (compile-time substitution). Don't write "process" + ".env" even in
comments — reword instead of adding exemptions.
