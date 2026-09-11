---
name: Migration image storage budget
description: Why the migration Docker target must remain independent from the full web build dependency stage.
---

The migration Docker target must install production dependencies plus its
isolated TypeScript runner instead of inheriting the web builder's complete
development dependency tree.

**Why:** constrained operational builders can complete the full dependency
stage but run out of Docker storage while materializing or exporting that
multi-gigabyte parent into the migration image. Cleanup and direct registry
export do not fix the parent-layer copy.

**How to apply:** keep migration-only tools isolated from application
production dependencies, derive their versions from the lockfile, and do not
make the migration stage descend from the full Vite/Vitest/TypeScript builder
dependency stage.