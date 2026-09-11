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

Docker's default cache report does not account for a buildx
`docker-container` builder's cache. Inspect the selected builder with
`docker buildx du`; its state lives in a volume attached to the builder.

**Why:** CloudShell reported zero Docker build cache while the active
BuildKit builder retained nearly 2 GB from failed attempts. A general Docker
prune did not remove that attached state.

**How to apply:** target cache cleanup at the named buildx builder, and
check free space afterward. Dependency-tree size alone does not prove a
build fits: snapshots and compressed export require additional peak space.