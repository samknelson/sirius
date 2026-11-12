---
name: Vendor cache cutovers
description: Safe cache-identity handling when moving a paid vendor call into per-configuration plugins.
---

Keep the existing service/request-type namespace when migrating a cached vendor operation, but do not reuse or duplicate legacy unscoped cache hashes when their originating configuration cannot be proven.

**Why:** Per-configuration cache identity prevents one vendor account's answer from being replayed under another account. Old rows may retain only a request hash, so there is no safe way to assign them to a new configuration. Guessing avoids a cold miss at the cost of cross-account contamination.

**How to apply:** Preserve the old namespace for administration, expiry, and usage continuity. Prefix all future keys with the resolved config ID. Accept a one-time cold miss unless independent provenance identifies the exact originating configuration.