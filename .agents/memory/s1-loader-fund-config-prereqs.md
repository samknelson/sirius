---
name: S1 loader fund-config prerequisites
description: Some loaders hard-require fund configuration that no loader or copy script provisions; the abort is a missing-prerequisite signal, not a loader bug.
---

# S1 loader fund-config prerequisites

Some loaders hard-require a piece of fund configuration as their write target (e.g. the employer-rates loader needs the fund's single enabled hourly charge config). Fund configuration is NOT migration data: no loader creates it, and the fund-config copy script does not cover all of it — so a fresh or dev target can be structurally unable to run such a loader.

**Why:** these loaders are designed for fully provisioned targets (prod/rehearsal); on anything else the pre-result abort looks like a loader failure and invites wasted debugging, when it is really "provision the prerequisite first".

**How to apply:** treat the abort as an environment-provisioning gap. On dev, smokes seed the prerequisite transiently with marker-keyed idempotent cleanup (see the employers sync smoke for the mechanics); adopt an existing one when present, and fail setup rather than mutate when the target's config is ambiguous.
