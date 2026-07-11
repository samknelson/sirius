---
name: Wizard form-step enum schema shape
description: How to declare a single-select dropdown on a wizard "form" step's JsonSchema
---

Wizard `form`-kind step schemas use the app's own `JsonSchema` type from
`@shared/json-schema-form`, NOT full JSON Schema. For a single-select
dropdown, declare the choices with `enum: [...]` plus a parallel
`enumNames: [...]` for the human labels.

**Do NOT use `oneOf: [{ const, title }]`** — `JsonSchema` has no `const`
key, so tsc fails with "Object literal may only specify known properties,
and 'const' does not exist in type 'JsonSchema'". `oneOf` exists on the
type but its members are `JsonSchema` (no `const`), so it's not the enum
mechanism here.

**Why:** the in-house form renderer reads `enum`/`enumNames`; the RJSF
`oneOf/const` idiom is a different library's convention and isn't wired up.

**How to apply:** any new wizard step of `kind: "form"` that needs a
picker — use `enum` + `enumNames`, indexes aligned.
