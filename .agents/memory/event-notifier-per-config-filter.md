---
name: Event-notifier per-config filtering & link media
description: How to add per-config filtering to an event-notifier plugin, and how links differ across media.
---

# Event-notifier per-config filtering

An `EventNotifierPlugin`'s `getRecipients(ctx)` and `getMessage(medium, recipient, ctx)`
only receive the fired event `ctx` (event + payload) — **not** the individual
config's `data`. So any behavior that depends on the admin's per-config settings
(e.g. "only notify for grievance roles X and Y") cannot live in those methods.

**Rule:** for per-config gating, use the optional `shouldDispatch(ctx, configData)`
hook on the plugin. The dispatcher calls it in `dispatchForConfig` (after the
component-enabled check, before resolving recipients); returning `false` skips
that config for that event. Omitting the hook = always dispatch.

**Why:** the framework fans one fired event out to every enabled config of a
subscribing plugin; the only place that has both the payload and the specific
config's `data` is the dispatcher loop, exposed to the plugin via this hook.

**How to apply:** declare the filter field in the plugin's `configSchema`
(persisted into `config.data`), read it in `shouldDispatch` and compare against
the event payload. The framework's `validateConfig` validates `data` (minus the
`media` envelope) against `configSchema`.

# Links differ by medium

In-app messages navigate with a **relative** `linkUrl` (client-side routing).
Email and SMS leave the app, so they need a **fully-qualified** URL — build it
from `process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(",")[0]`
(same pattern the dispatch notifier uses) and embed it in the body text, since
`NotifierMessageContent` has no link field for email/sms.
