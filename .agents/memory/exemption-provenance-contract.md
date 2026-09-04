---
name: Exemption provenance contract
description: How an eligibility exemption records WHERE it came from (e.g. a BAO Benefit Appeal), how reads expose it, and why request bodies never carry it.
---

# Exemption provenance lives at `data.source`, reads project to a view

**Rule:** provenance is a discriminated union (`kind` + minimal ids) stored under
`data.source` on the exemption row. The shared schema file owns the union, the
writer helper that builds the `data` payload, and the reader that projects a row
to the public view (`Omit<row,"data"> & { source | null }`). Storage returns
ONLY the view — raw `data` never leaves `server/storage/`. The HTTP create/update
schemas are strict and deliberately have no `data`/`source` field (a forged body
is a 400); only server-side writers (the appeal grant service) may stamp it.
`update` never touches `data`, so staff edits keep provenance. A row whose
`data.source` is present but malformed/unrecognised THROWS from the reader (500,
named row id) — a silent `null` would hide a writer bug and orphan the appeal link.

**Why:** the case row holds no pointer to the exemption; the case detail finds
its granted exemptions by reverse lookup (`data @> '{"source":{...}}'` jsonb
containment via `listBySource`). Any second key under `data` (writer-private
notes etc.) is therefore free to exist without leaking, and any new source kind
is one more union member — not a new column and not a migration.

**How to apply:** a new writer (another case type, an import) calls the shared
`…DataFor(source)` helper and adds its member to the union + a label in the
client `ExemptionSourceLabel`; never hand-write the JSON shape, never read
`row.data` outside storage. Type-only edits to `shared/schema*` still trip
`check-migrations` — the merge commit message must carry
`[skip-migration-check]` with the "type-only, no DDL" justification (the
constraint-name and version-collision checks still run). Run the check with
`--base=<your real base>`; `--base=origin/main` false-fails on version
collisions whenever origin/main has advanced and renumbered migrations.
