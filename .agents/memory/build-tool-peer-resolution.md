---
name: Build tool peer resolution
description: Coordinated peer upgrades and misleading npm lockfile conflicts during security-block recovery
---
Treat the build and test tools as a coordinated peer-dependency group when recovering from blocked package downloads. Do not bypass the package firewall or suppress peer checks.

**Why:** npm reported old locked packages as “Found” even after their requested versions were updated and the installed packages were missing. Stale direct lock entries obscured actual peer conflicts, including an optional build-tool peer supplied at the root.

**How to apply:** Inspect the requested versions' full peer requirements, including optional peers already installed at the root. Preserve unrelated locked dependencies; selectively invalidate stale conflicting lock entries when necessary and let npm regenerate their metadata. Confirm recovery with the actual post-merge clean install, not only an incremental install, then verify production bundling and proxied HMR.
