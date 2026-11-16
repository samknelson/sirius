import type { SystemHelpEntry } from "./index";

/** Shared built-in prose only; local database help is never changed. */
export const ediTerminationGuidance = `
  <h3>Membership termination settings</h3>
  <p>For Trust Provider EDI membership files, <strong>Explicit subscriber terminations</strong>
  and <strong>Explicit dependent terminations</strong> independently include ended people.
  Neither setting filters active membership. Both off means termination by omission:
  ended people disappear from the file. Existing configurations and saved runs without
  settings retain that behavior. Local 11 hours files do not use these settings.</p>
  <p><strong>Termination lookback months</strong> is a whole number from 1 to 12, default 1.
  A November report with 1 includes coverage ending October 31 (the termination event is
  in November, the first uncovered month). With 2 it includes September 30 and October 31.
  January includes December 31 of the previous year; March includes February 28 or 29.
  Wider windows can repeat the same termination on successive reports; they are not
  delivery tracking or acknowledgement-based catch-up.</p>
  <p>The wizard saves the configuration selected at its Configuration step. Editing the
  live configuration does not change that selection or existing generated rows. Reselect
  the configuration, enter Parameters again and Generate to adopt edited settings.
  Review Results, then download the Provider file and Carrier-layout CSV before sending.
  Results show Termination role, Last covered date and Termination evidence. Deliver
  shows subscriber/dependent termination counts and warns about inferred history.</p>
  <p>A missing monthly record alone never creates a termination. Retained termination
  events need last-covered evidence and a reconstructible historical family.
  Coverage corrections and any later reinstatement suppress old endings. Ambiguous
  employers, missing family evidence and unsupported carrier status coding stop
  generation visibly; correct the evidence rather than guessing. Coverage-inferred
  history describes accepted stored coverage, not proof of a failed scan or complete
  legacy import. Demographics use retained current contact records, not archived addresses.</p>
  <p>Delta, Hinge and MLK currently support date-only explicit records. Carelon,
  Dentwell (Dyntl/LADC), VSP, Kaiser, Health Net and Express Scripts require confirmation
  of their status-field contract before explicit generation; their configuration explains
  the specific blocker. Date-format examples are not authorization to invent a status
  code or assume blank is valid. Leave both settings off for omission mode until resolved.
  Saving settings never sends a file or changes eligibility, COBRA or WMB inference.</p>`;

// Wizards share this route without a type segment; scope the prose explicitly.
export const ediWizardTerminationHelp: SystemHelpEntry = {
  id: "system:edi-wizard-terminations",
  paths: ["/wizards/%"],
  summary: "For Trust Provider EDI wizards, review saved termination settings, historical evidence and generated records before downloading or delivering files.",
  details: `<h3>Purpose</h3><p>This guidance applies only to the Trust Provider EDI wizard, not enrollment or upload wizards.</p>
    <h3>Before you start</h3><p>Administrator access and Providers EDI are required. Delivery sends sensitive records to the configured carrier destination.</p>
    ${ediTerminationGuidance}`,
};
