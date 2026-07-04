---
name: RJSF custom field onChange contract
description: A custom @rjsf/core v6 field's onChange 2nd arg is the field's OWN absolute path, not []; passing [] writes to the form root and corrupts formData.
---

In this repo's `@rjsf/core` v6.5.2, a custom **field** (`ui:field`,
`FieldProps`) and a custom **widget** (`ui:widget`, `WidgetProps`) have
different `onChange` signatures:

- Field: `onChange(newValue, path: FieldPathList, es?, id?)` — the
  **second arg is required** and is the field's **OWN ABSOLUTE path**
  (`(string|number)[]`) telling the form *where* to write the value.
  It is NOT relative and nothing upstream prepends it. Pass
  `props.fieldPathId.path`.
- Widget: `onChange(value, es?, id?)` — second arg optional.

**Why:** Built-in fields prove the contract — `StringField` calls
`onChange(value, fieldPathId.path, …)` and `ArrayField` uses
`childFieldPathId.path`. Passing `[]` means the **empty path = the form
ROOT**, so the field's value overwrites the entire formData object. This
caused two bugs in the staff-recipients picker: checkboxes never showed
checked (the field's property never updated) and Save failed with "must
be an object" (root became an array, failing `type:"object"`). An
earlier version of this note wrongly said to pass `[]` — that only
satisfied `tsc`; it was never verified at runtime.

**How to apply:** In any custom RJSF field, destructure `fieldPathId`
from props and call `onChange(next, fieldPathId.path)`. The field id
also lives on `props.fieldPathId.$id` in this version (not
`idSchema.$id` — that older prop may be absent on fields).
