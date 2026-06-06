---
name: RJSF custom field onChange contract
description: The @rjsf/utils FieldProps.onChange signature in this repo differs from WidgetProps; getting it wrong is a silent type error.
---

In this repo's `@rjsf/utils` version, a custom **field** (`ui:field`,
`FieldProps`) has a different `onChange` than a custom **widget**
(`ui:widget`, `WidgetProps`):

- Field: `onChange(newValue, path: FieldPathList, es?, id?)` — the
  **second arg is required** and is a `FieldPathList` (`(string|number)[]`).
  Pass `[]` (empty path = "this whole field changed").
- Widget: `onChange(value, es?, id?)` — second arg optional.

**Why:** Calling a field's `onChange(value)` with one arg fails tsc with
"Expected 2-4 arguments, but got 1"; passing `undefined` as the 2nd arg
fails with "not assignable to FieldPathList". Both wasted a round-trip.

**How to apply:** In any custom RJSF field, call `onChange(next, [])`.
Also note the field id lives on `props.fieldPathId.$id` in this version
(not `idSchema.$id` — that older prop may be absent on fields).
