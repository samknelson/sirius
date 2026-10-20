import type { SystemHelpEntry } from "./index";

export const conditionalDomainHelp: SystemHelpEntry[] = [
  {
    id: "system:provider-records",
    paths: ["/trust/provider/%", "/trust/provider/%/edit", "/trust/provider/%/contacts", "/trust/provider/%/premium-files"],
    summary: "Review provider identity, contacts, and available premium files without treating provider membership as proof of worker coverage or file delivery.",
    details: `
      <h3>Purpose</h3><p>Maintain a provider record and inspect related contacts and premium files.</p>
      <h3>Before you start</h3><p>Provider features and the relevant tab access are required. Scoped provider access does not grant staff editing or EDI administration. Premium Files depends on BAO.</p>
      <h3>How to use this page</h3><ol><li>Confirm the provider and inspect its identifiers.</li><li>Review linked contacts and their separate organization associations.</li><li>For premium files, verify the period and file scope before downloading sensitive coverage information.</li></ol>
      <h3>Limitations and common problems</h3><p>A provider contact, benefit definition, and generated file are separate records. An available file does not establish external receipt or each worker's current eligibility. Missing files can reflect period or configuration rather than no coverage.</p>`,
  },
  {
    id: "system:provider-edi",
    paths: ["/trust/provider-edi"],
    summary: "Review configured EDI generation and delivery runs, verifying benefit scope, period, and saved results before generating another provider file.",
    details: `
      <h3>Purpose</h3><p>Review enabled EDI file configurations and their most recent generation or delivery wizard.</p>
      <h3>Before you start</h3><p>Administrator access, Providers EDI, and a valid file configuration are required. File membership follows the configured benefit identifier; do not assume every benefit belongs to the provider merely because this page names it.</p>
      <h3>How to use this page</h3><ol><li>Review the configuration, period, and most recent wizard.</li><li>Open existing work and inspect its results before starting a new run.</li><li>Before generation or delivery, review file population and destination; delivery can make a network transfer.</li><li>Protect any downloaded eligibility or coverage data.</li></ol>
      <h3>Results and status meanings</h3><p>A wizard's Completed or Failed state describes its saved work. Generation and external delivery are distinct steps; inspect the relevant result rather than assuming a generated file was accepted by a provider.</p>
      <h3>Limitations and common problems</h3><p>No configuration or no data is not a successful empty transmission. Correct the displayed prerequisite and check prior run effects before retrying.</p>`,
  },
  {
    id: "system:dispatch-jobs",
    paths: ["/dispatch/jobs", "/dispatch/job/new", "/dispatch/job/%", "/dispatch/%", "/dispatch/job/%/edit", "/dispatch/job/%/dispatches/list", "/dispatch/job/%/dispatches/cbn", "/dispatch/job/%/eligible-workers/list", "/dispatch/job/%/eligible-workers/check", "/dispatch/job/%/foreperson", "/dispatch/job/%/employer_contacts", "/dispatch/job_groups", "/dispatch/job_group/new", "/dispatch/job_group/%"],
    summary: "Prepare dispatch job requirements and inspect eligible workers, keeping qualification checks separate from availability, offers, acceptance, and assignment.",
    details: `
      <h3>Purpose</h3><p>Maintain jobs and job groups and review dispatch and eligibility evidence.</p>
      <h3>Before you start</h3><p>Dispatch and the relevant staff or entity policy are required. Foreperson, Call by Name, groups, and employer contacts depend on additional features or access. A linked employer does not receive all staff controls.</p>
      <h3>How to use this page</h3><ol><li>Review employer, job type, location, dates, requirements, and capacity before saving a job.</li><li>Use Eligible Workers and Check to inspect rules and reasons.</li><li>Review existing dispatches before a manual or Call by Name addition.</li><li>Check employer contacts before any action that may notify them.</li></ol>
      <h3>Results and status meanings</h3><p>Eligibility is not availability or acceptance. Dispatch records track offers and responses separately from the job definition. A job group is organizational information, not a guarantee of one shared outcome.</p>
      <h3>Limitations and common problems</h3><p>Bans and current acceptance rules are checked again at consequential actions; a previously loaded eligible list can be stale. Review existing assignments rather than bypassing refusal with a duplicate dispatch.</p>`,
  },
  {
    id: "system:dispatch-run",
    paths: ["/dispatch/job/%/run/control", "/dispatch/job/%/run/batch", "/dispatch/job/%/run/settings", "/dispatch/%/manage", "/dispatch/%/edit"],
    summary: "Control dispatch processing and review capacity and worker outcomes before running batches or changing an individual dispatch's state.",
    details: `
      <h3>Purpose</h3><p>Manage job running state, inspect batch progress, and maintain authorized dispatch outcomes.</p>
      <h3>Before you start</h3><p>Dispatch access is required; individual management follows its own policy. Check job requirements, run parameters, capacity, existing offers, and notification configuration first.</p>
      <h3>How to use this page</h3><ol><li>Review Capacity, Run Parameters, and Eligible Workers.</li><li>Before changing running state or invoking batch controls, review whether workers will be offered work or notified.</li><li>Inspect status counts and phase failures after processing.</li><li>For an individual change, verify the worker, job, and current response before saving.</li></ol>
      <h3>Results and status meanings</h3><p>A poll or batch result is not proof of acceptance. Accepted primary dispatches and worker availability are coordinated; conflicting acceptance can be refused rather than silently making the worker available.</p>
      <h3>Limitations and common problems</h3><p>Do not repeatedly run a batch to compensate for stale display data. Review saved dispatches, bans, and remaining capacity before another attempt. Manual edits do not guarantee a notification was delivered.</p>`,
  },
  {
    id: "system:worker-dispatch-preferences",
    paths: ["/workers/%/dispatch/status", "/workers/%/dispatch/do-not-call", "/workers/%/dispatch/departments", "/workers/%/dispatch/hold-for-employer", "/workers/%/dispatch/eba", "/workers/%/dispatch/asi", "/workers/%/dispatch/list"],
    summary: "Review worker dispatch availability and preferences, checking dates and current assignments before changing conditions used by future dispatch checks.",
    details: `
      <h3>Purpose</h3><p>Review Status, dispatch history, and optional Do Not Call, Departments, Employer Priority, Availability Dates, and Auto Sign-In settings.</p>
      <h3>Before you start</h3><p>Each tab has its own component and policy. Worker-own controls are not general staff administration. Availability is separate from qualification and an accepted assignment.</p>
      <h3>How to use this page</h3><ol><li>Review current status and accepted work.</li><li>Check dates, employer, or department scope before changing the offered preference.</li><li>Read the effect of the setting before saving or removing it.</li></ol>
      <h3>Limitations and common problems</h3><p>A preference does not promise a job offer. Making a worker available can be refused while an accepted primary dispatch exists. A missing optional tab can reflect site configuration, not missing worker data.</p>`,
  },
  {
    id: "system:t631-dispatch-interviews",
    paths: ["/dispatch/job/%/sitespecific_t631_interviews", "/dispatch/job/%/sitespecific_t631_interviews/offers", "/workers/%/dispatch/sitespecific_t631_interviews"],
    summary: "Review site-specific interview and offer evidence with the correct worker or employer scope before changing interview outcomes or preparing offers.",
    details: `
      <h3>Purpose</h3><p>Track Teamsters 631 interviews and staff offer work associated with dispatch jobs.</p>
      <h3>Before you start</h3><p>The T631 Interviews feature and entity policy are required. Employer-facing interview visibility is restricted; Offers is a separate staff tab.</p>
      <h3>How to use this page</h3><ol><li>Confirm the job, employer, and worker.</li><li>Review current interview evidence and the statuses offered to your audience.</li><li>Before an offer or notification action, verify the intended recipient and job details.</li></ol>
      <h3>Limitations and common problems</h3><p>An interview or offer is not an accepted dispatch. Staff-only statuses must not be copied into employer-facing messages. If an action is refused, review access and current state rather than switching to a different worker or employer record.</p>`,
  },
  {
    id: "system:dispatch-configuration",
    paths: ["/config/dispatch-job-types", "/config/dispatch-job-type/%", "/config/dispatch-job-type/%/edit", "/config/dispatch-job-type/%/notifications", "/config/dispatch-job-type/%/delete", "/config/dispatch-job-type/%/run-settings", "/config/dispatch/dnc", "/config/dispatch/eba", "/config/dispatch/seniority-reset", "/config/dispatch/backfill", "/config/sitespecific/hta/home-employment-statuses"],
    summary: "Configure dispatch behavior for the intended job type or site and distinguish rule changes from eligibility backfill and live job processing.",
    details: `
      <h3>Purpose</h3><p>Maintain job-type settings, notification rules, availability features, and supported eligibility maintenance.</p>
      <h3>Before you start</h3><p>Dispatch and each optional feature must be enabled. Job-type maintenance and HTA settings can use staff access; eligibility configuration and backfill use administrator access.</p>
      <h3>How to use this page</h3><ol><li>Check the job type or site-specific scope.</li><li>Review existing rules and notification recipients before saving settings.</li><li>Before a reset, backfill, or delete action, inspect the displayed population and warning.</li></ol>
      <h3>Results and status meanings</h3><p>Settings affect their consumers; they do not by themselves assign workers. Backfill queues eligibility maintenance rather than proving every job is already recalculated.</p>
      <h3>Limitations and common problems</h3><p>Changing shared job types can affect many jobs. Do not delete or reset configuration as a substitute for reviewing one worker's failure reason. A notification setting does not prove delivery.</p>`,
  },
  {
    id: "system:edls-scheduling",
    paths: ["/edls/sheets", "/edls/sheet/%", "/edls/sheet/%/next-assignments", "/edls/sheet/%/assignments", "/edls/sheet/%/manage", "/edls/sheet/%/edit", "/edls/sheet/%/logs", "/edls/sheet/%/logs/snapshots"],
    summary: "Prepare EDLS sheets and assignments, review status and notification effects, and distinguish scheduled work from a worker's final response.",
    details: `
      <h3>Purpose</h3><p>Maintain scheduling sheets, assignments, and saved scheduling history.</p>
      <h3>Before you start</h3><p>EDLS and sheet-specific access are required. Check employer, work date, task definitions, worker eligibility, and the sheet's notification state before changing assignments.</p>
      <h3>How to use this page</h3><ol><li>Open the intended sheet and review its date and assignments.</li><li>Inspect Next Assignments before committing scheduling changes.</li><li>On Manage, review <strong>Change status to</strong> and notification consequences before submitting.</li><li>Use logs and snapshots to inspect retained scheduling evidence; check the target date before copying a sheet.</li></ol>
      <h3>Results and status meanings</h3><p>Draft is editable preparation; Requested asks for scheduling; Scheduled is locked scheduled work; Reserved is held for future use; Trash marks work for deletion. Available transitions depend on the current state. A scheduled assignment is not proof the worker accepted it.</p>
      <h3>Limitations and common problems</h3><p>Moving to a notifying status can send messages. Trash and notification locks have separate controls; do not assume a status edit recalls sent links. Worker responses through authorized access links differ from older read-only schedule links. Review current saved state before repeating an action after a network error.</p>`,
  },
  {
    id: "system:edls-worker-extensions",
    paths: ["/edls/tos", "/edls/freeman/crewleads", "/workers/%/edls", "/workers/%/edls/assignments", "/workers/%/sitespecific-freeman-2shift"],
    summary: "Review EDLS participation, assignment history, and optional site scheduling settings without treating a status or preference as a confirmed assignment.",
    details: `
      <h3>Purpose</h3><p>Review worker EDLS status and assignments and the optional TOS, crewlead, or Second Shift views.</p>
      <h3>Before you start</h3><p>EDLS policies and site-specific components determine which controls are offered. Worker EDLS maintenance is a coordinator function, not an unrestricted worker self-service action.</p>
      <h3>How to use this page</h3><ol><li>Check the worker and work date or period.</li><li>Review existing participation, absence, or shift information.</li><li>Before saving a change, inspect current sheet assignments that may use it.</li></ol>
      <h3>Limitations and common problems</h3><p>Preferences and participation flags do not create an assignment or guarantee two shifts. Missing optional site information differs from a negative scheduling decision. Use the sheet for final scheduling and response evidence.</p>`,
  },
  {
    id: "system:edls-configuration",
    paths: ["/config/edls/settings", "/config/edls/tasks", "/config/edls/t631-fetch", "/config/edls/t631-ms", "/admin/sitespecific/freeman/edls/migrate"],
    summary: "Maintain EDLS configuration and conditional site integrations, reviewing scope and effects before running synchronization or migration actions.",
    details: `
      <h3>Purpose</h3><p>Configure scheduling settings, tasks, and the site-specific extensions offered in this deployment.</p>
      <h3>Before you start</h3><p>Administrator access, EDLS, and the relevant T631 or Freeman feature are required. Required external access must be configured securely outside this help.</p>
      <h3>How to use this page</h3><ol><li>Review the existing settings and intended site.</li><li>Check task and status mappings against current scheduling use.</li><li>Before Fetch, synchronization, or migration actions, inspect the displayed scope and warning; these are not read-only diagnostics.</li></ol>
      <h3>Limitations and common problems</h3><p>Saving settings does not prove remote synchronization or historical migration completed. Inspect results and existing records before retrying; do not run an integration merely to check whether configuration looks plausible.</p>`,
  },
  {
    id: "system:event-management",
    paths: ["/events", "/events/new", "/events/%", "/events/%/edit", "/events/%/delete", "/events/%/register", "/events/%/roster", "/events/%/self-register", "/config/event-types"],
    summary: "Maintain events and participant registration, checking the event occurrence before roster changes and keeping registration separate from attendance check-in.",
    details: `
      <h3>Purpose</h3><p>Review events, manage registrations, and inspect the roster for the intended occurrence.</p>
      <h3>Before you start</h3><p>Events must be enabled. List/create/type configuration and event tabs have their own staff or administrator gates. A route named Self-Register is not proof that every signed-in user has access.</p>
      <h3>How to use this page</h3><ol><li>Confirm the event and date, including the intended occurrence for repeating events.</li><li>Review existing participants before registering someone.</li><li>Check the roster for the recorded registration and attendance information.</li><li>Before deleting an event, read its confirmation and consider registrations and related attendance evidence.</li></ol>
      <h3>Limitations and common problems</h3><p>Registration is not attendance. Removing an event or participant is not an automatic notification or recall. Correct the selected occurrence before repeating a registration that appears missing.</p>`,
  },
  {
    id: "system:event-scan-checkin",
    paths: ["/events/%/scan-checkin"],
    summary: "Use an authorized camera session to scan worker QR codes for the selected event and inspect each check-in result.",
    details: `
      <h3>Purpose</h3><p>Record event check-in from worker QR codes.</p>
      <h3>Before you start</h3><p>Administrator access and Events are required. Confirm the event first. Camera access needs a supported device, a secure browser connection, and browser permission.</p>
      <h3>How to use this page</h3><ol><li>Allow camera access and start the camera using the offered control.</li><li>Point it at the intended worker's QR code.</li><li>Read Check-in Successful, Already Registered, or the failure message before scanning the next person.</li><li>Stop the camera when finished.</li></ol>
      <h3>Limitations and common problems</h3><p>A camera error is not a failed worker registration. Review browser permission and retry camera access. An invalid or wrong-purpose QR code must not be treated as attendance. Inspect the result or roster before repeating an uncertain scan.</p>`,
  },
  {
    id: "system:grievance-workflow",
    paths: ["/grievances", "/grievances/add", "/grievance/%", "/grievance/%/edit", "/grievance/%/status-history", "/grievance/%/timeline", "/grievance/%/settlements", "/grievance/%/logs"],
    summary: "Track grievance evidence, status history, timeline steps, and settlements while keeping recorded status separate from legal deadlines and completed obligations.",
    details: `
      <h3>Purpose</h3><p>Maintain a grievance and review the timeline derived from its selected template and status history.</p>
      <h3>Before you start</h3><p>Grievances and relevant staff/entity access are required. Verify worker, employer, contract, dates, and local handling requirements. This help does not prescribe legal procedure.</p>
      <h3>How to use this page</h3><ol><li>Find the existing grievance before adding one.</li><li>Review its details and status history before saving a status change.</li><li>Inspect Timeline for steps, start/completion statuses, and calculated dates.</li><li>Record settlements and evidence in the appropriate tabs, checking their scope before saving or removing records.</li></ol>
      <h3>Results and status meanings</h3><p>Timeline completion follows the template's mapped statuses; it is not an independent legal certification or proof that settlement obligations were fulfilled. A template can be selected on the grievance editor.</p>
      <h3>Limitations and common problems</h3><p>No timeline can mean no template or missing status evidence. Correct the source history or template rather than inventing completion dates. Verify deadlines using local procedure and the governing agreement.</p>`,
  },
  {
    id: "system:grievance-timeline-templates",
    paths: ["/grievance-timeline-templates", "/grievance-timeline-template/%"],
    summary: "Define reusable grievance timeline steps and status mappings, checking date rules before changes affect timelines for linked grievances.",
    details: `
      <h3>Purpose</h3><p>Maintain timeline templates and their items for grievance workflows.</p>
      <h3>Before you start</h3><p>Administrator access and Grievances are required. Review the actual local procedure before defining deadlines or status mappings.</p>
      <h3>How to use this page</h3><ol><li>Open the intended template and inspect existing Items.</li><li>Review step order, date rules, and mapped start and completion statuses.</li><li>Check which grievances use this template before saving or deleting items.</li></ol>
      <h3>Limitations and common problems</h3><p>A shared template change can affect more than one grievance. Saving a template does not establish that any worker completed a step or that historical recalculation finished. Use the grievance's status history to investigate missing evidence.</p>`,
  },
  {
    id: "system:contracts-articles",
    paths: ["/contracts", "/contract/%", "/contract/%/edit", "/contract/%/article/%/edit", "/contract/%/articles", "/contract/%/articles/outline", "/contract/%/articles/edit", "/contract/%/outline", "/contract/%/full-text", "/contract/%/logs"],
    summary: "Review contract text and article structure, and check shared content and deletion effects before changing articles or sections.",
    details: `
      <h3>Purpose</h3><p>Use outline views for structure and Full Text for the assembled contract content.</p>
      <h3>Before you start</h3><p>Contracts and the relevant staff/entity access are required. Editing article structure differs from editing an article's sections.</p>
      <h3>How to use this page</h3><ol><li>Confirm the contract and review its current outline.</li><li>Use article editing to set Number, Name, and ordering where offered.</li><li>Open the article's sections to maintain its text.</li><li>Before deleting an article or section, review the confirmation and contained content.</li><li>Inspect the outline and Full Text after saving.</li></ol>
      <h3>Limitations and common problems</h3><p>Changing structure can alter the assembled text and references. Saving text here is not proof of legal adoption, publication outside this application, or notification to workers. Keep local approval procedures separate.</p>`,
  },
];
