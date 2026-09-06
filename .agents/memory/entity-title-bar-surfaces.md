---
name: Entity page title bars
description: Record pages now share one title-bar component with not-found and loading variants; the three-headers-per-wrapper trap is what it exists to prevent.
---

# Entity page title bars

Every record page's title bar comes from one shared component in
`client/src/components/shared/`, not from the layout wrapper. The wrapper
supplies slots (icon, title, badges, subtitle, actions, back link, record id)
and the component owns the markup, including the *not found* and *loading*
spellings. The generic `PageHeader` still belongs to list and section pages.

**Why:** the wrappers grew one per entity, each hand-rolling three
near-identical headers (record not found / loading skeleton / the real one).
Adding one cross-cutting element cost a ~33-file sweep, and a sweep lands
edits in the wrong header of the three without ever failing to compile.

**How to apply:**

- Anything that must appear on every record page goes in the shared component,
  behind the record id — one edit, not a sweep. Take the record id and fetch
  your own data so no wrapper learns the feature.
- The not-found and loading variants deliberately accept **no** record id,
  badges, subtitle or actions. That is the guardrail against the old trap;
  don't widen them.
- Wrappers keep their own page chrome. The bar variant owns its header element
  and container; the page and compact variants render inside the caller's
  container, because their surrounding layouts differ.
- Not everything in the layouts directory is a record page: section wrappers
  and ones keyed by a type name or a job name have no record id.
