---
name: Component dependency declaration
description: One dependsOnComponents list per component; what reads it, what the hierarchy means, and why some links are only audited
---
Every component declares dependencies ONLY in top-level `dependsOnComponents`; the nested schema-manifest list was retired and discovery refuses it. Core may depend only on core. Dotted-ID parents are naming, never an implied dependency.

**Why:** two lists were read differently by build and enable; the hierarchy can't be a dependency because several dotted parents are not components at all.

**How to apply:** FKs and raw SQL into another component's declared tables fail lint; Drizzle table imports and core references are audit-only (`check-component-imports.ts --audit`) because many are runtime-gated soft links. Keep docs/component-dependencies.md in sync when declaring new links; its "to fix" items await owner decisions.
