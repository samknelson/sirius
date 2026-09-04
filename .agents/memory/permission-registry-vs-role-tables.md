---
name: Permission registry vs role tables
description: Why "does this role grant X?" must be asked of the role tables, not getRolePermissions, in anything that can run before the permission system is initialized.
---

# Asking whether a role grants a permission

`getRolePermissions(roleId)` maps each stored `role_permissions` row through the
in-memory permission registry and DROPS keys the registry does not know. The
registry is populated by `initializePermissions` during app-init (plus component
permission sync), so in any context where that has not run — a standalone tsx
script, a very early boot step, a test — it answers "this role grants nothing"
for a role that grants everything.

`getRolesWithPermission(key)` reads the join table directly and is unaffected.

**Rule:** authority questions ("does this role/user hold X?") asked by code that
can run outside a fully initialized app must go through the role tables. Only
code that legitimately needs permission METADATA (description, module) should
reach for the registry-backed reads.

**Why:** a break-glass boot step used per-role `getRolePermissions` to decide
whether an account already had admin. Run from a script it silently answered
"no" every time and created a fresh, permission-less role on each run — the
loop was invisible because the grant it then made looked successful.

**How to apply:** if you are about to create or grant something because a
permission lookup came back empty, first ask whether the registry was loaded;
prefer the table-backed query, and refuse (loudly) rather than create when
`getAllPermissions()` comes back without the key you need.
