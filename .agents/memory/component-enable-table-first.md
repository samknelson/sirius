---
name: Enabling a schema-managing component in dev
description: Order of operations when turning on a component whose tables don't exist yet
---
Rule: create the component's tables in the dev DB (executeSql DDL matching the schema module exactly, including named UNIQUE CONSTRAINTs) BEFORE enabling the component in the `components` variable and restarting.

**Why:** the startup schema-drift gate checks enabled components' tables and refuses to boot on missing tables; there is no self-healing table creation at boot for component tables.

**How to apply:** flip `components` jsonb via `value || '{"<id>": true}'::jsonb`, but only after the DDL is applied. Match constraint vs index kind to the schema (`unique(...)` = named constraint).
