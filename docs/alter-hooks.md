# Component alter hooks

An alter hook lets a core function compute a value, then pass it through
component-owned replacement functions. It is not an event bus, a plugin kind,
persisted configuration, or a grant-only authorization dispatcher.

## Declare, invoke, register

Declare beside the function that owns the result (shared code must not import
server implementations):

```ts
import { alterHooks } from "@shared/alter";

export const summaryHook = alterHooks.declare<
  string,
  { readonly recordId: string },
  { purpose: string }
>({
  id: "record.summary",
  description: "Alter a calculated record summary",
  semantics: "Return replacement text; do not mutate the context or write records.",
});

export async function summarize(recordId: string): Promise<string> {
  const calculated = "Summary";
  return alterHooks.run(summaryHook, calculated, { recordId });
}
```

In the owning component's server module, import that handle and register:

```ts
import { alterHooks } from "@shared/alter";
import { summaryHook } from "./summary"; // use the declaration's actual path

export function registerSummaryAlter(): void {
  alterHooks.register(summaryHook, {
    id: "edls.record-summary",
    component: "edls",
    priority: 10,
    description: "Append the scheduling summary",
    metadata: { purpose: "Explain the scheduling context" },
    async alter(previous, context) {
      return `${previous} (${context.recordId})`;
    },
  });
}
```

This is an example, not a second production consumer. Value, context and metadata
types are inferred from the hook handle at invocation and registration. Types
belong to the declaring core feature; core never imports optional component
types. Metadata is required (use `{}` when none is needed), plain finite JSON,
copied and deeply frozen at registration. It describes code, never requests.

## Lifecycle and ownership

Call each component registration function **unconditionally** from
`server/app-init.ts`, before `alterHooks.close(...)`. Do not condition registration
on enablement, schema existence, service role or maintenance mode. Registration
must not read tables. Component code owns its callback, requirements description
and optional-table queries. The comm entity loader remains core-owned.

Startup closes the registry with two injected capabilities: `isKnown` validates
every owner against the component definitions; `isEnabled` is checked immediately
before **each callback invocation**. Shared code imports no server services.
Disabled implementations are not called and cannot touch optional tables.
Toggling a component changes execution without re-registering anything.
This follows the existing component-state consistency boundary; it is not a new
transactional lock against a simultaneous component disable.

Duplicate hook/callback IDs, unknown hook handles, invalid identity/description,
nonfinite priorities, non-functions and non-JSON metadata are rejected at
registration. Unknown owners fail at closure. Running before closure or
registering after closure throws. Registrations and their metadata cannot change
after startup. Browser bundles can load shared declarations but cannot perform
server authorization: they have no closed server registry or server callbacks.

To add the next hook: declare beside its owner, invoke at the chosen boundary,
register implementations in their component modules, and wire those modules
before the existing closure. Do not create a new setter, registry, dispatcher,
catalog declaration or endpoint.

## Execution, context and errors

Priority is ascending. Equal priorities use ascending callback ID in JavaScript
code-point order (not locale or import order). Each callback is awaited before the
next starts and receives the previous replacement. No applicable callbacks
returns the original value, including object identity. Both sync and async
callbacks work. A replacement can grant, deny, transform or remove content as the
declaring hook's documented contract permits.

Treat the context as immutable, including nested values, and return a replacement
rather than mutating the prior value. `Readonly<Context>` prevents top-level
assignment but is not a sandbox or deep runtime freeze: capabilities may contain
live objects that cannot safely be frozen. Authorization callbacks must be
read-only and must not write, send notifications, or perform other side effects.

An availability check or callback failure aborts the chain and throws
`AlterExecutionError` with safe hook/callback IDs. No intermediate value is
returned; the original exception and request values are not attached. The
consumer owns its failure policy: propagate for ordinary computations, or catch
and deny for authorization. Do not silently recover by granting from an earlier
callback. Log the safe identity at the consuming boundary.

`comm.view` validates the ID first, calculates the existing broad read grant,
then runs the hook. Its EDLS implementation leaves grants unchanged, verifies the
communication exists, obtains stored links and loads fresh sheets before
delegating sheet access. Caller-supplied sheet data is never used. This retains
immediate relationship/permission revocation, missing-record behavior, effective
user handling and the existing read/write distinction. The policy keeps
`skipCache` and `noAdminBypass`. Its requirements are composed from typed callback
metadata; this is documentation, not a second execution hook.

## Catalog projection

After closing alter registration, startup registers the ordinary admin-gated
`alter-hooks` catalog, before catalog registration closes. The generic Catalogs
screens need no new routes or UI. Every declaration appears even with zero
callbacks. Each implementation is a separate component-owned entry containing
target, owner, priority, description and JSON metadata. Disabled implementations
are filtered by the existing catalog reader; never embed them in unfiltered hook
detail. No functions, live contexts or runtime results are projected.

The source set is frozen before the catalog's version becomes final. Component
changes use the existing catalog component revision. This does not change caching
for other executable-registry catalogs.

## Scope

Only communication viewing currently invokes a production hook. This is an
incremental extraction boundary, not physical component packaging, build-time
discovery, deployment profiles, a general lifecycle framework, or editable
priority/configuration. Existing plugin, event and catalog frameworks keep their
own responsibilities.
