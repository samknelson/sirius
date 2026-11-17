---
name: Primary repository intent
description: Intended primary repository and separation from the Freeman deployment remote.
---

The user explicitly identifies `samknelson/sirius` as the intended primary repository for `origin`. This supersedes the earlier instruction to use `samknelson/grievance`.

**Why:** During the BAO branch investigation, the user corrected the origin destination to Sirius. The grievance repository did not contain the current BAO branch; the Sirius repository does. Do not restore the older destination based on historical instructions.

**How to apply:** Verify the current and intended destinations before changing Git configuration. The existing branch policy still applies: main goes only to origin; selected deployment branches go to the secondary remote.
