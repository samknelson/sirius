import type { SystemHelpEntry } from "./index";

export const maskModeHelp: SystemHelpEntry = {
  id: "system:mask-mode",
  paths: ["/mask-mode", "/config/components"],
  summary: "Mask Mode hides parts of structured personal fields on screen while you use the normal application; it does not protect underlying data.",
  details: `
    <h3>Purpose</h3>
    <p>Use screen-only masking to reduce personal details visible during ordinary application use.
    It is not de-identification, a security boundary, HIPAA certification or approval to publish a recording.</p>
    <h3>Before you start</h3>
    <p>An administrator must enable the optional <strong>Mask Mode</strong> component.
    Only a currently active administrator can change the toggle for their login.
    During masquerade the original administrator controls the toggle; the effective user's ordinary permissions still control all actions.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Enable <strong>Mask Mode</strong> in Components if needed.</li>
      <li>Select <strong>Mask Mode OFF</strong> in the application header and confirm the screen-only limitations.</li>
      <li>Check for <strong>Mask Mode ON — screen only</strong> before recording. Continue using normal pages, search, editing and authorized actions.</li>
      <li>Stop recording before turning the toggle OFF or disabling the component.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <p>Names keep the first character of each space-separated part. SSNs and phone numbers keep their first digit,
    with separators retained. Email keeps its first local-part character and full domain.
    DOB keeps its normal date display and only its first digit; other date digits become asterisks.
    Structured personal addresses and identifiers keep the first character and separators.
    Empty values and no-data labels remain unchanged. Nonpersonal statuses, benefits, hours, balances, organization names and other dates are unchanged.</p>
    <p>Structured identities include COBRA Covered Person and Subscriber names, person-bearing COBRA case titles,
    worker names on BAO case lists and headings, and worker entity names in ledger account Participants,
    Transactions and transaction details. Employer and provider organization names are not masked.
    Case narratives, notes and letters and transaction memos remain unchanged, even when they name a worker.</p>
    <p>Forms keep real values separately from the masked display. Focusing a personal input does not reveal the original;
    you can select or replace its value normally. Edit masked date controls using the keyboard;
    the native date popup is hidden while masking is ON so it does not reveal the selected birthday.
    Toggling does not save forms, change records, clear drafts or alter permissions.
    The preference survives navigation and refresh and updates other open tabs of the same login.
    Other users and separate logins are unaffected.</p>
    <p>Disabling the component ends screen masking for affected logins, not their sessions.
    Its confirmation warns you to stop recording. Re-enabling does not automatically turn masking back ON.
    Older restricted or revoked Mask Mode sessions recover in the normal application without a forced logout.
    The former /mask-mode control address returns to the application.</p>
    <h3>Limitations and common problems</h3>
    <p><strong>Notes, documents/files, photographs, message bodies, templates and their previews remain untouched, even if they contain personal information.</strong>
    No scanning, sanitization or extra reveal step is added. Ordinary downloads, exports, printing and clipboard operations are unchanged.</p>
    <p><strong>Real data remains in API responses, developer tools, browser memory, caches and storage.</strong>
    Copied underlying values, downloaded originals, public links and external sites are outside the claim.
    Do not show them in a recording that relies on screen masking.</p>
    <p>If a state or transition error appears, masking is not confirmed. Do not record; select <strong>Retry</strong>
    and check the indicator. The application remains usable and does not redirect to the old training view.
    A sleeping tab may not update until it resumes. Review every screen and the complete recording before sharing.</p>
  `,
};
