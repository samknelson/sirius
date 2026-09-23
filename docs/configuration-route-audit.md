# Configuration route layout audit

Task 630 audited every `<Route path>` registered in `client/src/App.tsx`
against every static and catalog-derived destination in
`configSections`. The test in
`tests/configuration/navigation-layout-coverage.test.ts` repeats the registry
and route cross-check automatically.

`AuthenticatedLayout` is the layout boundary. It calls
`isConfigurationRoute(location)` and adds `ConfigurationLayout` without moving
or replacing any `ProtectedRoute`. Permission, policy, component, and
entity-tab access therefore remain unchanged.

## Classification rules

1. A registry destination and its URL-prefix descendants are **owned**.
2. Options-list routes are **owned** before the catalog request resolves.
3. A short, declared alias list covers list/detail naming changes and the cron
   redirect. Aliases also identify the sidebar item to highlight.
4. Two old `/config` pages are **standalone configuration** pages. They retain
   configuration chrome but are deliberately absent from navigation.
5. Redirect-only compatibility URLs and unrelated operations are **excluded**.
   No blanket `/config`, `/admin`, or site-specific prefix is used.

## Complete owned route inventory

Every route pattern below is registered in `App.tsx`. “Owner” is the registry
path which supplies the active sidebar section.

| Owner | Registered route patterns |
| --- | --- |
| `/config` | `/config` |
| `/grievance-timeline-templates` | `/grievance-timeline-templates`; `/grievance-timeline-template/:id`; `/grievance-timeline-template/:id/edit`; `/grievance-timeline-template/:id/items`; `/grievance-timeline-template/:id/logs` |
| `/contracts` | `/contracts`; `/contract/:id`; `/contract/:id/edit`; `/contract/:id/articles`; `/contract/:id/articles/edit`; `/contract/:id/articles/outline`; `/contract/:id/article/:articleId/edit`; `/contract/:id/outline`; `/contract/:id/full-text`; `/contract/:id/logs` |
| `/sitespecific/btu/csgs` | `/sitespecific/btu/csgs`; `/sitespecific/btu/csgs/new`; `/sitespecific/btu/csg/:id`; `/sitespecific/btu/csg/:id/edit` |
| BTU direct owners | `/sitespecific/btu/employer-map`; `/sitespecific/btu/territories`; `/sitespecific/btu/school-types`; `/sitespecific/btu/regions` |
| `/trust-benefits` | `/trust-benefits`; `/trust-benefits/add`; `/trust-benefits/:id`; `/trust-benefits/:id/edit` |
| `/admin/letter-templates` | `/admin/letter-templates`; `/admin/letter-templates/:id` |
| User Management direct owners | `/admin/users/list`; `/admin/users/roles`; `/admin/users/permissions`; `/admin/users/policies`; `/admin/users/sessions` |
| `/admin/users/flood-events` | `/admin/users/flood-events`; `/admin/users/flood-events/config` |
| User setting direct owners | `/config/employers/user-settings`; `/config/trust/providers/user-settings`; `/config/trust/open-enrollment-windows`; `/config/workers/user-settings`; `/config/workers/list-settings` |
| Core data direct owners | `/config/addresses`; `/config/entity-files`; `/config/entity-notes`; `/config/catalogs` |
| `/config/catalogs` | `/config/catalogs/:catalogId` |
| catalog-derived option owner | `/config/options`; `/config/options/:type`; `/config/options/:type/list`; `/config/options/:type/export`; `/config/options/:type/import` |
| Worker direct owners | `/config/steward-settings`; `/config/workers/ban`; `/config/workers/tos` |
| `/config/event-types` | `/config/event-types` |
| `/config/dispatch-job-types` | `/config/dispatch-job-types`; `/config/dispatch-job-type/:id`; `/config/dispatch-job-type/:id/edit`; `/config/dispatch-job-type/:id/notifications`; `/config/dispatch-job-type/:id/eligibility-plugins`; `/config/dispatch-job-type/:id/delete`; `/config/dispatch-job-type/:id/run-settings` |
| Dispatch direct owners | `/config/dispatch/dnc`; `/config/dispatch/eba`; `/config/dispatch/seniority-reset`; `/config/dispatch/backfill`; `/config/sitespecific/hta/home-employment-statuses` |
| EDLS direct owners | `/config/edls/settings`; `/config/edls/tasks`; `/config/edls/t631-fetch`; `/config/edls/t631-ms`; `/admin/sitespecific/freeman/edls/migrate` |
| Trust/BAO direct owners | `/config/trust/sitespecific/bao/thresholds`; `/config/sitespecific/bao/employer-rates`; `/config/sitespecific/bao/distance-cache`; `/config/sitespecific/bao/cobra-rates`; `/config/sitespecific/bao/dp-rates`; `/config/sitespecific/bao/premium-rates`; `/config/sitespecific/bao/premium-files`; `/config/sitespecific/bao/cobra-triggers` |
| `/config/sitespecific/bao/rate-sources` | `/config/sitespecific/bao/rate-sources`; `/config/sitespecific/bao/rate-sources/:id/rates` |
| `/admin/ws` | `/admin/ws`; `/admin/ws/services`; `/admin/ws/stats`; `/admin/ws/clients`; `/admin/ws/clients/:id`; `/admin/ws/clients/:id/logs`; `/admin/ws/clients/:id/test`; `/admin/ws/clients/:id/swagger`; `/admin/ws/clients/:id/ip-rules`; `/admin/ws/clients/:id/credentials` |
| `/config/sftp/clients` | `/config/sftp/clients`; `/config/sftp/client/:id`; `/config/sftp/client/:id/connection`; `/config/sftp/client/:id/test`; `/config/sftp/client/:id/logs`; `/config/sftp/client/:id/edit` |
| Theme/communication direct owners | `/config/helps`; `/config/site`; `/config/terminology`; `/config/twilio`; `/config/email`; `/config/postal` |
| `/config/business-calendars` | `/config/business-calendars`; `/config/business-calendars/:id`; `/config/business-calendars/:id/closed-days`; `/config/business-calendars/:id/vacations`; `/config/business-calendars/:id/open-days`; `/config/business-calendars/:id/test` |
| System direct owners | `/config/components`; `/config/system-mode`; `/config/worker-sirius-id-authority`; `/config/auth-settings`; `/config/env`; `/config/timezone`; `/config/system-status`; `/config/s1-migration`; `/config/logs` |
| Policy direct owners | `/config/policies`; `/config/default-policy` |
| Ledger direct owners | `/config/ledger/settings`; `/config/ledger/payment-gateways/test`; `/config/ledger/payment-gateways/payment-types`; `/config/ledger/payment-types` |
| `/admin/plugin-configs` | `/admin/plugin-configs`; `/admin/plugin-configs/:kind` (including the registered dashboard, charge, dispatch-eligibility, and trust-eligibility destinations) |
| `/admin/file-browser` | `/admin/file-browser`; `/admin/file-browser/:id` |
| `/admin/denorm` | `/admin/denorm`; `/admin/denorm/:plugin_config_id` |
| System admin direct owners | `/admin/restart`; `/admin/ebs`; `/admin/debug/event-bus` |
| `/admin/wc` | `/admin/wc`; `/admin/wc/overview`; `/admin/wc/cache`; `/admin/wc/stats` |
| `/admin/metadata` | `/admin/metadata`; `/admin/metadata/list`; `/admin/metadata/backfill` |
| `/admin/cron-jobs` | `/admin/cron-jobs` redirects to `/cron-jobs`; `/cron-jobs`; `/cron-jobs/:name`; `/cron-jobs/:name/view`; `/cron-jobs/:name/run`; `/cron-jobs/:name/settings`; `/cron-jobs/:name/history` |

### Standalone configuration pages

| Route | Classification and rationale |
| --- | --- |
| `/config/phone-numbers` | Owned standalone. This old page explains that phone validation moved to `/config/twilio` and then redirects there; adding a dead-end sidebar entry would be misleading. |
| `/config/bargaining-units` | Owned standalone. This is an admin configuration editor distinct from the staff-facing `/bargaining-units` entity list. It keeps configuration chrome while remaining outside the current registry taxonomy. |

These two exact paths are explicitly listed by `isConfigurationRoute`; they are
not evidence of a broad `/config/*` fallback.

## Complete unowned `/config` inventory

All registered `/config` patterns not classified above are listed here.

| Route pattern(s) | Classification and rationale |
| --- | --- |
| `/config/users`; `/config/users/list`; `/config/users/roles`; `/config/users/permissions`; `/config/users/policies`; `/config/users/sessions` (registered twice); `/config/users/flood-events` | Redirect-only compatibility aliases. Their canonical `/admin/users/*` destinations are owned. The duplicate sessions declaration is unreachable after the earlier redirect and was not reordered as part of a layout task. |
| `/config/users/:id` | Redirect-only compatibility alias to `/users/:id`, which is a user entity surface with its own tabs, not configuration. |
| `/config/ledger/accounts`; `/config/ledger/accounts/:id`; `/config/ledger/accounts/:id/edit`; `/config/ledger/accounts/:id/payments` | Redirect-only compatibility aliases to `/ledger/accounts*`, operational ledger entity pages rather than ledger setup. |

There are no other unowned `/config` route patterns. The automated test derives
this set from `App.tsx`, so a newly added unclassified `/config` route fails the
audit.

## Explicit admin/user exclusions and aliases

The similarly named routes below are intentionally not interchangeable.

| Route pattern | Decision |
| --- | --- |
| `/admin/users/list`, `/roles`, `/permissions`, `/policies`, `/sessions`, `/flood-events*` | Configuration-owned canonical User Management routes. All require the existing admin gate except masquerade, whose policy remains separate. |
| `/admin/users` | Redirect-only alias to `/admin/users/list`; the destination owns the layout. |
| `/admin/users/:id` | Redirect-only alias to `/users/:id`; an entity page, excluded. |
| `/admin/users/masquerade` | Operational policy-gated action, excluded from configuration navigation and layout. |
| `/admin/roles`, `/admin/permissions` | Separate legacy `AdminLayout` screens, excluded. The configuration entries point to `/admin/users/roles` and `/admin/users/permissions`, so no double sidebar is introduced. |
| `/admin/wmb-scan-queue`, `/admin/wmb-scan/:id` | Operational scan workflow, excluded. |
| `/sitespecific/btu/worker-import` and other BTU import/allocation operations | Excluded; only BTU destinations actually registered in configuration navigation and CSG drill-ins are owned. |

Every one of the remaining registered application routes is outside the
configuration registry and the explicit alias/standalone sets. It remains
unwrapped by the boundary.

## Wrapper verification

- Every static navigation item must match at least one registered App route.
- Every static item and prefix descendant must satisfy
  `isConfigurationRoute`.
- Dynamic options list/list-export/list-import routes are checked before any
  catalog data exists.
- Singular entity aliases and the canonical cron routes must resolve to their
  expected owner.
- Every `/config` route must be owned, standalone, or one of the documented
  redirect-only exclusions.
- Representative unrelated admin, user, ledger, and site-specific operations
  must remain excluded.

These assertions are executable in
`tests/configuration/navigation-layout-coverage.test.ts`. Because all owned
pages render through `AuthenticatedLayout`, the outer boundary supplies the
wrapper even where a route had none before.

## Nested-layout contract

`AuthenticatedLayout` is the outer owner of configuration chrome. Some route
declarations retain an explicit `ConfigurationLayout` for backward
compatibility. `ConfigurationLayout` uses context so a nested instance renders
only its children. This guarantees one `#configuration-menu`, not two.