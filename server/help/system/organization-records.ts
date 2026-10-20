import type { SystemHelpEntry } from "./index";

const entityRoots = ["/workers/%", "/employers/%", "/trust/provider/%"];

export const organizationRecordHelp: SystemHelpEntry[] = [
  {
    id: "system:entity-notes",
    paths: [...entityRoots.map(root => `${root}/notes`), "/grievance/%/notes"],
    summary: "Record typed notes for the displayed entity, keeping subjects and tags useful while protecting sensitive information and preserving the intended context.",
    details: `
      <h3>Purpose</h3><p>Use Notes to record follow-up information, not to replace a case decision or a financial transaction.</p>
      <h3>Before you start</h3><p>You need the entity's note access and its Entity Notes area enabled. Offered note types must apply to this record type; BAO tags are conditional.</p>
      <h3>How to use this page</h3><ol><li>Check the entity and existing notes, clearing the type filter if needed.</li><li>Choose an applicable note type and enter a Subject and the relevant content.</li><li>Select available tags only when they describe this note.</li><li>Before saving or deleting, review the information and who can access this entity.</li></ol>
      <h3>Limitations and common problems</h3><p>A note does not send a message or complete an appeal outcome. Do not put passwords, access links, or payment credentials in notes. A hidden or removed note type may prevent reuse; ask an administrator to check its context rather than choosing an unrelated type.</p>`,
  },
  {
    id: "system:entity-files",
    paths: [...entityRoots.map(root => `${root}/files`), "/grievance/%/files"],
    summary: "Review and attach files to the displayed record using its configured file area, and check permanent deletion consequences before removing evidence.",
    details: `
      <h3>Purpose</h3><p>Manage files attached to this entity, including download and file details where offered.</p>
      <h3>Before you start</h3><p>Entity access and an enabled file area are required. New uploads need a configured filesystem, directory template, and allowed extension; offered file types can be scoped to this area.</p>
      <h3>How to use this page</h3><ol><li>Check the record and existing files before uploading another copy.</li><li>Use <strong>Upload file</strong> and choose the applicable Type where offered.</li><li>Review File details and download only to an approved location.</li><li>Before deleting, understand that deletion permanently removes the attachment and its stored file through this workflow.</li></ol>
      <h3>Limitations and common problems</h3><p>Existing attachments can remain readable when new uploads are not configured. A file is evidence, not an approval or a posted payment. If an upload is refused, check extension, size, file-area setup, and access rather than renaming an unsafe file to bypass validation.</p>`,
  },
  {
    id: "system:entity-related-work",
    paths: [...entityRoots.map(root => `${root}/cases`), "/workers/%/grievances", "/employers/%/grievances"],
    summary: "Find cases or grievances linked to this record and open the underlying workflow to review ownership, evidence, deadlines, and decisions.",
    details: `
      <h3>Purpose</h3><p>Use the related-work tab to locate the actual case or grievance rather than maintaining its outcome in an unrelated note.</p>
      <h3>Before you start</h3><p>The entity tab, linked workflow, and required components have separate access checks. BAO cases and grievances are different workflows.</p>
      <h3>How to use this page</h3><ol><li>Confirm the current entity.</li><li>Review the linked records and their dates or statuses.</li><li>Open the relevant case or grievance to inspect evidence and authorized actions.</li></ol>
      <h3>Limitations and common problems</h3><p>An empty list can mean no linked work or unavailable scope, not that no dispute exists elsewhere. Creating a second case does not resume an existing one. Use the destination's appeal or grievance guidance before consequential actions.</p>`,
  },
  {
    id: "system:entity-record-history",
    paths: [...entityRoots.map(root => `${root}/logs`), "/companies/%/logs", "/facility/%/logs", "/users/%/logs"],
    summary: "Review available record activity and provenance without assuming missing history proves that a record was never changed.",
    details: `
      <h3>Purpose</h3><p>Use Logs to investigate recorded changes for the displayed entity.</p>
      <h3>Before you start</h3><p>History access is separate from ordinary record viewing. Logs may include sensitive data; review and share only what is needed.</p>
      <h3>How to use this page</h3><ol><li>Confirm the entity and available filters or dates.</li><li>Compare recorded actions and actors with the current record.</li><li>Use linked source records where available to investigate unexpected changes.</li></ol>
      <h3>Limitations and common problems</h3><p>Imported or older records can lack retained history. Missing actor or date evidence must remain unknown; it is not a new event or proof that no change occurred. This page does not undo changes.</p>`,
  },
  {
    id: "system:employer-record-maintenance",
    paths: ["/employers", "/employers/add", "/employers/%", "/employers/%/edit", "/employers/%/workers", "/employers/%/contacts", "/employers/%/school-attributes", "/employers/%/dispatch"],
    summary: "Find and maintain employer records, checking linked workers, contacts, and optional site attributes before changing shared organization information.",
    details: `
      <h3>Purpose</h3><p>Maintain employer identity and navigate its linked work and contacts.</p>
      <h3>Before you start</h3><p>Lists and create actions require staff access. Some employer tabs allow scoped employer or steward users; this does not grant staff editing. Company, school, and dispatch features are conditional.</p>
      <h3>How to use this page</h3><ol><li>Search for an existing employer before adding another.</li><li>Check name, identifiers, active state, and company where offered.</li><li>Use Workers and Contacts to inspect links, not to assume every linked person's data may be edited.</li><li>Review site-specific fields only when that site's feature is available.</li></ol>
      <h3>Limitations and common problems</h3><p>Changing a shared employer record can affect many workers and contacts. Employer identity, policy assignment, upload completion, and ledger balance are separate evidence. Use Policy History for dated policy changes rather than treating an identity edit as a coverage correction.</p>`,
  },
  {
    id: "system:employer-policy-history",
    paths: ["/employers/%/policy-history"],
    summary: "Maintain effective-dated employer policy assignments and review existing history before changing which policy applies to a work period.",
    details: `
      <h3>Purpose</h3><p>Review the policy assigned to an employer over time.</p>
      <h3>Before you start</h3><p>This is a staff tab. Required policies must already exist; verify the intended effective date against the actual assignment evidence.</p>
      <h3>How to use this page</h3><ol><li>Review the existing timeline.</li><li>Set Policy and Effective Date in the offered editor.</li><li>Before editing or <strong>Delete Policy History Entry</strong>, review which periods and workers use that assignment.</li></ol>
      <h3>Limitations and common problems</h3><p>Removing an entry can expose an earlier assignment or default. A saved assignment does not prove historical coverage was rescanned. Check source periods and preview affected benefit evaluations separately.</p>`,
  },
  {
    id: "system:employer-onboarding",
    paths: ["/employers/onboarding"],
    summary: "Find or start employer onboarding and follow its saved wizard rather than treating a started application as completed employer reporting.",
    details: `
      <h3>Purpose</h3><p>Review Employer Onboarding Wizards and open the relevant saved run.</p>
      <h3>Before you start</h3><p>Staff access and an available onboarding plugin are required. Review existing employers and onboarding runs to avoid duplicates.</p>
      <h3>How to use this page</h3><ol><li>Find existing onboarding work for the organization.</li><li>Use the offered launcher only when a new onboarding is needed.</li><li>Complete the wizard's required information and inspect its final results.</li></ol>
      <h3>Limitations and common problems</h3><p>Onboarding completion is not completion of future monthly uploads, payment clearing, or worker benefit enrollment. If processing is uncertain, reopen the saved run before starting again.</p>`,
  },
  {
    id: "system:company-records",
    paths: ["/companies", "/companies/add", "/companies/%", "/companies/%/edit"],
    summary: "Maintain shared company identity and identifiers, checking linked employers before changing information used across an organization.",
    details: `
      <h3>Purpose</h3><p>Find and maintain company records that group employer information.</p>
      <h3>Before you start</h3><p>Staff access and the company feature are required. A company and an employer are different records.</p>
      <h3>How to use this page</h3><ol><li>Search for an existing company.</li><li>Review Name and Sirius ID before adding or editing.</li><li>Save and inspect the intended record and its employer links.</li></ol>
      <h3>Limitations and common problems</h3><p>Changing a shared company name does not rename every employer or transfer workers. Correct required-field or identifier errors rather than creating a duplicate company.</p>`,
  },
  {
    id: "system:facility-records",
    paths: ["/facilities", "/facilities/new", "/facility/%", "/facility/%/edit"],
    summary: "Maintain facility identity and contact information, checking related work before deleting a location that other records may use.",
    details: `
      <h3>Purpose</h3><p>Find facilities and maintain their location records.</p>
      <h3>Before you start</h3><p>The facility feature and facility view or edit policy are required. Editing includes separate contact tabs; access to one field does not imply all actions.</p>
      <h3>How to use this page</h3><ol><li>Find the existing location before creating another.</li><li>Review the name and identifiers, then save intended changes.</li><li>Use Email, Addresses, or Phone Numbers for contact details.</li><li>Before <strong>Delete Facility</strong> in the Danger Zone, review linked jobs and other records and the permanent deletion confirmation.</li></ol>
      <h3>Limitations and common problems</h3><p>A name correction is not a reason to delete and recreate a facility. If removal is refused, investigate linked work. A saved address does not guarantee map coordinates are available.</p>`,
  },
  {
    id: "system:organizing-completeness",
    paths: ["/employers/organizing", "/employers/%/missing-cardchecks"],
    summary: "Review organizing completeness for the selected employer population and protect worker information before downloading a missing-cardcheck or organizing report.",
    details: `
      <h3>Purpose</h3><p>Use organizing groups and missing-cardcheck views to identify records needing follow-up.</p>
      <h3>Before you start</h3><p>Staff access and the relevant BTU or cardcheck features are required. Configured groups, required cardchecks, and employment scope determine the population.</p>
      <h3>How to use this page</h3><ol><li>Check filters, employer, status groups, and the new-member window where offered.</li><li>Open a worker to inspect the underlying evidence.</li><li>Before exporting, verify scope and keep the download in an approved location.</li></ol>
      <h3>Limitations and common problems</h3><p>Missing evidence is not a refusal to participate. Group settings can change counts without changing workers. These site-specific fields are not universal across organizations.</p>`,
  },
  {
    id: "system:worker-political-profile",
    paths: ["/workers/%/political"],
    summary: "Review the worker's site-specific political profile with care, preserving unknown answers rather than inferring a position from missing information.",
    details: `
      <h3>Purpose</h3><p>Maintain the political profile fields offered for this site.</p>
      <h3>Before you start</h3><p>This staff tab requires its BTU political feature. Political information is sensitive and must be handled under your organization's procedures.</p>
      <h3>How to use this page</h3><ol><li>Confirm the worker and review existing answers.</li><li>Change only fields supported by actual evidence.</li><li>Review the displayed value after saving.</li></ol>
      <h3>Limitations and common problems</h3><p>A missing answer is not a negative answer. Do not infer political preference from employment, membership, or another person's profile. Report access and export actions have separate permissions.</p>`,
  },
  {
    id: "system:organization-contact-links",
    paths: ["/employer-contacts/all", "/employer-contacts/%", "/employer-contacts/%/edit", "/employer-contacts/%/name", "/employer-contacts/%/employers", "/trust-provider-contacts/%", "/trust-provider-contacts/%/edit", "/trust-provider-contacts/%/name", "/trust-provider-contacts/%/providers"],
    summary: "Maintain contacts and their organization associations, distinguishing a shared contact record from membership links and a separate sign-in account.",
    details: `
      <h3>Purpose</h3><p>Review contact identity and the employers or providers to which the contact is linked.</p>
      <h3>Before you start</h3><p>Employer and provider contact access use their respective management policies; provider features must be enabled. Linking a user has additional access checks.</p>
      <h3>How to use this page</h3><ol><li>Search for an existing contact before creating another.</li><li>Confirm name and contact identity.</li><li>Use <strong>Add to Employer</strong> or <strong>Add to Provider</strong> and select the correct organization, contact type, and Position where offered.</li><li>Review individual successes and failures after a multi-employer addition.</li><li>Before removing an association, review any user access derived from that organization link.</li></ol>
      <h3>Results and status meanings</h3><p>Removing an Employer Association or Provider Association does not delete the contact itself. Editing shared contact details affects every linked use of that contact; unlinking is a different action.</p>
      <h3>Limitations and common problems</h3><p>A contact is not automatically a sign-in user. Do not link a similarly named user without checking identity. A partial bulk-link result requires inspecting failed organizations, not assuming all were added.</p>`,
  },
];
