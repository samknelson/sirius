---
name: Derived registry caches need a version key
description: Any cache derived from the plugin registry (e.g. the token field catalog) must key on registry version AND component-cache revision, or validation and delivery disagree.
---

A cache computed from `listEnabledSync()` (the token field catalog is the
live example) must NOT be a plain `??=` memo. Key it on both:

- a registry version counter bumped on every plugin registration **and**
  on any in-place metadata mutation (a second surface adding declared
  fields to an already-registered shared root), and
- the component-cache revision, bumped whenever component enable/disable
  state changes.

**Why:** two failure modes, both silent and both seen in practice.
1. Plugin files register lazily. A standalone script (or any code path
   that renders before every module is imported) builds the cache first;
   a root registered afterwards is missing from it, and its declared
   fields render as `[unknown token: …]` while the same token validates
   fine — because save-time validation calls the uncached builder.
2. Enabling a component changes which plugins the catalog walks. A stale
   cache then rejects at delivery time exactly what validation accepted.

**How to apply:** whenever you memoize anything derived from a plugin
registry, ask which of those two inputs can change after boot. If either
can, put it in the cache key rather than assuming "static after boot".
