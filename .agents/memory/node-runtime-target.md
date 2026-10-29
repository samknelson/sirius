---
name: Node runtime target
description: Owner-approved Node 24 LTS target and the reasoning behind choosing it over Node 26.
---

For the upgrade from Node 20, the user explicitly selected the latest patched
Node 24 LTS release rather than Node 26 on 2026-10-29.

**Why:** Node 24 has a standard available Replit runtime and a longer production
track record. Node 26 would require additional development-runtime provisioning
here without an identified application need for its newer features.

**How to apply:** Keep development, CI, and production aligned on Node 24 for
this upgrade. Do not let an unbounded latest tag silently select a newer major.
This is not a permanent ban on future upgrades; reassess the runtime target
when the user requests another major-version upgrade.
