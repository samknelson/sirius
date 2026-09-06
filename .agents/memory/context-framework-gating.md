---
name: Context-framework gating (files/notes)
description: How the entity-files / entity-notes "context" frameworks decide an area is on, how the tab and route gates stay in step, and what a context id rename actually touches.
---

## Presence is the setting

An area is on when its context id has an entry in the framework's config
variable; absent = off. There is deliberately no `enabled: false` spelling —
two ways to say off is one too many, and both frameworks read presence.

**Why:** the files framework already read it that way; a second convention
would make "is this on?" a per-framework question.

**How to apply:** the config schema's per-context object may be empty (a home
for future per-area settings). Reject unknown context ids in the schema, so a
typo cannot be saved and silently do nothing.

## A hidden tab must imply a refusing route

Tab visibility is answered server-side (the tab-access endpoint) because the
operator's configuration is not client-visible. The route behind the tab
re-derives its requirements from the tab registry and never consulted that
endpoint, so a gate added only to the tab loop leaves the page reachable by
URL.

**Why:** a URL-reachable page for a switched-off area renders a panel whose
every request refuses.

**How to apply:** when a tab declares a server-evaluated gate, the route guard
must consult the same answer (same query key, so it is a cache hit) and fail
closed while loading or on error. Registration/declaration checks can stay
client-side; anything an operator toggles cannot.

## Registration vs configuration are different questions

Validation of stored references (e.g. which areas a note type applies to) is
about REGISTRATION, not configuration: an area that is currently off must not
invalidate rows that name it, or switching it back on becomes a repair job.
Sweeps and other maintenance likewise iterate registered contexts, skipping
only those whose TABLE cannot exist (component off).

## A context id is stored in more places than its own rows

Renaming one costs a migration touching every surface that persists it: the
framework's own rows, any ownership discriminator string another table parses
(`<framework>:<contextId>`), and the KEYS of the config variable — which a
newly strict schema will reject on the next save. "Dev has no rows" is not
evidence the other two surfaces are empty elsewhere.

## Choices that come from a registry must resolve at read time

A field whose enum choices are built while its module is imported freezes the
registry as it was before boot registrations ran — an empty list, silently.
Resolve such choices when the definition (and any write-time allow-list built
from it) is read.
