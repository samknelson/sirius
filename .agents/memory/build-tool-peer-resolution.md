---
name: Build tool peer resolution
description: Coordinated peer upgrades and misleading npm lockfile conflicts during security-block recovery
---
Treat the build and test tools as a coordinated peer-dependency group when recovering from blocked package downloads. Do not bypass the package firewall or suppress peer checks.

**Why:** npm reported old locked packages as “Found” even after their requested versions were updated and the installed packages were missing. Stale direct lock entries obscured actual peer conflicts, including an optional build-tool peer supplied at the root.

**How to apply:** Inspect the requested versions' full peer requirements, including optional peers already installed at the root. Preserve unrelated locked dependencies; selectively invalidate stale conflicting lock entries when necessary and let npm regenerate their metadata. Confirm recovery with the actual post-merge clean install, not only an incremental install, then verify production bundling and proxied HMR.

Run the lockfile-registry check after the **last** package installation, including automated setup, and inspect the final diff before delivery.

**Why:** A successful install can leave Replit-internal download URLs in the lockfile. Local clean installs still succeed, masking a GitHub/Docker DNS failure. Lint results from before the install do not validate the rewritten lockfile.

**How to apply:** Restore only known internal proxy URL prefixes to public registry URLs while preserving versions and integrity hashes. Recheck the final lockfile after any further install; do not bypass the package firewall.

Do not diagnose encoding or missing-module errors against a server that was running while dependencies were replaced.

**Why:** Reinstallation can temporarily remove lazily loaded files. The JSON parser's encoding library swallows its loader exception and reports `unsupported charset "UTF-8"`, while Vite can retain references to replaced chunks.

**How to apply:** Let installation finish, restart the existing workflow, and check a harmless JSON request through the preview proxy before changing authentication or charset handling.
