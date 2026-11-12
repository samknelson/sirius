import type { SystemHelpEntry } from "./index";

export const oneoffHelp: SystemHelpEntry = {
  id: "system:oneoff",
  paths: ["/admin/oneoff"],
  summary: "Building a Oneoff plugin? Open the developer guide for registration, safe execution, scratch tables, and database access.",
  details: `
    <h2>Building a Oneoff plugin</h2>
    <p>Oneoff plugins provide administrator-triggered operations with a preflight, an explicit confirmation, and a recorded run. Start with the working example in <strong>server/plugins/system/oneoff/plugins/test.ts</strong>.</p>

    <h3>1. Define and register the plugin</h3>
    <p>Implement the <strong>OneoffPlugin</strong> contract in <strong>server/plugins/system/oneoff/types.ts</strong>. Supply stable metadata (including an id, name, and appropriate access policy), an <strong>actions</strong> list, and a <strong>status</strong> function returning <strong>{ tableExists, rowCount }</strong>.</p>
    <p>Give each action an id, label, <strong>preflight</strong>, and <strong>execute</strong>. Mark destructive operations with <strong>destructive: true</strong>; use <strong>background: true</strong> when applicable. Register with <strong>registerOneoffPlugin</strong> and load the plugin module from the Oneoff system initialization, as the test plugin does.</p>

    <h3>2. Preflight before execution</h3>
    <p>Validate input and current state in <strong>preflight</strong>. Return a clear <strong>message</strong> and, when useful, <strong>rowCount</strong> or <strong>estimatedDurationMs</strong>. Preflight may prepare a scratch table if needed, but should not perform the confirmed operation.</p>
    <p>The runner checks the destructive state after preflight and again at confirmation. A preflight alone does not start the action: the administrator reviews its result and confirms. Approvals expire after ten minutes, can be used once, and are bound to the administrator, configuration, action, and input.</p>

    <h3>3. Report progress and honor cancellation</h3>
    <p><strong>execute</strong> receives an <strong>AbortSignal</strong> as <strong>signal</strong> and a <strong>reportProgress</strong> function. For longer jobs, check the signal between units of work and report a phase, completed and total counts, row count, and an optional checkpoint.</p>
    <p>Cancellation is cooperative: stop at a safe point rather than continuing writes. An interrupted or failed run may leave partial changes, so make retries and cleanup safe to inspect. The runner handles run history, heartbeat, and final status; plugins should not implement their own run tracking.</p>

    <h3>Scratch tables</h3>
    <p>A Oneoff action may own a disposable table in the public schema such as <strong>public.oneoff_test</strong>. Unmodeled live tables whose names begin exactly with <strong>oneoff_</strong> are exempt from the startup check for extra tables. A bare <strong>oneoff</strong> table or a differently named scratch table is not exempt.</p>
    <p>This naming rule does not exempt modeled tables from schema checks and does not authorize changes to unrelated tables. Before destructive cleanup, check that the table exists and verify its expected schema and identity; the test plugin checks its table shape again immediately before dropping it.</p>

    <h3>Database access: choose the right path</h3>
    <p>The runner provides <strong>context.db</strong> to an action's <strong>preflight</strong> only when it declares <strong>preflightDatabaseAccess: "read-write"</strong>, and to <strong>execute</strong> only when it declares <strong>executeDatabaseAccess: "read-write"</strong>. These opt-ins are independent. The plugin's <strong>status</strong> callback also receives a database connection.</p>
    <p>Use this exceptional, storage-bypass capability for the Oneoff action's own scratch-table operations, such as creating or dropping its disposable table. Do not import a second direct database connection or use this capability as a shortcut for ordinary application data writes; those belong in storage methods. Declare only the database access each phase needs; a preflight opt-in does not grant access during execution.</p>
    <p>The <strong>needsReadOnlyDb: true</strong> plugin metadata opt-in is a separate pure-read exception: a plugin with one self-contained pure-read query may use <strong>storage.readOnly.query</strong>. It cannot mutate data and does not grant an action <strong>context.db</strong>. For normal application queries, add or use a method in <strong>server/storage/</strong>.</p>
  `,
};