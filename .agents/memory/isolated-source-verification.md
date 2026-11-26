---
name: Isolated source verification
description: Architecture lint in a temporary source copy needs its own usable Git context.
---
A throwaway source copy used for architecture validation needs an independent,
initialized Git snapshot, including a valid HEAD.

**Why:** Project checks enumerate files through Git and inspect branch state.
A copy nested below an ignored artifacts directory can inherit the outer
repository and produce an empty scan; an unborn local branch still cannot
satisfy checks that inspect HEAD. Neither failure demonstrates an application
defect or a passing removal check.

**How to apply:** Establish the isolated copy's Git context before validation,
keep its generated output excluded from the real repository, and use separate
databases and synthetic credentials for full-startup removal checks.

When stripping inherited environment variables for isolated checks, retain
`XDG_CONFIG_HOME` along with `PATH` and `HOME`.

**Why:** The environment's Nix `npx` wrapper requires `XDG_CONFIG_HOME`; omitting
it makes every child architecture check fail before application code executes.

**How to apply:** Supply only the minimal tool environment and synthetic runtime
configuration. A missing tool environment is not evidence of a source-removal
failure.
