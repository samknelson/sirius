---
name: Employer compliance dashboard access gating
description: What access boundary actually gates the /employers/compliance dashboard and its endpoints
---

# Employer compliance dashboard gating

Gate every `/employers/compliance` feature (dashboard, CSV export, contact
resolution) on **staff + ledger** — never on the bulk-messaging feature.

**Why:** The `bulk.edit` policy is effectively unsatisfiable for normal staff in
this app: it requires a `staff.bulk` permission that does not exist (only `admin`
and `staff` exist), plus the `bulk` component which is frequently off. Because the
policy's component check runs *before* the admin bypass, even admins are denied
when `bulk` is off. Gating the compliance CSV export on `bulk.edit` made the
button invisible/dead for everyone — that was the original bug.

**How to apply:** Match the dashboard's own boundary — UI actions gate on
`hasPermission("staff") || hasPermission("admin")`; endpoints gate on
`requireAccess("staff")` + `requireComponent("ledger")`. The compliance export is
not a bulk feature; do not couple it to `bulk`.
