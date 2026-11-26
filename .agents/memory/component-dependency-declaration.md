---
name: Component dependency declaration
description: One dependsOnComponents list per component; what reads it, what the hierarchy means, and why some links are only audited
---
Every component declares dependencies ONLY in top-level `dependsOnComponents`; the nested schema-manifest list was retired and discovery refuses it. Core may depend only on core. Dotted-ID parents are naming, never an implied dependency.

**Why:** two lists were read differently by build and enable; the hierarchy can't be a dependency because several dotted parents are not components at all.

**How to apply:** FKs and raw SQL into another component's declared tables fail lint; Drizzle table imports and core references are audit-only (`check-component-imports.ts --audit`) because many are runtime-gated soft links. Keep docs/component-dependencies.md in sync when declaring new links.

Owner-approved policy: a functional prerequisite can justify a hard dependency even without a foreign key. Do not infer that every runtime-gated link should become hard.

**Why:** the owner explicitly chose hard prerequisites for the reviewed dispatch children and benefit scan/exemptions, rather than keeping the FK-driven split. Dotted naming alone remains insufficient.

**How to apply:** evaluate whether the feature is useful without the other component; preserve existing route/plugin checks alongside approved declarations.
