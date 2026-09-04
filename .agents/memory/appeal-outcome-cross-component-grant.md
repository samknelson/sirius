---
name: Appeal outcome cross-component grant pattern
description: How a case-workflow transition that must also write another component's table (exemption grant on appeal approval) is split between storage and service, and why staff UIs must not read the admin-only plugin manifest.
---

**Rule:** when a workflow transition owned by one storage module must also
create a row owned by another component (BAO appeal approval → trust
eligibility exemption), the transition storage owns the transaction and the
row lock and takes a *grant callback*; the service layer supplies the callback
(it can import plugin registries / component gates the storage cannot) and the
callback is invoked with the LOCKED row's identifiers, never the request body.
The other component's storage exposes an idempotent "get-or-create" grant
(advisory xact lock per worker+benefit, reuse when the normalized check set is
equal and the existing start is on or before the requested one).

**Why:** the grant and the status write must commit or roll back together,
and a retried approval must not duplicate exemptions; validation that needs
registries (plugin ids, component enabled) lives in the service so storage
stays a pure leaf. Bulk imports reuse the service entry point, not the route.

**How to apply:** any new "outcome" action on a case (or similar entity) that
side-effects another component: add a callback parameter on the storage
method, validate up front in the service, keep the outreach/resolution rules
inside the same transaction. Direct status edits into outcome steps are
refused with a dedicated error code so the only path is the action.

**Staff surfaces vs plugin manifest:** `/api/plugins/:kind/manifest` for
trust-eligibility is admin-gated (`requiredPolicy: "admin"`). A staff-facing
picker of eligibility checks must get its list from a staff-gated route in its
own module (e.g. the BAO cases module's literal `appeal-checks` route, which
must stay registered ahead of the `/:id` routes) — pointing the dialog at the
manifest renders an empty list for non-admin staff.
