---
name: One component per directory
description: User's decision to retire the "component package" concept in favor of one removable component per components/ directory.
---
Each directory under components/ is exactly one component, named by its component ID (e.g. components/sitespecific.freeman.edls_migrate). No separate "package" concept.

**Why:** User (2026-11-25): a component is "stuff you can turn on and off"; retiring one (e.g. edls_migrate) should be literally deleting its directory.

**How to apply:** Shared code goes in the parent component it depends on; never import from a component you don't declare as a dependency. Deleting a directory does not drop its tables (separate decision).

The old package-ownership variable needs no migration or compatibility reader.

**Why:** The owner confirmed on 2026-11-25 that no other deployment used the new components directory and no bundle had been made since the work began; direct deletion was authorized.

**How to apply:** Do not restore the legacy ownership fallback. Leaf-deletion checks remain throwaway verification, not committed tests.

Stepwise relocation of core components (user, 2026-11-25): first move only the files a core component wholly owns into components/<id>/ (same host-relative path), marked `coreRegistered: true`; core keeps registering and importing them directly. Removability is a later step. dispatch.* goes first, main `dispatch` deferred.

**Why:** User wants a pure rename step with no registration/callback rework.

**How to apply:** Shared files (job pages, App routes, nav, storage aggregate) stay in core. Lints that scan fixed host paths (e.g. denorm declarations) must also scan the component copies of those paths, or moved files silently escape them.

T631 follows the same relocation-only stage. The broader review of remaining
`sitespecific.t631*` and `sitespecific.freeman*` references is a separate step;
the user wants to understand callback-hook versus self-registration choices
before those integration points change.

**Why:** User explicitly requested the straight file move first, without moving
registrations or invocation sites.

**How to apply:** Update import and schema paths as needed, but retain existing
registration ownership, invocation behavior, and shared T631/Freeman boundaries.
Do not use the relocation as permission to extract hooks or change dependencies.
