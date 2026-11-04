import type { SystemHelpEntry } from "./index";

export const maskModeHelp: SystemHelpEntry = {
  id: "system:mask-mode",
  paths: ["/mask-mode"],
  summary: "Strict Mask Mode replaces the normal application with a restricted, read-only training view; it does not certify HIPAA compliance.",
  details: `
    <h3>Component prerequisite</h3>
    <p>An administrator must enable <strong>Mask Mode</strong> in Components.
    It is disabled by default on new installations and upgrades; existing
    installations must explicitly opt in. No server restart is required.
    Reload open normal pages after enabling. Sign out and sign in again before
    using the session toggle if this login predates the component change.</p>
    <p>When the component is disabled, its button, protected sample, polling and
    presentation locks are unavailable. Disabling permanently ends sessions
    that were protected: stop recording, select Sign out and sign in again.
    Re-enabling the component does not restore those sessions. Previously
    delivered content and sleeping tabs cannot be erased.</p>
    <h3>Before recording</h3>
    <p>Use a fresh browser session and one active tab. Close previous tabs.
    Do not show browser history, developer tools, clipboard history, downloads
    or other applications. Obtain your organization's approval for the
    recording purpose, audience, storage and any recording or transcription service.</p>
    <h3>Enable protection</h3>
    <p>Only an active original presenter with the admin permission may toggle
    this session. During masquerade, the original presenter controls this
    toggle only; the target's permissions still control data access.
    Protection never changes another browser session or a stored person record.</p>
    <p>Confirm the fresh-tab warning and select Enable strict Mask Mode.
    Waiting, unknown or error states are not ready for recording. A failed
    transition does not grant access to normal pages.</p>
    <h3>What is available</h3>
    <p>The normal application is replaced, not cosmetically blurred.
    Staff may load a sample of up to 20 live records, labeled Training person,
    with random training-only references. Only birth year is offered; years
    that could imply age 90 or above are replaced by 90 or older. Missing or
    invalid dates are withheld. No source record IDs are sent.</p>
    <p>All real names, including first names, SSNs and ID fragments, contact
    details, month/day dates, files, photographs, credentials, notes, logs,
    case text, payments, exports, editing, real-record previews and unknown
    plugin content are blocked. Coverage and other original screens are not
    available. Translation and other injected third-party scripts are not loaded.</p>
    <p>This is not a test database. Background work, audit records and vendor
    processing continue normally; this session cannot initiate those actions.
    Starting or stopping masquerade is also unavailable while protected.</p>
    <h3>Limitations and review</h3>
    <p>This is a restricted technical projection, not a HIPAA certification
    or automatic approval to publish. Your privacy lead must review the
    permitted purpose, remaining context and the complete recording, including
    spoken narration, captions and metadata. Do not identify someone verbally.</p>
    <p>The application cannot erase previously delivered browser data,
    sleeping-tab pixels, network history, clipboard contents or old recordings.
    Previously issued public or copied bearer links are not revoked. Do not
    visit public links or external documents during recording.</p>
    <h3>Tabs, recovery and turning OFF</h3>
    <p>Tabs sharing the login share protection. Active tabs rebootstrap after a
    change; resumed tabs must check again. Do not rely on a sleeping tab to clear
    its old screen. Unsaved work is not saved when entering this view.</p>
    <p>Unknown state remains protected. An authorized admin can explicitly enable
    protection, or you can sign out and sign in again. Stop recording before
    selecting Turn Mask Mode OFF. OFF requires confirmation and a successful
    server response before the normal application is opened.</p>
  `,
};
