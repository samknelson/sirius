---
name: Ambient request-context flags for cross-cutting event behavior
description: How to add a per-request behavior flag (e.g. suppress notifications) without threading it through every emit call.
---

# Ambient request-context flags

When a request needs to change how downstream *events* behave (e.g. "suppress
notifications for this bulk update") without editing every `eventBus.emit(...)`
call site, carry the flag in the existing request-scoped `AsyncLocalStorage`
(`server/middleware/request-context.ts`) instead of adding it to event payloads.

**Pattern:**
- Add an optional field to `RequestContext`.
- Two ways to set it: (a) `captureRequestContext` reads an HTTP header and sets
  it (client-driven, the "attribute of the request" approach — good for
  client fan-out where one logical bulk op = N separate HTTP requests, e.g. the
  Employer Bulk Update dialog looping PUTs); (b) a `withX(fn)` helper that does
  `requestContext.run({ ...current, flag: true }, fn)` for a nested scope with a
  crisp auto-restoring boundary (good for server-side loops).
- Read it in exactly ONE consuming layer.

**Why check in the consumer, not `eventBus.emit`:** the bus fans out to many
listeners (charges, audit, cache invalidation, denorm…). Gating `emit` would
suppress ALL of them. To suppress only notifications, check the flag at the top
of the event-notifier dispatcher's per-event handler (same layer as flood
protection) and early-return.

**Why request-scoped beats session-scoped:** nothing to reset, and two
concurrent browser windows (one bulk, one normal) are naturally isolated —
each HTTP request is its own ALS scope.

**Related — automatic self-notification suppression:** the same dispatcher also
drops any recipient whose resolved `userId` equals `getRequestContext()?.userId`
(the acting user), so a user who triggers an event isn't notified about their own
action. This is per-recipient (a `.filter` on the resolved recipients), matched by
user id only, and fail-safe: no acting user (crons) or a recipient with no
`userId` = notify normally. Distinct from the opt-in `suppressNotifications` flag,
which suppresses the whole scope.

**Verified gotcha — onAfterCommit propagation:** events emitted via
`onAfterCommit` (transaction-context) still observe the flag, because the
after-commit queue is drained synchronously within the awaited `runInTransaction`
call, which runs inside the request's ALS scope. ALS propagates through
await/microtask continuations, so `getStore()` in the dispatcher handler returns
the same store. Default when there is NO context (crons/startup) is flag-absent,
i.e. behave normally.
