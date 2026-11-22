import type { SystemHelpEntry } from "./index";
import { EDI_COVERAGE_REASONS } from "@shared/edi-coverage-choices";

/** The reasons use the same wording as the screen and the download. */
const REASON_ITEMS = Object.values(EDI_COVERAGE_REASONS)
  .map(({ label, meaning }) => `    <li><strong>${label}</strong>: ${meaning}</li>`).join("\n");

/** Shared built-in prose only; local database help is never changed. */
export const ediTerminationGuidance = `
  <p><strong>Postal address lines</strong></p>
  <p>Address Line 1 and Address Line 2 are sent in the carrier's existing address slots.
  Formats with only one street slot combine both lines within that slot's existing limit.
  Historical combined street text is not automatically split. Correct the contact address
  or replace it from an authoritative two-line import, then generate a new file.
  Address changes do not change coverage or termination settings.</p>
  <p><strong>Membership termination settings</strong></p>
  <p>For Trust Provider EDI membership files, <strong>Explicit subscriber terminations</strong>
  and <strong>Explicit dependent terminations</strong> independently include ended people.
  Neither setting filters active membership. Both off means termination by omission:
  ended people disappear from the file. These controls belong only to the wizard's
  <strong>Parameters</strong> step, not the carrier configuration. New runs start with
  subscriber terminations on, dependent terminations off, and lookback 1, regardless of
  obsolete settings on a live configuration. Local 11 hours files do not use these settings.</p>
  <p><strong>Termination lookback months</strong> is a whole number from 1 to 12, default 1.
  A November report with 1 includes coverage ending October 31 (the termination event is
  in November, the first uncovered month). With 2 it includes September 30 and October 31.
  January includes December 31 of the previous year; March includes February 28 or 29.
  Wider windows can repeat the same termination on successive reports; they are not
  delivery tracking or acknowledgement-based catch-up.</p>
  <p>Review the saved policy and edit <strong>Parameters</strong>, then select <strong>Save</strong>.
  Unsaved edits do not affect generation. Saving clears Results and delivery readiness;
  Generate again to use the new choices. You do not need to reselect Configuration.
  Reselection preserves termination choices but requires saving Parameters again and
  validates the new carrier's parameters. Configuration still owns benefit scope, carrier
  identity, file settings and destination, not termination policy.</p>
  <p>Older runs without run-owned choices retain their saved configuration snapshot's
  values; missing flags mean both off. Parameters shows those actual values, including
  false. Saving makes them run-owned; new-run defaults never activate an older run.
  Existing generated files are not changed just by opening a run. Retry uses saved
  choices. Settings cannot be saved during active generation; wait for a terminal result.
  Historical failures before a settings save do not validate newly saved choices.</p>
  <p>Completed generation policy describes its saved rows, not unsaved form edits.
  Review Results, then download the Provider file and Carrier-layout CSV before sending.
  Results show Termination role, Last covered date and Termination evidence. Deliver
  shows subscriber/dependent termination counts and warns about inferred history.</p>
  <p>A missing monthly record alone never creates a termination. Retained termination
  events need last-covered evidence and the person's family for that last covered month.
  Coverage corrections and any later reinstatement suppress old endings. Conflicting
  coverage is never resolved by a manual choice; missing family evidence stops
  generation visibly and must be corrected rather than guessed. Coverage-inferred
  history describes accepted stored coverage, not proof of a failed scan or complete
  legacy import. Demographics use retained current contact records, not archived addresses.</p>
  <p><strong>Coverage segments</strong>: employer Sirius IDs COBRA and 13226164
  identify COBRA for membership EDI. Employer names and database IDs do not.
  October ordinary employer coverage followed by November COBRA starts the COBRA
  segment November 1; December ordinary employer coverage starts a new segment
  December 1. Continuing the same benefit does not add a termination for the old
  classification. Ordinary employer changes do not restart dates, and equivalent
  same-family employer rows are selected deterministically without duplicate output.
  A true benefit ending uses the final classification's segment start and last-covered date.</p>
  <p><strong>Coverage start dates and endings</strong> use maintained coverage spans.
  Spans summarize granted coverage; they do not create eligibility. Source-family
  and COBRA changes start new classification segments, while ordinary employer changes
  do not. A last-covered month alone does not prove a termination: retained ending
  evidence must support it. Family relationships identify the subscriber and dependent;
  relationship dates do not independently decide entitlement.</p>
  <p>Coverage checks distinguish initial backfill, stale or processing records, failed
  records, and ready records. An empty span list is not proof of no coverage while
  maintenance is incomplete. The check reports counts across the worker maintenance
  population and refuses to estimate dates. Ask an administrator to verify
  <strong>Worker benefit coverage spans</strong> under denormalization settings.
  Backfill queues missing initial records; recompute processes stale records.
  Failed records need administrator review before rebuilding. Do not clear coverage
  or run eligibility scans to refresh this reading. Files that include endings also require <strong>Trust WMB
  Terminate Events</strong> to be enabled and fully current; ready spans cannot
  substitute for unfinished ending evidence. Then select <strong>Check coverage again</strong>. Backfill queues
  work; it does not mean computation has finished. Coverage changed during a check
  or generation requires another check and generation before delivery.</p>
  <p><strong>Saved failed coverage check</strong> shows a historical result and its
  recorded finish time (or start time for older checks), not current maintenance
  counts. Older checks without a timestamp say so. Refresh the relevant denorm
  detail page with <strong>Refresh counts</strong>. A pending or requeued WMB scan
  temporarily makes its prior summary unavailable. When it finishes, a changed
  termination or an affected inferred ending can queue new span work. Finish pending
  and processing scans, then let <strong>Trust WMB Terminate Events</strong> and
  <strong>Worker benefit coverage spans</strong> become current before retrying.
  <strong>Check coverage again</strong> starts a new read after a confirmed failure;
  once admitted, it replaces the old failure display with progress. A refused or
  unavailable admission does not erase the saved failure. A new check still refuses
  any genuinely missing, stale, processing or failed maintenance records.</p>
  <p><strong>Coverage ending evidence needs correction</strong> is different from
  unfinished maintenance. An OK maintenance count means computation finished,
  not that every ending has consistent evidence. A
  <strong>termination-coverage-missing</strong> issue means a retained termination
  lacks coverage for the immediately preceding month. Ask an administrator to
  compare the original scan's previous-month evidence and the authoritative
  coverage history. A failed continuation can also delete current-month-only
  coverage; that alone does not prove a previous-month ending. Do not add coverage,
  delete events, run scans or repeatedly recompute just to pass the check.
  Historical inferred events require their own source-history review. Any
  approved repair must preserve scan evidence and be followed by a fresh check;
  a check never generates or delivers a file.</p>
  <p><strong>Coverage sources</strong> shows which coverage records a membership file
  leaves out, and why, before you generate it. Coverage conflicts when one person has
  more than one coverage record for the same benefit and month with a different
  subscriber or dependent source, or a different COBRA classification. Nothing is
  chosen by hand: you no longer pick a winning source. Equivalent same-family,
  same-class duplicates are not conflicts and need no action.</p>
  <p><strong>Warning:</strong> a member left out of a replacement membership file may
  have their coverage ended by the carrier. Review every entry under
  <strong>Excluded from this file</strong> before you continue. To keep a person in the
  file, correct their coverage records, then select <strong>Check coverage again</strong>.</p>
  <ol>
    <li>Open <strong>Coverage sources</strong>. A coverage check starts in the background
    or reconnects to a check that is already running.</li>
    <li>Wait for the check to finish. Progress names the current stage; stages without a
    known total do not show a percentage.</li>
    <li>Review <strong>Excluded from this file</strong> and <strong>Warnings (not excluded)</strong>.
    Each entry names the person, benefit, coverage month, coverage record IDs, employer,
    subscriber or relationship source, COBRA classification and the reason.</li>
    <li>Select <strong>Download exclusion list</strong> if you need the complete list as a
    CSV file. The file contains personal information; handle it as you handle the carrier file.</li>
    <li>When anything is excluded, tick the confirmation and select
    <strong>Acknowledge exclusion list</strong>. An administrator must do this before Generate.</li>
    <li>Select <strong>Next</strong> to reach Generate. When nothing is excluded, no
    acknowledgement is needed.</li>
  </ol>
  <p><strong>What each reason means</strong></p>
  <ul>
${REASON_ITEMS}
  </ul>
  <p>Warnings do not remove anyone from the file. Long lists show the first entries on
  screen with a search box, a reason filter and pages; the download always contains
  every entry. An hours-only file shows <strong>Not applicable</strong> and does not
  read coverage sources.</p>
  <p>Dependents whose family relationship or subscriber coverage is missing for the
  month are not excluded. They stop the check with a correction-required message that
  names the records, because the file cannot invent a subscriber for them.</p>
  <p>Excluding records is a <strong>temporary rule</strong> while existing dual coverage
  is corrected. It is controlled by one site-wide setting,
  <strong>EDI_EXCLUDE_CONFLICTING_COVERAGE</strong>, on the
  <a href="/config/env">environment variables</a> page, and is on unless an administrator
  turns it off. With the rule off, any conflict in the months a file uses, or earlier in
  a person's current coverage run, stops the check with a correction-required message
  naming the records, and nothing is excluded. The step states which rule applies, and
  each generated file records the rule it used.</p>
  <p>To see every remaining conflict across all benefits and months in one place, an
  administrator can run the <a href="/reports/report_trust_coverage_conflicts">Conflicting Coverage</a>
  report under Reports, Trust. Use it to finish the cleanup before the rule is turned off.</p>
  <p>The check, the acknowledgement and the generated file never change coverage,
  relationship or employer records. They do not authorize dual coverage or change
  elections, billing, eligibility, lifecycle events or S1. An exclusion applies only
  to this wizard run.</p>
  <p>The acknowledgement names the exact list on screen and records the administrator
  and the time. A changed list, changed settings or a changed rule need a new check and
  a new acknowledgement. Generation reads coverage again: it stops if the list differs
  from the acknowledged one, and it fails the attempt if coverage changes while the
  file is being generated. Old or partial output is not downloadable.</p>
  <p>The exclusion list is saved with the generated file. <strong>Results</strong> and
  <strong>Deliver</strong> show how many coverage record groups were left out, the
  count for each reason, the rule and the acknowledgement, with
  <strong>Download exclusion list</strong>. Review the count before sending.</p>
  <p>Only administrators with Providers EDI access can open this step or acknowledge a
  list. Acknowledgement, settings changes and generation cannot overlap with an active
  check. A failed check excludes and acknowledges nothing: resolve what the message
  names, then select <strong>Check coverage again</strong>. An unavailable status is not
  a failed or successful job: use <strong>Refresh status</strong> to reconnect. A missing
  or stale heartbeat does not authorize another run; ask an administrator to investigate
  interrupted work. Background work is not guaranteed to survive a server restart.
  Saving Parameters or Configuration clears the check, the acknowledgement and prior output.</p>
  <p>Coverage checks have resource and database-wait limits to protect other users.
  There is no limit on how long a whole check may take. Exceeding a limit fails the
  whole check; it never accepts a shortened population or partial evidence. The
  refusal includes the exceeded dimension, measured amount, limit, last phase and a
  reference. Give that reference and the wizard run to an administrator; the
  application server console logs contain matching EDI coverage resource entries, not
  the in-app log viewer. Do not repeatedly retry an unchanged oversized run.</p>
  <p>A database failure names the phase and a diagnostic reference instead of showing
  a database query. Give the reference and wizard run to an administrator; matching
  EDI coverage database diagnostics are in the application server console, not the
  in-app log viewer. Follow the message's guidance before selecting
  <strong>Check coverage again</strong>. A cancelled query may be a statement timeout
  or another cancellation; it does not prove lifecycle records are missing.
  A failed database read accepts no partial review and generates no file.</p>
  <p>Older runs that saved manual source decisions show them under
  <strong>Earlier manual source decisions</strong>. They are read-only and are not
  applied when the run is generated again; regeneration uses the current rule. New
  manual decisions are refused. No step on this page sends a carrier file except Deliver.</p>
  <p>All nine membership carriers support generation with either, both or neither
  termination setting enabled: Delta, Hinge, MLK, Carelon, Dentwell (Dyntl/LADC),
  VSP, Kaiser, Health Net and Express Scripts. Enabled roles include qualifying
  ended people with their last-covered date in the carrier's existing end-date field.
  Existing status mappings, including blank fields, remain unchanged; no new
  termination codes are assigned. Generation support does not establish carrier
  acceptance of these field combinations. Confirm acceptance with the carrier before
  sending; date-format examples do not prove status-code or blank-field validity.
  Saving settings never sends a file or changes eligibility, COBRA or WMB inference.</p>`;

// Wizards share this route without a type segment; scope the prose explicitly.
export const ediWizardTerminationHelp: SystemHelpEntry = {
  id: "system:edi-wizard-terminations",
  paths: ["/wizards/%"],
  summary: "For Trust Provider EDI wizards, review saved termination settings, coverage left out of the file and generated records before downloading or delivering files.",
  details: `<h3>Purpose</h3><p>This guidance applies only to the Trust Provider EDI wizard, not enrollment or upload wizards.</p>
    <h3>Before you start</h3><p>Administrator access and Providers EDI are required. Delivery sends sensitive records to the configured carrier destination.</p>
    <h3>How to use this page</h3>
    ${ediTerminationGuidance}`,
};
