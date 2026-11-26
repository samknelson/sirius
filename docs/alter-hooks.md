# Optional component registration

Optional components may export a `register` hook from their manifest's `startup`
module. It runs before permissions initialization and `alterHooks.close()`, so
their alters participate in the same closure and catalog as core
components. See [optional components](optional-components.md) for discovery,
build and retained-schema rules.

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
    id: "example.record-summary",
    component: "example",
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

`auth.sign-in.history-decision` is deliberately different from authorization.
Core authentication has already established the session; optional history may
capture/classify the immutable private observation and return decisions only.
Core catches availability/callback failures, discards all intermediate results,
and continues generic sign-in event delivery with null history decisions.
Only an explicit successful `restored-session` classification suppresses that
event. Neither the hook context nor arbitrary callback errors are published or
projected in catalogs. The history component registers its implementation through
`startup.register` before closure; registration itself reads no history tables.

`comm.view` validates the ID first, calculates the existing broad read grant,
then runs the hook. A relationship-based implementation leaves grants unchanged, verifies the
communication exists, obtains stored links and loads fresh parent records before
delegating parent access. Caller-supplied parent data is never used. This retains
immediate relationship/permission revocation, missing-record behavior, effective
user handling and the existing read/write distinction. The policy keeps
`skipCache` and `noAdminBypass`. Its requirements are composed from typed callback
metadata; this is documentation, not a second execution hook.

### Validated policy request inputs

`policyRequestInputsHook` is declared beside the policy evaluation endpoint.
An owner claims extra query keys only for its exact policy and returns validated
scalar values under those supplied keys. Every unclaimed key, invalid value,
reserved identity key or collision with server-loaded entity fields is refused.
The hook cannot replace the server-selected user, resource identity or records.
It runs with the existing component enablement checks.

### Menu trees before authorization

`menuTreeHook` is declared beside asynchronous menu resolution. It receives the
selected plugin's tree and ID before gate evaluation. Contributions may extend
existing parent gates here; additive nodes still use menu contributions.
Execution is asynchronous. A menu gate controls discovery only and never grants
access to a destination's routes or data.

## Catalog projection

After closing alter registration, startup registers two ordinary admin-gated
catalogs, before catalog registration closes. The generic Catalogs screens need
no new routes or UI:

- **Alter Hooks** (`alter-hooks`) lists every declared hook, even with zero
  callbacks. Entries use the plain hook id and retain the description, semantics,
  ordering, execution and error notes.
- **Alter Hook Implementations** (`alter-hook-implementations`) lists callbacks
  by plain callback id, ordered by hook id, then execution order within each hook
  (ascending priority, then callback id in code-point order). Each entry carries
  its owning component and description, with hook id, priority and frozen JSON
  metadata in detail.

Both derive their entries on read from the alter registry. Disabled
implementations are filtered by the existing catalog reader; never embed them
in unfiltered hook detail. No functions, live contexts or runtime results are
projected, and neither catalog needs a `type` discriminator.

The source set is frozen before the catalog's version becomes final. Component
changes use the existing catalog component revision. This does not change caching
for other executable-registry catalogs.

## Scope

Production hooks include communication viewing, `tabs.visibility` (hide an
authorized tab) and `tabs.entity-policy` (the base access policy for an entity
type's tab batch check; answer only for entity types the component owns). Facts
that must hold while a component is disabled — record-history exclusions, record
"go" access, notes/files context tables — are manifest/metadata/registration
data, not hooks, because hooks skip disabled components. There is no synchronous
run variant. This is an
incremental extraction boundary, not physical component packaging, build-time
discovery, deployment profiles, a general lifecycle framework, or editable
priority/configuration. Existing plugin, event and catalog frameworks keep their
own responsibilities.

## Worker-owned participation in retained hosts

These hooks are declared by the host producing the value. Component startups
register implementations unconditionally, before the hook registry closes;
normal component availability determines execution. Registration does not
query optional tables.

| Hook | Value and context | Default and refusal | Database contract |
| --- | --- | --- | --- |
| `trust.relationships.resolve` | Nullable relationship facts; discriminated pair, ID-list or subscriber context | Null means authority unavailable, distinct from an empty result. Dependent validation refuses before no-rules shortcuts. | Read-only, caller transaction. ID hydration is batched; the owner preserves pair direction and active-date semantics. |
| `record-go.resolve` | Nullable resolved destination and parent; known metadata context and record ID | Missing/unknown contexts and hook errors refuse. Owner must use one parent snapshot for both authorization and navigation. | Read-only lookup; no credential minting or identity fallback. |
| `employer.view.extend` | Boolean grant after the retained employer-view policy denies | False; removing stewardship never removes core staff/employer grants. | Read-only assignment check, caller transaction. |
| `events.participant-worker-facts` | Typed participant facts, including stewardship, for a worker | No optional facts. Not an independent authorization grant. | Read-only, caller transaction. |
| `cardcheck.organizing.stewards` | Optional typed report rows for the selected employers | Empty optional report section; execution errors propagate rather than masquerading as an empty report. | Owner performs its batched query; retained host composes the report. |

Retained metadata exclusions and record-navigation access declarations remain
static contributions, not enabled-only hooks. Synchronous dispatch eligibility
continues to use its existing plugin framework.
