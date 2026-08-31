---
name: Quicksearch — a config's roles ARE the access decision
description: Why the global search kind gates on the configuration's role list instead of per-record checks, and the framework rules that keeps that safe.
---

## The rule

A `quicksearch` plugin config names a searcher plus the roles it is offered to.
**That role list is the whole access decision.** There is no per-record
permission check inside a searcher, and none should be added.

**Why:** a search box that re-checks every candidate row cannot use the
database to filter — it has to over-fetch and then discard, which is both slow
and a way to probe existence by timing. Granting a role a searcher is an
administrator saying "anyone with this role may see any record this finds".
Finding a record still implies nothing about *opening* it: the result links to
the record's own route, which gates independently.

**How to apply:** the runner resolves the caller's roles server-side and asks
the subsidiary storage for configs overlapping them. Nothing in the request
selects a plugin, a config or a role. An empty role set must match nothing
(the subsidiary turns it into `false`, not "no filter").

## Sensitive clauses are gated by the FRAMEWORK, not the plugin

A plugin declares `permissionGatedOptions` (setting key → permission key). The
runner forces each listed key to `false` before calling `search`.

**Why:** an SSN clause must not depend on a plugin author remembering to check,
and a config row switching SSN matching on must not become an end-run around
the permission. The gate only ever *removes* — it never turns an option on that
the config left off.

## Every clause must be droppable

Each searcher decides which of its clauses the typed string could plausibly BE
and drops the rest. A fixed OR across all configured fields turns the box into
an enumeration tool: three digits walk every identifier starting with them,
four digits confirm someone's SSN last-four, a year returns every record filed
in it. Identifiers match with `=` and the WHOLE value; a partial identifier is
not an identifier.

Keep that decision in a **pure planner function** separate from the SQL
(`planWorkerSearch`, `planGrievanceSearch`). A dropped clause is invisible in
the UI — it looks exactly like "nothing matched" — so it is only testable if it
is separable from the query builder.

## Failure is per-config, never per-request

Both the search AND the preflight (component check, policy evaluation,
permission gating) are isolated per config. A gate that *refuses* is silent; a
gate that *breaks* is reported as that group's failure. One slow or broken
searcher must not empty the dialog.

## Client: cmdk filters by default

`CommandDialog` / `Command` run their own client-side fuzzy filter. With
server-chosen results that silently drops rows that matched on something the
row does not display (an SSN, a phone number) — the user searches their own
phone number, the server finds them, and the list renders empty. Pass
`shouldFilter={false}` whenever the server decided what matches.
