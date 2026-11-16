# Membership carrier terminations

All nine membership plugins compose the same opt-in policy. Local 11 hours
is excluded. `explicitSubscriberTerminations` and
`explicitDependentTerminations` default to false independently.
`terminationLookbackMonths` is an integer 1–12 (default 1); JSON schema
validation applies on config writes and runtime validation applies to saved runs.
Absent settings in old configs/snapshots mean omission, not activation.

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
Missing/mismatched relations, missing subscriber coverage and ambiguous historical
employers stop generation. Coverage start is specific to person, benefit, source
relation and employer; report keys include benefit, person, family and ending.
Only the selected person's row is persisted, never the other historical family
members. Historical batches are grouped by month so medical-plan lookups use the
last-covered month. Existing contact details are used; this is not an archive of
old mailing addresses. Retained relation records remain the identity authority;
deleted or incorrectly rewritten historical relations require data repair.
Accepted stored-coverage inference is not proof of complete legacy source history.

## Carrier reference inventory

| Carrier | End field / format | Explicit generation |
| --- | --- | --- |
| Delta | Eligibility Termination Date, 297–304, YYYYMMDD | Supported. Supplied Enterprise SFL Traders Handbook v1.1 says **last date of coverage**, member/dependent. Full-file action field remains blank; legacy generator also supplies this end date without a change action. |
| Hinge | term_date, YYYYMMDD | Supported date-only legacy layout: `attached_assets/edi_hinge_1785869374692.inc`, row mapping calls coverage_end_date; no action/status field. |
| MLK | TERM DT, YYYYMMDD | Supported date-only legacy layout: `attached_assets/edi_mlk_1785869374693.inc`, row mapping calls coverage_end_date; no action/status field. |
| Carelon | GRPEXP, YYYYMMDD | Blocked: MSTACD A/C is active/COBRA coding, not verified termination coding. |
| Dentwell / Dyntl / LADC | TerminationDate, YYYYMMDD | Blocked: supplied legacy generator leaves Status blank; validity for explicit termination is not established. |
| VSP | Vision Coverage End Date, YYYYMMDD | Blocked: Subscriber Status Code A/C is not verified termination coding. |
| Kaiser | Termination Date, YYYYMMDD | Blocked: blank Current Eligibility Status and Eligibility Status require confirmation. |
| Health Net | Coverage End Date, YYYYMMDD | Blocked: Pay Status Code AC/CO and blank dependent status require confirmation. |
| Express Scripts | Participant Expiration Date, YYYYMMDD | Blocked: blank Coverage Code Status requires confirmation. |

Carelon `20261031` and Delta/Dyntl `20260930` are analyst formatting examples,
not constants or status-code evidence. Existing encoders carry coverageEnd
unchanged into both native and carrier-layout QA output. Unsupported contracts
fail before reading population or persisting rows, even when no terms happen
to qualify; do not treat a quiet month as contract approval.

## Saved output and operation

The Configuration step saves the full config data; generation uses that snapshot.
To adopt edits, reselect Configuration, resubmit Parameters and Generate.
Parameters invalidate prior report metadata. Running/failed generation cannot
download or deliver an older or partial report. Preview columns identify role,
last covered date and inference; Deliver displays counts from persisted generation.
Downloads and SFTP serialize the same persisted rows and aggregate actual rows
for headers/trailers. Do not transmit QA CSV as a carrier file.

No live carrier configuration is enabled or edited by this change.
No carrier files are transmitted during verification.
