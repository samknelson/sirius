---
name: Primary repository intent
description: User correction to the intended origin repository; older project documentation disagrees.
---

The user explicitly identifies `grievance` as the intended primary repository for `origin`. Do not infer the intended repository from the Sirius application name or silently restore the older destination named in project documentation.

**Why:** During Git authentication troubleshooting on 2026-10-27, the user repeatedly clarified that the existing two-remote workflow must be preserved and that origin should target grievance.

**How to apply:** Verify the current and intended destinations before changing Git configuration. The existing branch policy still applies: main goes only to origin; selected deployment branches go to the secondary remote.
