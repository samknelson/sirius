---
name: Flood protection product rules
description: Why floods use shared singleton plugins, their disablement semantics, and the intended bucket boundaries.
---

Flood definitions belong in the shared singleton plugin/configuration framework, not a separate configuration registry. Per-kind catalog browsing is a separate future project.

**Why:** The user wants fewer bespoke registries and one standard way to declare configurable, code-supplied behavior.

**How to apply:** New rate caps extend the existing flood framework and its shared configuration surfaces. Do not introduce a separate store, editor, or cache.

Disabled flood plugins always allow the action, without identifier callbacks, count reads, or recording. Component-off plugins behave the same way. Disabling does not erase prior counts.

**Why:** The user explicitly requested that disabled plugins stop checking. Erasing counts would change re-enable behavior and destroy operational history.

**How to apply:** Enforce this at the shared runtime boundary, not just in admin visibility. Admin-only configuration must never imply admin-only runtime protection on public endpoints.

Keep bucket identities stable across infrastructure changes: notification limits are independent per medium, recipient, and notifier plugin; local credential limits count failures rather than successful authentication.

**Why:** Sharing these budgets unexpectedly can block unrelated recipients/users, while changing identifiers during a migration silently resets active protection.

**How to apply:** Preserve action-site counting placement and fail-open behavior when changing the framework. Apply a new cap only once the action is actually eligible to proceed, unless its declaration intentionally counts every attempt.

Vendor-request rate limits are best-effort operational controls, not hard quota or spending guarantees.

**Why:** The user explicitly accepted best-effort enforcement and excluded concurrency guarantees for this feature.

**How to apply:** Do not promise exact caps under simultaneous dispatches or add locking/reservation infrastructure without a new requirement.

Vendor-operation rules share their budget across a deployment's connections of the selected vendor type.

**Why:** The accepted scope is a deployment-wide vendor/operation cap, not per-connection limits; adding another connection must not silently multiply the budget.

**How to apply:** Do not partition a rule's budget by vendor connection, user, or recipient without a new requirement.
