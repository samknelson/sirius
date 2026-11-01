---
name: Node runtime target
description: Owner-approved Node 24 LTS target and the reasoning behind choosing it over Node 26.
---

For the upgrade from Node 20, the user explicitly selected Node 24 LTS rather
than Node 26 on 2026-10-29, then approved 24.22.1 as the target for now.

**Why:** Node 24 has a standard available Replit runtime and a longer production
track record. Node 26 would require additional development-runtime provisioning
here without an identified application need for its newer features.
The owner chose the patch supplied by the standard Replit module over custom
provisioning solely to obtain 24.22.2. This is not an indefinite patch freeze.

**How to apply:** Keep development, CI, and production aligned on Node 24 for
this upgrade. Do not let an unbounded latest tag silently select a newer major.
This is not a permanent ban on future upgrades; reassess the runtime target
when the user requests another major-version upgrade.

The Replit language module and the same-named Nix system package are not
interchangeable sources of a Node patch.

**Why:** The channel's system package can shadow the language module with an
older runtime even when both are named Node 24. Installing the system package
does not necessarily obtain the module's patch, let alone upstream's newest.

**How to apply:** Verify `node -v`, `npm -v`, and the running application's
executable independently after provisioning. Keep the global channel unchanged
unless the effects on the other tools have been assessed. A temporary downloaded
binary is useful for compatibility verification, not proof of a reproducible
development environment.
