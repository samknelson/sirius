---
name: One component per directory
description: User's decision to retire the "component package" concept in favor of one removable component per components/ directory.
---
Each directory under components/ is exactly one component, named by its component ID (e.g. components/sitespecific.freeman.edls_migrate). No separate "package" concept.

**Why:** User (2026-11-25): a component is "stuff you can turn on and off"; retiring one (e.g. edls_migrate) should be literally deleting its directory.

**How to apply:** Shared code goes in the parent component it depends on; never import from a component you don't declare as a dependency. Deleting a directory does not drop its tables (separate decision).

Ownership: `component_ownership` is the current record; the old `component_package_ownership` variable (packageId entries) is read-merged, never written — don't delete it without a deliberate data decision. Leaf-deletion (delete dir → check/build/start → restore) is the removability proof; keep it throwaway, not a committed test.
