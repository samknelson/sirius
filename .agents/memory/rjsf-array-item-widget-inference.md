---
name: Picker widgets inside repeatable rows
description: Why an x-options-resource field inside an array item renders as a text box unless the plugin ships its own uiSchema
---

A config field tagged with a vendor key (`x-options-resource`, `x-widget`)
only gets its widget automatically when it is a top-level property or a
property of a nested **object**. The inference walks `properties` and recurses
into object properties; it does not walk an array's `items`.

So a field inside a repeatable row (a "rules" list, a table of entries) renders
as a plain text input with no warning — the schema looks right, the endpoint
exists, and the admin simply gets a free-text box where a dropdown was meant.

**Why:** the mapping was written for flat config objects, and an array of
strings carrying `x-options-resource` is legitimately handled at the array
level (multi-select), so recursing blindly into `items` would break that case.

**How to apply:** when a plugin's schema puts a picker inside an array item,
ship an explicit uiSchema naming that item field's widget; the generic admin
page passes a plugin's uiSchema through. An option list that "does nothing" in
the UI is usually this, not a broken route.
