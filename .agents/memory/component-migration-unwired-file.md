---
name: Component migration file exists but is never applied
description: A numbered component migration is inert until it is registered with the runner; schema that merges without a migration breaks every fresh install, and the drift gate is the only thing that notices.
---

**Rule:** a migration file under the component's migration directory does nothing until the
runner index registers it. When a table "declared in schema.ts" is missing at boot, check the
registration before suspecting the migration body — and treat a drift-gate failure on a
just-merged branch as "someone shipped schema without a migration", not as local noise.

**Why:** an appeal schema merged with its migration file present but unregistered, and part of
the schema (the appeal detail tables, a new NOT NULL on case statuses) with no migration at all.
Dev booted with a failed drift gate; hand-creating the tables locally hid the gap until review
pointed out that production would never get them. Older suites that create statuses without the
new required column also broke — fixtures must follow schema, not the other way round.

**How to apply:** ship new DDL as the next number above the highest existing one (never edit a
merged number), register it, keep it idempotent, and prove it by dropping the hand-made tables
and letting a restart create them: recorded component version advanced, drift gate passed,
constraint names identical to what the enable-path push would create. The BAO test bring-up
fixture keeps its own raw migration list for never-enabled databases — add the number there too.
