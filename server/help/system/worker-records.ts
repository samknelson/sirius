import type { SystemHelpEntry } from "./index";

export const workerRecordHelp: SystemHelpEntry[] = [
  {
    id: "system:worker-directory",
    paths: ["/workers", "/workers/add"],
    summary: "Find workers using the available filters, check existing identities before creating a record, and protect sensitive information in exports.",
    details: `
      <h3>Purpose</h3><p>Use the worker directory to find a person and open their record.</p>
      <h3>Before you start</h3><p>Directory access uses the worker-list policy; adding workers requires staff access. Filter and export availability depend on your permissions and enabled features.</p>
      <h3>How to use this page</h3><ol><li>Search existing workers using the available identity and record filters.</li><li>Open a matching record and confirm it is the intended person.</li><li>Before exporting, check the active filters and requested columns; the download can contain sensitive personal information.</li><li>If no matching person exists and you have create access, open Add and complete the required identity fields.</li></ol>
      <h3>Limitations and common problems</h3><p>A filtered empty list is not proof that a person is absent. Clear filters and check identifiers before creating a duplicate. A refused identifier or unavailable Sirius ID allocation requires staff review, not a fabricated identifier. Keep exports only in approved locations.</p>`,
  },
  {
    id: "system:worker-deletion",
    paths: ["/workers/%/delete"],
    summary: "Review the worker and deletion warning before permanently removing their record and associated contact information.",
    details: `
      <h3>Purpose</h3><p>Delete a worker only when removal, rather than a dated status correction, is the intended action.</p>
      <h3>Before you start</h3><p>The worker-delete permission is required. Deletion is permanent through this page and can be refused by related data constraints. Review linked hours, relationships, financial records, cases, and the associated contact before acting.</p>
      <h3>How to use this page</h3><ol><li>Confirm the worker's identity and Sirius ID.</li><li>Read the displayed list of records affected, including contact, phone numbers, addresses, and worker IDs.</li><li>Only if removal is authorized, select <strong>Delete Worker</strong> and confirm the named worker.</li></ol>
      <h3>Limitations and common problems</h3><p>There is no restore action here. Do not delete a worker merely to fix a name, employment end date, or duplicate financial obligation. If deletion fails, investigate linked records rather than repeatedly confirming or promising all external records were removed.</p>`,
  },
  {
    id: "system:worker-identity",
    paths: ["/workers/%/name", "/workers/%/ids", "/workers/%/birth-date", "/workers/%/gender", "/workers/%/work-status", "/workers/%/member-status"],
    summary: "Review and correct worker identity or dated status information, checking identifiers and history before saving changes used by other workflows.",
    details: `
      <h3>Purpose</h3><p>Maintain the worker's name, identifiers, birth date, gender, and available work or member status history.</p>
      <h3>Before you start</h3><p>Each field tab has its own access rules; being able to view a worker does not grant every edit. IDs and status maintenance are staff functions. Status tabs also depend on their enabled features.</p>
      <h3>How to use this page</h3><ol><li>Confirm the person and identifier type before editing.</li><li>Use the field's editor and correct any format or duplicate validation errors.</li><li>For dated statuses, check the effective date and existing history rather than overwriting a different period.</li><li>Save and inspect the displayed value or history.</li></ol>
      <h3>Limitations and common problems</h3><p>Names are not unique identifiers. A member or work status is not by itself proof of benefit coverage or dispatch availability. Removing a dated history entry can change the status derived for that period; review downstream use first.</p>`,
  },
  {
    id: "system:contact-information",
    paths: ["/workers/%/email", "/workers/%/phone-numbers", "/workers/%/addresses", "/users/%/contact/email", "/users/%/contact/phone-numbers", "/users/%/contact/addresses", "/employer-contacts/%/email", "/employer-contacts/%/phone-numbers", "/employer-contacts/%/addresses", "/trust-provider-contacts/%/email", "/trust-provider-contacts/%/phone-numbers", "/trust-provider-contacts/%/addresses", "/facility/%/email", "/facility/%/phone-numbers", "/facility/%/addresses"],
    summary: "Maintain the displayed contact's email, phone numbers, or addresses while keeping contact accuracy separate from verification and communication consent.",
    details: `
      <h3>Purpose</h3><p>Review and update the contact information used by linked records and communication workflows.</p>
      <h3>Before you start</h3><p>Read and edit permissions vary by entity and field. Check whose contact is being edited: a contact may be shared through linked user or organization records.</p>
      <h3>How to use this page</h3><ol><li>Review existing entries and the preferred or active choice where offered.</li><li>Enter the actual email, phone, or postal address using the editor's format requirements.</li><li>Check effective dates, verification, and opt-in indicators where shown.</li><li>Before removing an entry, consider messages and workflows that use it; save only the intended change.</li></ol>
      <h3>Limitations and common problems</h3><p>Saving an address does not prove successful map lookup or postal delivery. Saving a phone or email does not itself establish verification or consent. A contact correction is not a new login identity or an automatic message resend. If a lookup or save fails, use the displayed error rather than creating duplicate entries.</p>`,
  },
  {
    id: "system:worker-relationships",
    paths: ["/workers/%/relations"],
    summary: "Maintain dated relationships between workers, checking direction and relationship type before changes affect dependent and enrollment evidence.",
    details: `
      <h3>Purpose</h3><p>Record how two worker records are related.</p>
      <h3>Before you start</h3><p>The relationships feature and appropriate worker access are required. Both workers must be identified correctly; an enrollment's selected dependents are separate from the relationship record.</p>
      <h3>How to use this page</h3><ol><li>Review existing relations before selecting <strong>Add Relation</strong>.</li><li>Check <strong>Worker 1 (from)</strong>, <strong>Worker 2 (to)</strong>, and <strong>Relation type</strong>.</li><li>Set Start date and End date where appropriate, then save.</li><li>Before <strong>Remove Relation</strong>, review dependent elections and coverage that refer to it.</li></ol>
      <h3>Limitations and common problems</h3><p>Direction matters; do not reverse people merely to obtain a desired label. A relation alone does not enroll or cover a dependent. Date changes or removal can change evidence used by later scans; review the affected election separately.</p>`,
  },
  {
    id: "system:employment-hours",
    paths: ["/workers/%/employment/current", "/workers/%/employment/history", "/workers/%/employment/monthly", "/workers/%/employment/daily", "/hours/%"],
    summary: "Review employer and period-specific work records, and check downstream coverage and ledger effects before correcting or deleting reported hours.",
    details: `
      <h3>Purpose</h3><p>Use Current and History for employment context and Monthly or Daily for reported hours. Open an hours entry to inspect its source fields.</p>
      <h3>Before you start</h3><p>Worker employment access allows the available read views; editing and deleting hours are staff actions. Check employer, employment status, year, month, and day.</p>
      <h3>How to use this page</h3><ol><li>Select the relevant work period and employer.</li><li>Compare totals with individual entries; hours and monetary amounts are not interchangeable.</li><li>If authorized, edit the intended entry and verify Hours, Job Title, and Home where offered.</li><li>Before saving or deleting, review billing and benefit consumers of this work period.</li></ol>
      <h3>Results and status meanings</h3><p>Work-month records can grant coverage in a later month according to configured rules. A zero total with records differs from no reported records. Saving hours can affect downstream charge and scan work, but does not prove all queued recalculation has completed.</p>
      <h3>Limitations and common problems</h3><p>Resolve duplicate-period or required-employer errors against the actual source report. Do not insert another row to compensate for a slow refresh. Deleting hours is not an automatic refund or a guaranteed reversal of coverage.</p>`,
  },
  {
    id: "system:worker-time-off-sick",
    paths: ["/workers/%/employment/tos", "/config/workers/tos"],
    summary: "Review or configure Time Off Sick records and their dated limits without treating recorded time off as an automatic coverage decision.",
    details: `
      <h3>Purpose</h3><p>Use the worker tab for time-off evidence and configuration for the Time Off Sick rules offered by this deployment.</p>
      <h3>Before you start</h3><p>The Time Off Sick feature is required. Worker maintenance is staff-only; configuration requires administrator access.</p>
      <h3>How to use this page</h3><ol><li>Check the worker and the relevant dates or configured limits.</li><li>Review existing records before adding or correcting time off.</li><li>Check the affected period before saving or removing a record.</li></ol>
      <h3>Limitations and common problems</h3><p>This is not a substitute for local leave policy or an approval outside the system. Changes do not prove that dependent eligibility or queued consumers have been recalculated.</p>`,
  },
  {
    id: "system:worker-skills-certifications",
    paths: ["/workers/%/skills", "/workers/%/certifications", "/worker-certification/%"],
    summary: "Review worker skills and dated certifications, distinguishing a recorded qualification from current validity or eligibility for a particular assignment.",
    details: `
      <h3>Purpose</h3><p>Maintain offered skills and certification records and inspect individual certification details.</p>
      <h3>Before you start</h3><p>Skills and Certifications have separate optional components. View and maintenance permissions differ; certification editing is a staff action. Required option definitions must exist.</p>
      <h3>How to use this page</h3><ol><li>Review existing skills or certifications before adding one.</li><li>For a certification, select Certification, Start Date, End Date, Status, and any evidence message.</li><li>Check the dates and the source evidence before saving or changing status.</li></ol>
      <h3>Results and status meanings</h3><p>A certification's status and effective period both matter. Revoked or expired evidence is not a current qualification. A recorded skill does not itself assign a worker to a job.</p>
      <h3>Limitations and common problems</h3><p>If no choices are offered, ask an administrator to check the enabled feature and option definitions. Review downstream eligibility before removing a qualification; this page does not promise instant reassignment.</p>`,
  },
  {
    id: "system:worker-ratings",
    paths: ["/workers/%/ratings"],
    summary: "Record configured worker ratings on the zero-to-four scale, using None to remove a value rather than recording a zero.",
    details: `
      <h3>Purpose</h3><p>Review performance ratings under the configured rating-type hierarchy.</p>
      <h3>Before you start</h3><p>This is a staff tab and requires Worker Ratings. Rating types must be configured first.</p>
      <h3>How to use this page</h3><ol><li>Locate the intended rating type.</li><li>Select a value from 0–4; the selection saves the rating.</li><li>Select <strong>None</strong> only when the value should be removed.</li></ol>
      <h3>Limitations and common problems</h3><p>Zero is a recorded rating, not missing information. No types configured differs from a worker with no ratings. If saving fails, review the error and current value before changing another row.</p>`,
  },
  {
    id: "system:union-records",
    paths: ["/workers/%/union/bargaining-unit", "/workers/%/union/steward", "/bargaining-units", "/bargaining-units/%", "/stewards", "/config/bargaining-units", "/config/steward-settings", "/employers/%/union/stewards"],
    summary: "Review bargaining-unit and steward assignments with their employer scope and dates before changing shared union records or settings.",
    details: `
      <h3>Purpose</h3><p>Maintain available bargaining-unit and steward records and inspect assignments from worker or employer tabs.</p>
      <h3>Before you start</h3><p>These features are optional and use separate tab and action checks. Configuration requires its own access; being linked to an employer does not grant all staff maintenance actions.</p>
      <h3>How to use this page</h3><ol><li>Confirm the worker, employer, and shared definition being changed.</li><li>Review dated assignments before adding or correcting a record.</li><li>Check affected memberships before deleting a bargaining unit or changing steward settings.</li></ol>
      <h3>Limitations and common problems</h3><p>A shared definition can be used by many workers. An assignment does not by itself establish benefit coverage. If removal is refused because of linked records, investigate those links rather than deleting unrelated data.</p>`,
  },
  {
    id: "system:cardcheck-records",
    paths: ["/workers/%/union/cardchecks", "/cardchecks/%", "/cardcheck-definitions", "/cardcheck-definitions/%"],
    summary: "Review cardcheck evidence and the definition it satisfies before changing a worker's record or a shared cardcheck requirement.",
    details: `
      <h3>Purpose</h3><p>Track cardchecks and maintain definitions used to assess completeness.</p>
      <h3>Before you start</h3><p>Cardchecks must be enabled. Worker reading, record maintenance, and definition changes have their own access checks.</p>
      <h3>How to use this page</h3><ol><li>Check the worker and cardcheck definition.</li><li>Review dates, signature evidence, and any linked files available on the record.</li><li>Before editing or removing evidence, check the organizing and report workflows that use it.</li></ol>
      <h3>Limitations and common problems</h3><p>A missing cardcheck means the required recorded evidence was not found; it does not establish a person's intent. Editing a shared definition can change completeness for many workers. Do not treat a record edit as a newly obtained signature.</p>`,
  },
  {
    id: "system:worker-bans",
    paths: ["/workers/%/bans", "/config/workers/ban"],
    summary: "Review dated worker bans and their configured behavior before adding, changing, or removing restrictions that can affect dispatch acceptance.",
    details: `
      <h3>Purpose</h3><p>Maintain worker ban records and, separately, administrator ban-notification settings.</p>
      <h3>Before you start</h3><p>The worker tab depends on Dispatch; writes require staff access. Notification configuration has its own component and administrator gate. Ban types determine behavior and any required arguments.</p>
      <h3>How to use this page</h3><ol><li>Review existing bans and active dates.</li><li>Choose Type and complete its required fields, Start Date, optional End Date, and Message.</li><li>Before saving or <strong>Remove Ban</strong>, review how this type restricts the worker and whether configured notifications may be triggered.</li></ol>
      <h3>Results and status meanings</h3><p>A ban's type and scope matter; not every ban is an unconditional block. Acceptance checks still enforce applicable restrictions even if an older eligibility list was loaded.</p>
      <h3>Limitations and common problems</h3><p>Removing a ban does not guarantee eligibility, availability, or an assignment. Changing notification settings is not the same as creating or removing a ban.</p>`,
  },
  {
    id: "system:worker-linked-user",
    paths: ["/workers/%/user", "/employer-contacts/%/user", "/trust-provider-contacts/%/user", "/users/%"],
    summary: "Review the linked sign-in account and access settings before creating or changing a user associated with a worker or organization contact.",
    details: `
      <h3>Purpose</h3><p>Review the user account associated with the displayed person or contact.</p>
      <h3>Before you start</h3><p>Worker linkage is a staff function; contact-user linkage uses the organization's management policy. User administration has separate checks. Login features and required roles must be configured.</p>
      <h3>How to use this page</h3><ol><li>Verify the person's existing contact email and any linked account.</li><li>Review active state, required roles, and optional roles where offered.</li><li>Before saving, check which person's sign-in access and organization scope will change.</li></ol>
      <h3>Limitations and common problems</h3><p>A worker, contact, and user are different records. Do not create another user merely because a sign-in provider changed. Required roles can be assigned automatically; optional roles must not be used to bypass scope checks. Contact linkage can expose organization data to that user, so verify identity first.</p>`,
  },
  {
    id: "system:record-dashboard",
    paths: ["/workers/%/dashboard", "/users/%/dashboard"],
    summary: "Review the dashboard for the displayed linked user, recognizing that available content follows that user's access and configured dashboard plugins.",
    details: `
      <h3>Purpose</h3><p>Inspect the dashboard associated with a worker's linked user or the displayed user record.</p>
      <h3>Before you start</h3><p>Access to these record tabs is required. Viewing another user's dashboard does not transfer their identity or authorize every action they might perform.</p>
      <h3>How to use this page</h3><ol><li>Check whose user record supplies the dashboard.</li><li>Review the available plugin content and follow only authorized links.</li></ol>
      <h3>Limitations and common problems</h3><p>Missing content can reflect an absent linked user, plugin configuration, component state, or the target user's access. It is not proof that the underlying records do not exist. Use masquerade only through its separately authorized workflow, not as an assumption about this tab.</p>`,
  },
  {
    id: "system:worker-access-tokens",
    paths: ["/workers/%/aat"],
    summary: "Maintain worker access-link credentials carefully: regenerating the access UUID invalidates previously issued links, while these values are not sign-in passwords.",
    details: `
      <h3>Purpose</h3><p>Review Access UUID and Access Code for worker access-link workflows.</p>
      <h3>Before you start</h3><p>Worker-own access and the access-token feature are required. Treat these values and any resulting links as private credentials; never paste them into local help, notes, or shared messages.</p>
      <h3>How to use this page</h3><ol><li>Check whether an Access UUID already exists before selecting <strong>Generate</strong>.</li><li>Before <strong>Regenerate</strong>, understand that previously handed-out links stop working.</li><li>Use <strong>Save</strong> for an intended code change or <strong>Clear</strong> to remove the saved code.</li></ol>
      <h3>Limitations and common problems</h3><p>These credentials are not used to sign in. Their effect depends on the consuming link: authorized worker response links can accept an EDLS answer, while older schedule links remain read-only. Clearing a code is not the same as regenerating the UUID. There is no promise of restoring an old credential here.</p>`,
  },
];
