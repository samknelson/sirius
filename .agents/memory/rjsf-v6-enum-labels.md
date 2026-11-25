---
name: RJSF v6 enum labels
description: The installed RJSF silently ignores enumNames; use titled single-value enum alternatives.
---

Use `oneOf: [{ enum: ["stored_value"], title: "Display label" }]` for a
labelled select in the installed RJSF version, not `enumNames`.

**Why:** `enumNames` is still accepted by this project's shared schema type,
and validation and typecheck pass, but the browser silently displays the raw
values. The shared schema type does not currently accept JSON Schema `const`,
so single-value `enum` alternatives work with both the type and RJSF.

**How to apply:** Whenever stored enum values need distinct human labels,
check the rendered picker, not just its schema. Keep the actual stored values
unchanged.
