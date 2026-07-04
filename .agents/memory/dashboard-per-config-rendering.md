---
name: Dashboard renders one widget per config row
description: The dashboard maps plugin_configs rows (not plugins) to widgets; settings are scoped per-config via configId.
---

The `/dashboard` page renders **one widget per dashboard `plugin_configs` row**,
not one per registered plugin. A plugin configured multiple times produces
multiple widgets.

- The server serves items from `GET /api/dashboard-plugins/items`
  (`dashboardPluginRegistry.getConfigItems()`), one entry per config row joined
  with plugin display metadata, sorted by config `ordering` → plugin order → id.
- Each rendered widget is wrapped in `DashboardConfigContext` (defined in
  `client/src/plugins/dashboard/useDashboardContent.ts`). `useDashboardContent`
  reads the `configId` from that context and appends `?configId=...` to the
  `/content` request and to its query key — so widgets get per-instance settings
  **without changing each widget's own code**.
- `runContent` resolves settings via `getSettingsValueForConfig(plugin, configId)`,
  validating the row's `pluginType === "dashboard"` and matching `pluginId`,
  falling back to the canonical config when configId is absent/mismatched.

**Why:** the unified `plugin_configs` store already supported many rows per
plugin, but the dashboard used to collapse them to the first row. Per-config
rendering makes multiple instances (e.g. two Welcome Messages) "just work."

**How to apply:** every renderable (non-headless) plugin MUST have at least one
config row or its widget disappears. `seedDefaultConfigs()` runs at boot (after
the legacy backfill) to guarantee this idempotently — don't remove it. Content
query invalidation still works via prefix `["/api/dashboard-plugins", pluginId,
"content"]` because the configId segment comes after `"content"`.
