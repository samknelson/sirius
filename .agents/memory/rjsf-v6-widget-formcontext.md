---
name: RJSF v6 widget formContext
description: Custom RJSF widgets no longer receive formContext as a prop in v6
---

In RJSF v6, fields (StringField etc.) pass `registry` to widgets but NOT a
direct `formContext` prop. Any custom widget reading `props.formContext`
silently gets undefined (e.g. an empty dropdown).

**Why:** v5→v6 API change; StringField's widget props list omits formContext.
**How to apply:** custom widgets must read `props.registry.formContext`
(optionally falling back to `props.formContext` for safety). When a custom
widget renders but shows no data, check this before suspecting the data flow.
