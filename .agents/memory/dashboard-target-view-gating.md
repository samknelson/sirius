---
name: Dashboard staff target-view gating
description: Rules for the ?targetUserId= staff override on dashboard APIs
---
Staff target-view (`?targetUserId=` on dashboard items/content, `/users/:id/dashboard`) must evaluate EVERY gating layer against the TARGET user on EVERY endpoint: component, requiredPolicy, config-role subsidiary, AND the client `requiredPermissions` (any-of) hint — the hint is normally client-filtered, so a server-side target view has to enforce it itself (shared helper `checkTargetPluginGating`).

**Why:** the items route pre-filtered permissions but /content initially didn't — a direct `?targetUserId=&configId=` read leaked role-visible but permission-denied widget data (review-rejected once for exactly this).

**How to apply:** any new "view as user X" surface must route all gate checks through one target-aware helper used by both list and detail/content endpoints; items in target mode return gating hint fields stripped so the client never re-filters with the viewer's auth. Banner identity uses the narrow staff-gated `/api/dashboard-plugins/target-user/:id` (admin user detail API is admin-only).

A staff view of a **worker record** is different from "view as user X": it should not impersonate a linked worker account or use that account's dashboard config roles. Keep it on an explicitly named dashboard content action, require staff and entity-scoped worker access plus the plugin component gate, and pass only the authorized worker id to the resolver.

**Why:** Workers without linked user accounts still have coverage records, and the normal dashboard config is intentionally visible to worker roles rather than staff roles. Reusing target-user impersonation would hide those workers or apply the wrong identity and role gates.

**How to apply:** when a staff page displays data from a member dashboard widget for a selected record, distinguish the record-scoped action from the ordinary self-dashboard and target-user modes; never let a generic workerId query override self-dashboard identity.
