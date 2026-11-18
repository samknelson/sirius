# Membership carrier terminations

All nine membership plugins compose the same **wizard-only** policy. Local 11
hours is excluded. New wizards persist `explicitSubscriberTerminations: true`,
`explicitDependentTerminations: false`, and `terminationLookbackMonths: 1`.
Lookback must be an integer 1–12. These are creation defaults, not runtime
fallbacks. Live carrier configuration values never seed new-run policy.

Saved run-owned policy wins. For legacy runs only, the selected configuration
snapshot supplies compatibility values; missing flags mean both off. Opening an
old run never changes its policy or output. Parameters seeds the actual saved
values (including false), and saving records run-owned choices. Input schema
validation and generation guards enforce the policy on the server.

## Calendar and evidence

November with 1 includes October 31 coverage ends, whose event is November.
With 2, September 30 is included too. January rolls back to December of the
previous year; March uses February 28/29. These are completed calendar months,
not rolling day counts. Wider windows intentionally repeat terms, not
acknowledgement-based catch-up.

An event must match the benefit and be backed by prior-month WMB coverage.
Confirmed events require a current persisted failed continuation action, excluding
execution errors and superseded queue attempts. Parent scans must explicitly name
the dependent; an unscoped parent action cannot terminate a child.
Retained `coverage_inferred` events are supported: these were explicitly produced
by the historical reconciler, not invented from current-month absence by EDI.
Their previous covered month is rechecked; current or later coverage (including
future reinstatement) suppresses an obsolete ending. No scans, event backfills,
eligibility changes or delivery calls are performed by population selection.

Historical WMB source relations identify the family, including ended relationships.
Missing/mismatched relations, missing subscriber coverage and mixed historical
COBRA/non-COBRA classes stop generation. Coverage start is specific to person,
benefit, source relation and COBRA classification, not ordinary employer identity;
report keys include benefit, person, family and ending.
Only the selected person's row is persisted, never the other historical family
members. Historical batches are grouped by month so medical-plan lookups use the
last-covered month. Existing contact details are used; this is not an archive of
old mailing addresses. Retained relation records remain the identity authority;
deleted or incorrectly rewritten historical relations require data repair.
Accepted stored-coverage inference is not proof of complete legacy source history.
Ordinary feed selectors still apply: Express Scripts' QMSCO-only file omits
subscribers and non-QMSCO dependents, and its exclude file omits QMSCO dependents,
for both active and ended people. A deliberately excluded row is not a
reconstruction failure; other missing historical rows remain errors.

## Carrier reference inventory

Membership EDI recognizes employer Sirius IDs `COBRA` and `13226164` as COBRA.
Names and database UUIDs are not classification rules. October ordinary employer
coverage → November COBRA → December ordinary employer coverage produces only the
current month's membership, starting November 1 and December 1 respectively.
Neither class change adds a termination while the same benefit continues.
An ordinary employer change does not restart the segment. Equivalent same-family
rows use the lowest WMB ID deterministically; distinct historical families remain
subject to ownership checks. A genuine loss uses the final class's segment start
and actual last-covered end date, with the existing event/scan evidence checks.

Mixed COBRA/non-COBRA rows for one person/benefit/month require correction before
successful generation. Validation precedes deduplication and includes active
subscribers, included dependents, and historical months consulted to determine
segment starts (including a classification boundary). Turning termination flags
off does not bypass active-population validation. The existing saved Generate
failure names person and benefit IDs, coverage month, WMB IDs, employer IDs and
Sirius IDs. Correct the conflicting coverage through an authorized process, then
Retry run. Neither class takes precedence, no separate diagnostics report is
created, and EDI generation never changes eligibility or coverage history.

| Carrier | End field / format | Explicit generation |
| --- | --- | --- |
| Delta | Eligibility Termination Date, 297–304, YYYYMMDD | Supported. Supplied Enterprise SFL Traders Handbook v1.1 says **last date of coverage**, member/dependent. Full-file action field remains blank; legacy generator also supplies this end date without a change action. |
| Hinge | term_date, YYYYMMDD | Supported date-only legacy layout: `attached_assets/edi_hinge_1785869374692.inc`, row mapping calls coverage_end_date; no action/status field. |
| MLK | TERM DT, YYYYMMDD | Supported date-only legacy layout: `attached_assets/edi_mlk_1785869374693.inc`, row mapping calls coverage_end_date; no action/status field. |
| Carelon | GRPEXP, YYYYMMDD | Supported; existing MSTACD A/C mapping unchanged. |
| Dentwell / Dyntl / LADC | TerminationDate, YYYYMMDD | Supported; Status remains blank. |
| VSP | Vision Coverage End Date, YYYYMMDD | Supported; existing Subscriber Status Code A/C mapping unchanged. |
| Kaiser | Termination Date, YYYYMMDD | Supported; Current Eligibility Status and Eligibility Status remain blank. |
| Health Net | Coverage End Date, YYYYMMDD | Supported; subscriber Pay Status Code AC/CO and blank dependent status unchanged. |
| Express Scripts | Participant Expiration Date, YYYYMMDD | Supported; Coverage Code Status remains blank. |

Carelon `20261031` and Delta/Dyntl `20260930` are analyst formatting examples,
not constants or status-code evidence. Existing encoders carry coverageEnd
unchanged into both native and carrier-layout QA output. All nine carriers support
generation with subscriber/dependent flags off/off, on/off, off/on and on/on,
subject to ordinary configuration and historical evidence prerequisites.
Enabled roles include qualifying ended people independently; disabled roles omit
ended people, never active members. Existing status, demographic, layout and COBRA
mappings remain unchanged. No termination-specific status codes are invented.
Generation is not proof of carrier acceptance: termination-specific status coding
and blank-field validity remain unverified where reference evidence is absent.
Confirm external acceptance before sending; this uncertainty does not block generation.

## Saved output and operation

The Configuration step still snapshots benefit/file/destination settings. Its
termination fields are no longer editable configuration controls. Reselecting a
configuration preserves the run's termination choices and revalidates carrier
parameters. Change termination choices directly in Parameters and Save, without
editing or reselecting the carrier configuration. Unsaved edits never affect
generation. Saving invalidates prior report metadata, delivery readiness and
current generation status; any prior failure is labeled historical, not a
validation of the new settings. Generate again after saving.

All valid termination combinations can be saved and generated in Parameters,
including Carelon. Both flags off selects omission mode, not a workaround for
status-contract restrictions. Direct requests and legacy runs retain parameter
validation and the same evidence and output-readiness safeguards.

Atomic admission and save checks prevent edits racing an active generation.
Completed generations retain the effective policy and encoding context alongside
their rows. Running/failed generation cannot
download or deliver an older or partial report. Preview columns identify role,
last covered date and inference; Deliver displays counts from persisted generation.
Downloads and SFTP serialize the same persisted rows and aggregate actual rows
for headers/trailers. Do not transmit QA CSV as a carrier file.

No live carrier configuration is enabled or edited by this change.
No carrier files are transmitted during verification.
