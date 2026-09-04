---
name: Environment-variable presentation is shared
description: Any surface that shows or edits a registered env var renders the one shared row component instead of reading the listing fields itself.
---

A surface that lets an admin see or change a registered environment variable
must render the shared env-variable row and drive its writes through the
shared env-variables hook. It must not read the admin listing's fields
(`source`, `overridable`, `released`, `hasShadowedOverride`,
`changeTakesEffect`) and draw its own badges, lock explanation or save call.

A caller that needs a different INPUT (a zone picker, a duration picker) hands
one in; the rules — whether editing is offered at all, what a save does, what
clearing means, what the admin is told when the deployment environment owns
the value — stay with the shared row.

**Why:** these fields interact (env-locked + overridable says something
different from env-locked + not overridable, and a shadowed override is only
meaningful in the first case). A second reading of them is a second, looser
copy that drifts: one screen tells an admin the value can be changed here
while the other explains why it cannot.

**How to apply:** when a feature screen wants to edit "the variable that
configures this feature", render the shared row on that screen with a custom
value editor. Do not add a route: the admin list/set/clear endpoints are the
only write path, and the hook is where the extra invalidation after a write
(e.g. what is now waiting on a restart) is declared.
