---
name: Token argument choices are frozen at registration
description: Why a token argument naming a runtime-minted id must stay free text, and how a leaf's reach is scoped
---

# Never declare `choices` for a token argument whose values are minted at runtime

A `TokenArgSpec.choices` list is read from the plugin's metadata, which is
built once when the plugin registers at boot. Chain validation checks a
supplied value against the COMPLETE declared list and rejects anything
outside it.

**Why:** if the list is populated from the database (ledger accounts,
plugin configurations, options rows), every record created after boot is
absent from the frozen list, so a template naming a brand-new record is
rejected as invalid until the process restarts. The author sees a valid
id called invalid, with nothing in the UI explaining why.

**How to apply:** declare `choices` only for a closed set that is part of
the code (media names, a fixed enum of formats). For an argument that
carries an id a user can mint — a sirius id, a config id, an account
number — leave it free text and resolve it at render time, returning null
when it does not resolve.

# A wizard type's identifier is its registered plugin id

An argument that names "a kind of upload" must take the wizard type id —
the id a wizard plugin registers itself under. That is what
/api/wizard-types returns as `name`, what the Upload Type select on the
employer compliance page and its `wizardType` query param carry, and what
the reports catalogue lists.

**Why:** `plugin_kind = 'wizard'` looks like the configurable counterpart
but is a dead end: it registers no config adapter, so it never appears on
the plugin-configurations admin page, no UI can create a row, and the
table is empty. An argument asking for such a sirius id is unsatisfiable,
and a verification script that inserts the row itself will not notice.

**How to apply:** before designing an argument around a `plugin_configs`
sirius id, confirm the kind actually registers a config adapter — the
kinds index endpoint is built by iterating the registered adapters, so a
kind missing from that page has no way to be configured.

# A "current date" default must be computed at render time

`TokenArgSpec.default` is a fixed string substituted into the args map
during evaluation. It is read from metadata built once at registration,
so it can only ever carry a constant.

**Why:** the same freeze that spoils `choices` spoils `default`. Declaring
a default of "this year-month" bakes in whatever month the server booted
in; every render after the month rolls over is silently wrong, and
nothing restarts to correct it until a deploy happens to occur.

**How to apply:** for any default that depends on when the token is
RENDERED, leave `default` undeclared, mark the argument optional, and
compute the fallback inside `resolve` when the supplied value is blank.
Say so in the argument's `description`, since the picker has no declared
default to show the author.

# A leaf's reach is by ENTITY KIND, not by root

`inputTypes: ["employer"]` means "any chain that has arrived at an
employer", which includes hops such as `worker.home_employer.<leaf>`. It
does NOT mean "only a chain that starts at the `employer` root": there is
no root-scoping mechanism on a leaf, and adding one would be a framework
change.

**Why:** this reads like a containment hole in review, but it is not one.
The leaf reads the employer it was handed, exactly as `employer.name`
does on the same chain — an author who can hop to that employer can
already read its fields.

**How to apply:** when a requirement says a token is reachable "only from
X", check whether it means the entity kind (what `inputTypes` gives you)
or the root. Kind is the normal reading, and the three things worth
verifying are: rejected as a bare root, rejected after a non-X entity,
accepted after any chain arriving at X.

# Half-resolved sentences

A leaf that composes prose from several lookups must return null when ANY
of them misses, so the chain renders the author's `defaultValue` (else
blank). A partial sentence with a name missing reads to the recipient as
a statement of fact.
