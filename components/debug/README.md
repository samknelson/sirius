# Debug

This normal manifest-discovered component retains ID `debug`, the `debug`
record-viewer permission, its default-off flag and existing diagnostic URLs.
It has no schema and source removal never deletes flags, role assignments,
logs or cleanup settings. Stop, remove this directory, discover, rebuild and
restart to omit the feature; hot source removal is not supported.

## Access and behavior

- Event Bus (`/admin/debug/event-bus` and `/api/admin/debug/event-bus/*`)
  requires enabled Debug and admin access.
- Worker/employer/company JSON actions require enabled Debug and permission
  `debug`, in addition to the host record's normal access.
- `/api/dispatch-jobs/:id/eligible-workers-sql` requires enabled Dispatch,
  enabled Debug and admin access. SQL compilation uses the normal eligibility
  query builder. Ordinary worker listing and plugin construction stay in Dispatch.
- ECHP's date input is admin-only. Both eligibility and purchase send the input
  in their query and the query identity changes with it. Disabled/unmounted
  contributions no longer supply inputs. The server independently resolves the
  effective (possibly masqueraded) user and requires admin permission.
  Absent/disabled Debug uses the process-local current date.
- Private SAML observations capture success, access denial and SAML errors as
  `saml_debug`, with full assertions and mapping explanations. Failures are
  best-effort and cannot change authentication or role assignment. No raw
  observations go onto the event bus or into catalog entries. These captures
  use the log transport's private-entry option, bypassing normal LOG event
  publication while retaining the complete stored entry.

## Sensitive logging and retention

Full payload capture is intentional, not redacted. Restrict System Logs access.
Captures are not bound to entity/host log histories, which may have wider
audiences. Ordinary authentication failure logs independently include full SAML
responses; removal of Debug does **not** remove those normal auth logs.

While enabled, Debug suggests a **disabled** seven-day `saml_debug` cleanup
policy. Administrators must opt in to both the policy and the separate Log
Cleanup cron. Absent/disabled Debug no longer supplies this suggestion. Explicit
stored policies still clean historical captures without Debug installed. No
retention duration or saved setting is rewritten.

The shared event-bus history, storm protection and notifier/template-preview
consumers remain host-owned.
