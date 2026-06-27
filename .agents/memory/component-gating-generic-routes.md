---
name: Component gating on generic param routes
description: Generic :type/:kind/:pluginId/:typeName routes must gate component-owned data at BOTH kind and per-plugin/per-type granularity, on every verb.
---

# Disabled-feature data leaks through generic param routes

Generic, parameterized server routes that fan out to many resource kinds
(`:type`, `:kind`, `:pluginId`, `:typeName`) are the recurring leak surface
for disabled optional-feature components. A list endpoint that filters by
`requiredComponent` is NOT enough — the per-item sub-routes that resolve the
kind straight from the URL param will happily serve a disabled feature's data.

**The rule:** any route that serves or mutates component-owned data must
reject with a 403 `component_disabled` shape when the owning component is
disabled, and this must hold on **every verb** (GET item, POST, PATCH,
DELETE, backfill/action), not just the list.

**Two granularities, both required:**
- **Kind-level**: the whole kind is gated by one component (e.g. dispatch).
  Handled by the resolver/`enforceKindGating`.
- **Per-plugin / per-type**: a kind has no kind-level component (e.g. plugin
  kinds `dashboard`, `trust-eligibility`) OR has one but also owns finer
  sub-components (e.g. `charge`/`dispatch-eligibility` own `sitespecific.btu`,
  `dispatch.eba`, `worker.skills`; wizard types own `sitespecific.btu` via
  `requiredComponent`). Kind gating alone misses these — you must also check
  the per-plugin/per-type `requiredComponent`.

**Why:** kind gating and per-plugin gating are independent. A kind can be
enabled while a specific plugin/type under it belongs to a disabled component,
so kind gating passes and the finer-grained data leaks.

**How to apply:** for a new generic param route, ask "does the resolved
item carry its own `requiredComponent` distinct from the kind?" If yes, add a
per-item gate (look up the registration, `isComponentEnabled(requiredComponent)`,
else 403 with `{error:"component_disabled", componentId, componentName}` via
`getComponentById` for the display name). Reference patterns:
`requireOptionTypeComponent` (options-routes), `enforcePluginGating`
(plugins-admin / plugins-config `pluginGate`), `requireWizardTypeComponent`
(wizards.ts sub-routes).
