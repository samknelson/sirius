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

Relocation approval is not extraction approval. Review callback-hook versus
self-registration choices with the user before extracting core registrations
and invocation boundaries in a later task.

**Why:** The user explicitly separated straight file moves from the follow-up
extraction so they could understand the architectural choices first.

**How to apply:** A separately approved extraction can replace registrations
and invocation boundaries for its named components only; it does not broaden
the scope of other relocation-only tasks. In relocation-only work, update
import and schema paths as needed, but retain existing registration ownership
and invocation behavior. Do not use relocation as permission to extract hooks
or change dependencies.

Absence verification must reach full route registration, not just compilation
or a report-only boot.

**Why:** An optional import can incidentally initialize a core registry
declaration. Without that component, a lazy route may declare it after the
registry has closed; both installed startup and absence builds can still pass.

**How to apply:** Exercise a complete boot in isolation for each removal
combination, and ensure core declarations have an unconditional early owner.
Worker children follow the same relocation-only boundary. A component with no
exclusive implementation may have only a transitional manifest; do not move
shared authentication just to fill its directory. Fixed browser glob entries may
remain thin forwarders during relocation.

**Why:** The user explicitly excluded authentication extraction, new registration
designs and permanent relocation/UI tests from this stage.

**How to apply:** Preserve central registration and use focused existing tests
plus temporary smoke checks. Review removability and browser discovery contracts
separately before replacing the retained host integration.
