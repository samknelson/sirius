# Grievance component browser verification

## Method and limits

Checked on 2026-11-25 in headless Chromium through the running development
preview proxy. Puppeteer clicked the actual application's contributed routes,
forms, navigation and lazy-loaded page slots; this was not a replacement page
or a hand-built mock UI.

No authenticated human session was available. Authentication, access decisions,
and API data were intercepted **only in the test browser**. The session fixture
represented staff with admin permission (needed for Configuration and editing
the grievance ID). Stateful response fixtures accepted the actual form requests
and returned their submitted data on subsequent reads.

Consequently, the checks below establish client rendering, request wiring,
successful-response handling, refresh and navigation behavior. They do **not**
establish real sign-in, database persistence, server authorization, object
storage availability, denormalization, vendor delivery, or translation behavior.
The earlier backend/removal-sequence verification was not repeated here.

No application authentication bypass, saved component-state change, durable
fixture records, dependency changes or permanent UI test suite was added.
The one-off runner, response fixtures, request log and screenshots were placed
in the already ignored `generated-artifacts/` directory.

## Results

The final one-off run passed all 19 explicit assertions, without uncaught
browser errors:

| Surface | Browser interaction and result |
| --- | --- |
| Grievance list | Rendered a populated row and list/add actions. |
| Add | Selected a category, entered an ID, submitted the form and reached the new detail view with the submitted ID. |
| Edit | Changed the grievance ID, submitted PATCH, and reached the refreshed detail view displaying the change. |
| Detail | Rendered information, complaints/remedies empty states, worker/employer/representative sections and contributed tabs. |
| Contract edit slot | Lazy section rendered, contract picker opened, a contract was selected and PUT submitted; refreshed section displayed its name. |
| Contract view slot | Displayed the agreement saved through the edit section. |
| Contract disabled | Removing only `grievance.contract` from the browser auth fixture removed both view and edit sections while the host pages still rendered. |
| Status history | Opened Add Entry, selected status, saved, reopened Edit and saved the dated entry. The row refreshed. |
| Timeline configuration | Selected a timeline template on Status History and submitted the save. |
| Timeline | Rendered both empty-state and populated-step responses, including the current-step summary. Computation itself was fixture-supplied, not a server assertion. |
| Notes | Added a typed note, reopened Edit, changed its subject and saved; the list refreshed with the edited subject. |
| Files | Selected a local text file, confirmed upload, then renamed the returned attachment; the attachment list refreshed. Multipart request and response handling were exercised, not real storage. |
| Logs | Rendered shared Activity Logs, typed a module filter and observed the log API request. This is a read-only surface. |
| Settlements | Added a description and amount, saved, reopened Edit and changed the description; the row refreshed. |
| Worker Grievances | Opened the contributed worker route and rendered its grievance list. The actual shared registry placed Grievances immediately before Notes. |
| Employer Grievances | Opened the contributed employer route and rendered its grievance list. The actual shared registry placed Grievances immediately before School Attributes. |
| Main menu | Built the response from the actual default menu contribution tree; rendered Grievances before Users. Access filtering was fixture-supplied. |
| Configuration | Clicked Grievance, then Timeline Templates; added a template in its dialog and observed the refreshed row. |

The normal unauthenticated preview separately displayed the sign-in page.
Signed-in screenshots were captured by the one-off browser with its local
fixtures, not by weakening the app's route protection.

## Outcome

No regression requiring application code changes was found in the exercised
client flows. This report is the retained result; no runnable UI suite was
registered with the build or task-completion checks.
