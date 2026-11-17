import type { SystemHelpEntry } from "./index";

/** Shared built-in prose only; local database help is never changed. */
export const ediTerminationGuidance = `
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
  events need last-covered evidence and a reconstructible historical family.
  Coverage corrections and any later reinstatement suppress old endings. Ambiguous
  employers and missing family evidence stop
  generation visibly; correct the evidence rather than guessing. Coverage-inferred
  history describes accepted stored coverage, not proof of a failed scan or complete
  legacy import. Demographics use retained current contact records, not archived addresses.</p>
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
  summary: "For Trust Provider EDI wizards, review saved termination settings, historical evidence and generated records before downloading or delivering files.",
  details: `<h3>Purpose</h3><p>This guidance applies only to the Trust Provider EDI wizard, not enrollment or upload wizards.</p>
    <h3>Before you start</h3><p>Administrator access and Providers EDI are required. Delivery sends sensitive records to the configured carrier destination.</p>
    <h3>How to use this page</h3>
    ${ediTerminationGuidance}`,
};
