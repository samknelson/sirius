# Plugin framework

This directory is the shared base for every plugin kind in the app.
There are currently five kinds:

| Kind                    | Server registry location                          | Client components location                  |
| ----------------------- | ------------------------------------------------- | ------------------------------------------- |
| `dashboard`             | `server/plugins/dashboard/`                       | `client/src/plugins/dashboard/<id>/*.tsx`   |
| `dispatch-eligibility`  | `server/plugins/dispatch/eligibility/`            | (no client component — server-only)         |
| `charge`                | `server/plugins/ledger/charge/`                   | (no client component — server-only)         |
| `trust-eligibility`     | `server/plugins/trust/eligibility/`               | (no client component — server-only)         |
| `client-injection`      | `server/plugins/client-injection/`                | (no client component — server-only)         |

## Plugin registration convention (every kind, no exceptions)

Every plugin kind uses the **same** registration pattern. There is no
auto-discovery, no per-kind reinvention, no central list of plugins
maintained inside an init function. The rule is:

1. **The kind's `registry.ts` exports a `register<Kind>Plugin(plugin)`
   convenience helper** that delegates to `<kindRegistry>.register(plugin)`.
   (Examples: `registerChargePlugin`, `registerEligibilityPlugin`,
   `registerDashboardPlugin`, `registerDispatchEligPlugin`,
   `registerClientInjection`.)
2. **Each plugin file self-registers at module top level** by calling
   `register<Kind>Plugin(myPlugin)` at the bottom of its file. This
   side-effect happens exactly once, when the file is first imported.
3. **The kind's `index.ts` imports each plugin file as a side-effect
   import at the bottom of the file** (`import "./plugins/<name>";`).
   That's the entire registration list — one line per plugin. Adding
   a new plugin is two steps: drop a file in `./plugins/` and add one
   import line at the bottom of `index.ts`.
4. **The kind's `initialize<Kind>System()` function does NOT register
   plugins.** By the time it runs, the side-effect imports have already
   populated the registry. The init function is for kind-level
   registration (`registerPluginKind(...)`), startup orchestration
   (e.g. dispatch-eligibility backfills, dashboard legacy-settings
   migrations), and an aggregate `… plugins registered { plugins: [...] }`
   log line.

Do not invent alternatives: no `readdirSync` auto-discovery, no central
register-list array in the init function, no `plugins/index.ts` barrel
file. Every kind follows the rules above so the entire framework
behaves consistently and the registration site is grep-able.

All five go through:

- `PluginRegistry` (`registry.ts`) — generic per-kind registry.
- `registerPluginKind` (`kinds.ts`) — kind-level registration.
- `enforcePluginGating` / `enforceKindGating` (`gating.ts`) — single
  source of truth for component + access-policy gating.
- `registerPluginsManifestRoutes` (`server/modules/system/plugins-manifest.ts`)
  — the unified `GET /api/plugins/:kind/manifest` endpoint.
- `createPluginComponentRegistry` + `pluginManifestUrl`
  (`client/src/plugins/_core/`) — client-side component lookup and
  manifest URL/query-key helpers.

This document covers two scenarios:

1. **Adding a new plugin to an existing kind** (the common case).
2. **Introducing a brand-new kind** (rare; do this only when none of
   the existing kinds fit).

---

## URL surface (shared across every kind)

Every kind speaks the same generic HTTP surface. The dispatcher lives
in `server/modules/system/plugins-manifest.ts` (manifest) and
`server/modules/system/plugins-admin.ts` (admin). A kind opts in to each
admin capability by providing the matching callback on
`PluginKindRegistration`; routes whose callback is not supplied
return 404.

| Method | URL                                              | Backing callback     | Notes                                                                 |
| ------ | ------------------------------------------------ | -------------------- | --------------------------------------------------------------------- |
| GET    | `/api/plugins/:kind/manifest`                    | (always present)     | Always-on. Filters via `listVisibleTo` + `decorateEntries` + sort.    |
| POST   | `/api/plugins/:kind/:id/validate-config`         | `validateConfig`     | Pre-save config check. Returns `{ valid, errors? }`.                  |
| GET    | `/api/plugins/:kind/:id/settings`                | `getSettings`        | Returns `{ schema, uiSchema, value }` or 404 if no schema.            |
| PUT    | `/api/plugins/:kind/:id/settings`                | `saveSettings`       | Body is the new value. May return `{ valid: false, errors }` → 400.   |

All admin routes require authentication, then run the kind-level
gate (`requiredComponent` + `requiredPolicy`), then — for any
single-plugin route — run the per-plugin gate (`requiredComponent`
+ `requiredPolicy` on the plugin's metadata).

### Which kind implements which today

| Kind                   | Kind-level component | Kind-level policy | `validateConfig` | `getSettings` / `saveSettings` |
| ---------------------- | -------------------- | ----------------- | ---------------- | ------------------------------ |
| `dashboard`            | —                    | —                 | —                | yes                            |
| `dispatch-eligibility` | `dispatch`           | `admin`           | yes              | —                              |
| `charge`               | `ledger`             | `admin`           | yes              | —                              |
| `trust-eligibility`    | —                    | `admin`           | yes              | —                              |

`dashboard` intentionally omits a kind-level policy so every
authenticated user can list their widgets; per-plugin
`requiredPolicy` still filters the list per user. The other three
kinds are admin-only end-to-end because their manifests describe
configurable infrastructure, not per-user content.

If you want a new admin capability that doesn't fit one of these
five callbacks, add it to `PluginKindRegistration` in
`server/plugins/_core/kinds.ts` AND wire the matching route in
`server/modules/system/plugins-admin.ts` — don't bolt a kind-specific
admin endpoint onto a kind's own module file. The whole point of
the framework is that every kind speaks the same URL surface.

---

## Manifest contract

`GET /api/plugins/:kind/manifest` returns a JSON array. Each entry's
shape is the per-kind `TEntry` produced by `toManifestEntry`. Across
kinds, callers can rely on:

- `id` (string) — always present, stable, kebab-case.
- `name`, `description` (string) — always present.
- `requiredComponent`, `requiredPolicy`, `hidden` — present when set
  on the underlying plugin's `BasePluginMetadata`. `hidden: true`
  entries are filtered out of the manifest by the dispatcher itself
  (the registry checks base metadata, not the manifest entry, so
  this is enforced even for kinds that don't surface `hidden` on
  `TEntry`).

Anything beyond the base fields is kind-specific:

- `dashboard` adds `componentId`, `order`, `defaultColumnSpan`,
  `componentProps`, `enabledByDefault`, and an `enabled` flag
  injected by the kind's `decorateEntries`.
- `dispatch-eligibility` adds `configSchema`, `defaultConfig`.
- `charge` adds `category`, plus the plugin's settings UI metadata.
- `trust-eligibility` adds `configSchema`, `eligibilityType`.

Inspect each kind's `toManifestEntry` to see the exact shape; the
shared dispatcher does not transform it.

The response is served with `Cache-Control: no-store` so callers
that bypass TanStack Query don't see stale availability after a
component toggle or settings change.

---

## 1. Adding a plugin to an existing kind

Find the kind's directory under `server/plugins/` and follow the
pattern that already exists there. The high-level shape is the same
for every kind:

1. Add a `plugins/<your-id>.ts` (or `plugins/<your-id>/index.ts`)
   exporting a single object that satisfies that kind's plugin
   interface.
2. Set the base metadata fields on it (or on its `.metadata` sub-
   object, depending on the kind's `getMetadata` extractor):
   - `id` — stable, kebab-case, unique within the kind.
   - `name`, `description` — user-facing strings.
   - `requiredComponent` — **canonical** component-feature-flag gate.
     The name is `requiredComponent`. Do **not** invent
     `componentId` / `requiresComponent` spellings — those legacy
     names were collapsed in Task #208.
   - `requiredPolicy` — optional per-plugin access-policy gate.
   - `hidden` — optional, hides from the manifest while keeping the
     plugin registered/usable internally.

   Note: `requiredPolicy` and `hidden` are defined on
   `BasePluginMetadata` and honored by the framework whenever they
   appear, but not every kind's concrete plugin interface exposes
   them today. If you're adding `requiredPolicy` / `hidden` to a
   plugin under a kind that doesn't currently declare those fields
   on its interface (today: `charge`, `trust-eligibility`), add them
   to that kind's `types.ts` first so the extractor surfaces them
   to the registry.

   The concrete per-kind plugin interfaces live at:
   - `dashboard` — `server/plugins/dashboard/types.ts`
   - `dispatch-eligibility` — `DispatchEligPlugin` in `server/plugins/dispatch/eligibility/registry.ts`
   - `charge` — `server/plugins/ledger/charge/types.ts`
   - `trust-eligibility` — `server/plugins/trust/eligibility/types.ts`
3. Register the plugin from the kind's `index.ts` (alongside the
   existing `registry.register(...)` calls).
4. Add the kind's domain-specific methods (e.g. `evaluate`,
   `runContent`, `execute`, `getEligibilityCondition`) directly on
   the plugin object — those live on the kind-specific interface,
   **not** on the shared registry.
5. For `dashboard` only: drop the React component at
   `client/src/plugins/dashboard/<your-id>/<ComponentName>.tsx` and
   name it on the manifest entry as `"<your-id>:<ComponentName>"`.
   The client glob in `client/src/plugins/dashboard/registry.ts`
   picks it up automatically — no static registry to edit.

That's it. The unified `/api/plugins/<kind>/manifest` endpoint will
expose the new plugin, gated by both the kind-level gate (set at
kind-registration time) and the per-plugin
`requiredComponent` / `requiredPolicy`.

### Gating precedence (always the same)

`enforcePluginGating` and `enforceKindGating` both apply
**component → policy**:

1. If `requiredComponent` is set and the component is disabled →
   block (403).
2. Else if `requiredPolicy` is set and the user fails the policy →
   block (403).
3. Else → allow.

Use `enforcePluginGating(meta, req)` at any kind-specific write edge
(charge admin writes, dispatch admin writes, trust admin writes,
dashboard `/content`). Do not re-implement gating in the kind.

---

## 2. Introducing a brand-new plugin kind

Only do this if your feature genuinely doesn't fit one of the
existing kinds. A "kind" is a category of plugin with its own
domain-specific interface (e.g. eligibility evaluators, charge
executors, dashboard widgets).

Steps:

1. **Define the plugin shape** in `server/plugins/<area>/<kind>/types.ts`.
   Decide whether base metadata lives flat on the plugin (like
   dashboard / dispatch-eligibility) or nested under `.metadata`
   (like charge / trust-eligibility). Either works — the registry
   extractor handles both.

2. **Create the registry** in `server/plugins/<area>/<kind>/registry.ts`:

   ```ts
   import { PluginRegistry } from "../../_core";
   import type { MyPlugin } from "./types";

   export const myPluginRegistry = new PluginRegistry<MyPlugin, MyManifestEntry>({
     kind: "my-kind",
     getMetadata: (p) => p.metadata ?? p, // flat or nested
     toManifestEntry: (p) => ({ id: p.id, name: p.name, /* ... */ }),
     // allowOverwrite: true, // only for kinds that hot-reload plugins
   });
   ```

3. **Register the kind** during boot (call from `server/app-init.ts`
   alongside the other `registerXxxPluginKind()` calls):

   ```ts
   import { registerPluginKind } from "../_core";
   import { myPluginRegistry } from "./registry";

   let kindRegistered = false;
   export function registerMyPluginKind() {
     if (kindRegistered) return;
     registerPluginKind({
       kind: "my-kind",
       registry: myPluginRegistry,
       requiredComponent: "my-feature", // optional kind-level gate
       requiredPolicy: "admin",         // optional kind-level gate
       sortEntries: (a, b) => a.id.localeCompare(b.id),
       // decorateEntries: async (entries, req) => { ... },
       // Optional admin capabilities — each opts the matching URL in.
       // Omit a callback to leave the matching route as a 404.
       // validateConfig: (plugin, config) => plugin.validateSettings(config),
       // getSettings:    async (plugin) => ({ schema, uiSchema, value }),
       // saveSettings:   async (plugin, value) => ({ valid: true }),
     });
     kindRegistered = true;
   }
   ```

   `decorateEntries` is the right place to inject runtime fields
   like a per-plugin `enabled` flag pulled from a variable — see
   `server/plugins/dashboard/index.ts` for the canonical example.

   The admin callbacks are documented on `PluginKindRegistration`
   in `server/plugins/_core/kinds.ts` and surfaced via the URL
   table at the top of this doc. Pick the subset that makes sense
   for your kind — `dashboard` uses all of them, the three
   admin-only kinds use just `validateConfig` today.

4. **Add the kind string** to the `PluginKind` unions in both
   `server/plugins/_core/types.ts` and
   `client/src/plugins/_core/manifest.ts`. The manifest endpoint
   itself needs no change — it dispatches on `:kind` via
   `getPluginKind(kind)`.

5. **Client-side (only if your kind ships React components)**:
   create `client/src/plugins/<kind>/registry.ts`:

   ```ts
   import { createPluginComponentRegistry } from "../_core";
   import type { MyPluginProps } from "./types";

   const registry = createPluginComponentRegistry<MyPluginProps>({
     kind: "my-kind",
     glob: import.meta.glob("./*/*.tsx", { eager: true }) as Record<
       string,
       Record<string, unknown>
     >,
   });

   export const hasMyComponent = (id: string) => registry.has(id);
   export const resolveMyComponent = (id: string) => registry.resolve(id);
   ```

   Component files live at
   `client/src/plugins/<kind>/<plugin-id>/<ComponentName>.tsx` and
   are referenced by the id `"<plugin-id>:<ComponentName>"` on the
   manifest entry. The glob string **must** be a literal — do not
   try to derive it from `kind` inside the helper; Vite resolves
   globs at build time and will refuse a dynamic pattern. The
   comment at the top of `createPluginComponentRegistry` says the
   same thing — please don't "simplify" it.

6. **Fetch the manifest** from client callers via the shared helpers
   in `client/src/plugins/_core/manifest.ts`:

   ```ts
   import { useQuery } from "@tanstack/react-query";
   import {
     pluginManifestQueryKey,
     pluginManifestUrl,
     fetchPluginManifest,
   } from "@/plugins/_core";

   const { data } = useQuery({
     queryKey: pluginManifestQueryKey("my-kind"),
     queryFn: () => fetchPluginManifest<MyManifestEntry>("my-kind"),
   });
   ```

   Do not hand-roll the URL — both the URL shape and the
   query-key shape must stay consistent across the codebase so
   cache invalidation works.

---

## Where domain-specific methods live

The shared registry is **deliberately** unaware of what each kind
*does*. Keep domain methods on the kind, not on the registry:

| Kind                    | Domain methods (examples)                                            |
| ----------------------- | -------------------------------------------------------------------- |
| `dashboard`             | `runContent(action, req)` — feeds `useDashboardContent`              |
| `dispatch-eligibility`  | `evaluate(worker, ctx)` — eligibility filter for a dispatch job      |
| `charge`                | `execute(ctx)` — produces ledger entries; uses `chargePluginKey`     |
| `trust-eligibility`     | `evaluate(worker, ctx)` / `getEligibilityCondition()`                |

If you find yourself wanting to put one of these onto
`PluginRegistry`, stop — it belongs on the kind-specific interface.
The registry's job is registration, lookup, listing, gating, and
manifest formatting. Nothing else.
