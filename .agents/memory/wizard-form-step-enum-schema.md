---
name: Wizard form-step enum schema shape
description: Render readable wizard choices with oneOf titles without accidentally selecting the first value
---

For wizard `form`-kind single-select choices that need user-facing labels,
use `oneOf: [{ const, title }]` in the app's `JsonSchema`. `const` is now
part of that type, and the RJSF select renders the titles; `enumNames` may
instead leave raw enum values visible.

Required `oneOf` fields can default to the first `const` when the form has
no saved value. For a form where the user must make an explicit choice,
pass `experimental_defaultFormStateBehavior` with `constAsDefaults:
"skipOneOf"` and validate the live value before Next.

**Why:** a completed older step with an unavailable or missing selection
must not become actionable through an implicit first choice, and raw ids
are not clear user-facing labels.

**How to apply:** use `oneOf` titles for labeled wizard choices, opt out of
implicit `const` defaults on required user decisions, and keep server
validation as the final authority.
