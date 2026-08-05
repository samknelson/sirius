---
name: EDI member-model new fields
description: Adding a field to the provider-EDI EdiPerson model requires touching both the select columns AND the dependent-object literal.
---

# EDI member-model new fields

When adding a field to the provider-EDI `EdiPerson` model, updating the shared
`personColumns` select is NOT enough: `buildMemberUnits` constructs dependent
objects with an explicit field-by-field literal, so the new field silently
drops off dependents (subscribers get it via spread).

**Why:** adding `email`/`workerSiriusId` for the CSV EDI plugins passed for
subscribers but came back `undefined` on dependent rows until the dependent
literal was extended too.

**How to apply:** any new `EdiPerson` field → add it in three places: the
interface, `personColumns`, and the `dependents.push({...})` literal in
`buildMemberUnits`.
