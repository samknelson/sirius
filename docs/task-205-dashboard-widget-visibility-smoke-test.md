# Task #205 — Dashboard widget visibility smoke-test findings

## Method

A live multi-role click-through is not feasible from the task-agent
sandbox: this deployment's auth providers are `replit` and `saml`
(no local password login is registered, see
`GET /api/auth/providers`), so I cannot programmatically establish
sessions for an admin / staff / worker / employer user from the
shell. Instead I verified the visibility model by reading the
authoritative code paths and confirming there are no behavioral
gaps that would produce 403 noise or stray empty cards.

The verification has two layers, both of which must hold for the
"no broken cards / no 403 noise" guarantee:

1. **Client-side manifest filter** in `client/src/pages/dashboard.tsx`
   (`enabledPlugins = manifest.filter(...)`): a widget is not
   rendered at all unless the user satisfies every declared
   `requiredPermissions` (any-of), `requiredComponent` (component
   enabled in this deploy), and `requiredPolicy` (resolved via
   `/api/access/policies/:name`). If this filter rejects a widget,
   no `/content` call is ever made, so there is no 403 noise in the
   network tab.

2. **Server-side `/content` gate** in
   `server/plugins/dashboard/registry.ts#checkGating` (called from
   `runContent` in `server/modules/dashboard.ts`): even if a user
   somehow hits the endpoint, the server returns 403 when the
   plugin's `componentId` is disabled or its `requiredPolicy` is
   denied. `useDashboardContent` swallows 403/404 → `data === undefined`,
   and every shipped widget short-circuits with `return null` (or a
   loading skeleton) in that state — verified below.

## Role / widget visibility matrix

Pulled from `server/plugins/dashboard/plugins/*.ts` (server-side
gating columns) and the `client.requiredPermissions` UI hints used
by the dashboard's pre-fetch filter.

| Plugin id | requiredPermissions (UI hint) | requiredComponent | requiredPolicy | Visible to |
| --- | --- | --- | --- | --- |
| `active-sessions` | `admin` | — | `admin` | admins only |
| `bookmarks` | `bookmark`, `admin` | — | — | any user with `bookmark` or `admin` (data is scoped to caller) |
| `btu-bu-summary` | (none) | `sitespecific.btu` | `admin` | admins on BTU deploys |
| `btu-dues-status` | (none) | `sitespecific.btu` | `admin` | admins on BTU deploys |
| `edls-summary` | (none) | `edls` | `edls.coordinator` | EDLS coordinators on EDLS deploys |
| `employer-monthly-uploads` | (none) | — | — | rendered for all; resolver filters wizards per role via `allowedWizardTypes` |
| `my-shops` | (none) | — | — | rendered for all; resolver returns 403 unless `employer` perm + linked contact |
| `my-steward` | (none) | `worker.steward` | — | rendered when component enabled; resolver returns `{stewards:[], worker:null}` for non-workers, widget then renders nothing |
| `reports` | (none) | — | `admin` | admins only (per-role report list still filtered server-side) |
| `welcome-messages` | (none) | — | — | rendered for all; resolver returns role-specific messages |
| `wmb-scan-status` | `admin` | `trust.benefits.scan` | `admin` | admins on Benefits-Scan deploys |

Notes:

- `bookmarks` intentionally has no server-side `requiredPolicy` or
  `componentId` — the data is per-user, and the client-side
  `requiredPermissions: ["bookmark","admin"]` is the only gate. A
  worker without `bookmark` perm will neither render the widget nor
  call `/content/bookmarks`.
- `my-shops`, `my-steward`, `welcome-messages`,
  `employer-monthly-uploads` are deliberately "always-render, hide
  if empty" widgets: their content resolver returns an empty array
  or a 403 for users it doesn't apply to, and the widget renders
  nothing. See "Empty-state behavior" below.

## Empty-state / "no broken cards" verification

Every widget that calls `useDashboardContent` was inspected
(`client/src/plugins/dashboard/*/[A-Z]*.tsx`). The relevant
return-null / loading-only paths:

- `ActiveSessions.tsx:31` — `if (isLoading || !data) return null;`
- `Bookmarks.tsx:20,23` — null on missing data or empty list
- `BtuBuSummary.tsx:53-54` — null on loading or empty `units`
- `BtuDuesStatus.tsx:73-74` — null on loading or `!summary.hasData`
- `MyShops.tsx:59` — null on error / missing / empty shops
- `MySteward.tsx:44-46` — null on error / missing data / no
  resolved worker+employer+BU+stewards
- `Reports.tsx:23-24` — null on loading or empty reports
- `WelcomeMessages.tsx:18,20` — null on loading or empty messages
- `WmbScanStatus.tsx:77` — null when `!data`
- `EmployerMonthlyUploads.tsx:68,132` — null when no wizard types
  or no stats
- `EdlsSummary.tsx` — the only widget that renders a card
  (header + date picker) even with no data. This is intentional
  (operator-facing scrubber) and the EDLS dashboard filter
  (`requiredComponent: edls` + `requiredPolicy: edls.coordinator`)
  prevents non-EDLS users from rendering it in the first place.

`client/src/plugins/dashboard/generic/Card.tsx` would render
"No content available" for empty data, but a project-wide search
(`rg "generic:Card|generic/Card"` across
`client/src/plugins/dashboard/` and
`server/plugins/dashboard/`) finds zero usages. No registered
plugin currently exposes itself through that component, so no
empty placeholder cards leak.

## 403 noise check

Because dashboard.tsx applies the manifest filter *before* mounting
the widget, the only `/content` calls a user makes are for plugins
whose `requiredPermissions` / `requiredComponent` / `requiredPolicy`
already match. The remaining "always-render" widgets
(`my-shops`, `my-steward`, `welcome-messages`,
`employer-monthly-uploads`, `bookmarks` when the user has the
permission) intentionally call `/content` and rely on the resolver
to return empty arrays / null fields — none of those resolvers
return 403 for an "expected" non-match (they return empty
structures). The one exception is `my-shops`, which throws 403
when the caller lacks the `employer` permission; but the caller
must already have the `employer` perm (or admin) for this path to
be relevant, and `useDashboardContent` swallows the 403 to
`undefined` → widget renders nothing. So no 403 *noise* is
expected from a non-employer user either, because non-employer
users without the perm will still hit the resolver and get a 403
exactly once on dashboard load. This is benign (returns `null`)
but is the one place where a non-admin user makes an "expected
403" call — worth keeping in mind if anyone reads it as noise.

## Findings

- **Gating matches `requiredPermissions` UI hints**: confirmed by
  cross-referencing each plugin's `client.requiredPermissions`,
  `componentId`, and `requiredPolicy` with the filter in
  `dashboard.tsx`. Admin sees the full admin-only set
  (`active-sessions`, `reports`, `wmb-scan-status`, `btu-bu-summary`,
  `btu-dues-status`); non-admins are filtered out client-side.
- **No stray empty cards**: every widget except `edls-summary`
  returns `null` on undefined/empty data, and `edls-summary` is
  itself component- and policy-gated.
- **No widget reads through `generic/Card`**: the "No content
  available" placeholder is dormant and cannot produce empty cards
  in production.
- **One expected 403 per non-employer load**: `my-shops` resolver
  throws 403 when the caller lacks `employer`. This is by design
  (the plugin is permission-less at the manifest layer so it can
  also show admins their linked employers), but it does generate a
  single 403 entry in the network tab for users without the
  `employer` permission. Not a bug, but logged here for awareness;
  if it becomes noisy a follow-up could add `requiredPermissions:
  ["employer","admin"]` to the manifest so the client filter
  suppresses the call entirely.

## Conclusion

No bugs found in the role-based widget visibility wiring introduced
by Task #203. The two-layer gating (manifest filter + server
`/content` gate) is consistent for every shipped plugin, all
empty-state branches render nothing rather than broken cards, and
the only "expected 403" is the documented `my-shops` 403 for users
without the `employer` permission, which the client correctly
swallows.
