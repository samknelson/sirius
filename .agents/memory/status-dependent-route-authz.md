---
name: Status-dependent route authorization
description: Permission checks that depend on an entity's current status must run inside the same serialization lock/tx as the transition
---

The rule: when a route's permission decision depends on the entity's CURRENT status (e.g. "only approvers may act on a *queued* case"), reading the status in the route handler and then calling the serialized transition is a TOCTOU bypass — a concurrent transition between the read and the lock lets an unprivileged actor act on the privileged state. Pass an `authorize(entity)` hook into the serialized action so the check runs on the freshly-loaded row under the lock.

**Why:** Task-completion review rejected a DC approver gate for exactly this race (non-approver bounce racing a queue transition).

**How to apply:** Any workflow action whose authz varies by state. Regression-test deterministically: hold `withCaseSerialization` (or equivalent), flip the state inside it, fire the request while holding, assert refusal after release. Also: a "view" access policy should not be gated on the same eligibility that gates *initiation* — otherwise the ineligibility message itself is unreachable; gate creation server-side, grant own-record read.
