import type { SystemHelpEntry } from "./index";

export const denormStatusHelp: SystemHelpEntry = {
  id: "system:denorm-status",
  paths: ["/admin/denorm"],
  summary: "Each denorm plugin keeps a slice of data in sync. These numbers show how many records are up to date (OK), need recomputing (stale), or failed (error).",
  details: `
    <h2>What is denorm?</h2>
    <p>“Denorm” means precomputed data: a plugin reads existing records, calculates a useful result, and stores that result so other parts of the site can use it without recalculating everything on every request. Each plugin is responsible for a particular type of record or calculation. This page shows whether those saved results are ready to use; it does not display the results themselves.</p>

    <h3>Reading the Status table</h3>
    <p>Each row is a <strong>plugin configuration</strong>, not an individual person or record. The name links to the plugin's detail page, where you can inspect its counts and run maintenance actions. <strong>Enabled</strong> reflects the saved configuration switch. A disabled configuration can still have previously tracked rows, so its counts need not be zero.</p>
    <ul>
      <li><strong>OK</strong>: a precomputed result was successfully written for the tracked record.</li>
      <li><strong>Stale</strong>: the result needs to be recalculated; it is waiting for a recompute.</li>
      <li><strong>Error</strong>: recalculation failed for a tracked record and the failure is visible for investigation.</li>
      <li><strong>Total</strong>: all tracked records for that configuration (OK + stale + error), not all records in the source tables. A zero can mean nothing has been queued yet.</li>
    </ul>

    <h3>Where the numbers come from</h3>
    <p>Configuration names and enabled switches are saved in the <strong>plugin_configs</strong> table. For each tracked entity, the <strong>denorm</strong> table stores its entity identifier, configuration, status, and bookkeeping such as when it was computed or marked stale and any error message. The Status table groups those saved status rows by configuration; it is not a live recount of every possible source entity.</p>
    <p>Changes to source data can trigger a registered plugin to recompute a result. The scheduled backfill sweep can find missing results (and remove orphaned ones) and queue work as stale. The scheduled stale sweep recalculates queued results and marks them OK or error; both jobs normally run hourly. Eligible plugins can also be run from their detail pages. Work can be processed in batches, so a backlog may take more than one run to clear. If a plugin or its configuration is disabled, its scheduled work is skipped. Consult the detail page and job history when counts do not look right.</p>

    <h3>Managing configurations</h3>
    <p>To manage the saved plugin configurations rather than inspect their operational status, open <a href="/admin/plugin-configs/denorm">Denorm plugin configurations</a>. That page controls configuration settings; Status reports on the records those configurations track.</p>
  `,
};

export const denormRelationshipsHelp: SystemHelpEntry = {
  id: "system:denorm-relationships",
  paths: ["/admin/denorm/relationships"],
  summary: "See what each denorm plugin reads from and writes to. A sole-writer target belongs to one plugin; a shared target can have several cooperating writers.",
  details: `
    <h2>How to read Relationships</h2>
    <p>Denorm plugins maintain saved, precomputed results derived from other data. This page maps their declared data flow, so you can see which parts of the site may be involved when a plugin recalculates. It is a map of registered plugin definitions, not a report of the records currently stored or the work recently completed.</p>

    <h3>By plugin</h3>
    <p>Each row represents one registered plugin, even if it has no saved configuration. <strong>Entity</strong> is the type of record the plugin computes for. <strong>Trigger events</strong> are the declared events it listens to when source data changes; an empty list means no event handlers are declared here, so scheduled sweeps may be the way it finds work. <strong>Reads</strong> names the storage objects the plugin consults when computing or finding records to backfill. <strong>Writes</strong> names the storage objects whose data it updates. These names are application storage namespaces, not necessarily database table names.</p>
    <p>A solid write badge is a <strong>sole-writer</strong> claim: that plugin declares exclusive ownership of that storage object. A badge marked <strong>(shared)</strong> means other writers can update it too; writes must avoid unnecessary changes so repeated computations are safe. These are declarations supplied by the plugin code, not counts of writes. Framework bookkeeping for configuration and status is implicit and is not listed among each plugin's reads and writes.</p>

    <h3>By storage</h3>
    <p>This is the same declaration data reorganized by storage object. Use <strong>Read by</strong> and <strong>Written by</strong> to find which plugins depend on or update a given storage namespace. A blank side means no <em>registered denorm plugin</em> declares that relationship here; it does not mean nothing else on the site uses that storage.</p>

    <h3>Where this information comes from</h3>
    <p>The server builds both tables from the currently registered plugins' entity types, event handlers, and read/write declarations. The by-storage table groups those declarations in the browser. Relationships are not stored as denorm status rows, are not inferred from live database traffic, and do not tell you whether a configuration is enabled, how many results are fresh, or when a plugin last ran. For those answers, use the <a href="/admin/denorm">Status tab</a>.</p>

    <h3>Managing configurations</h3>
    <p>To manage which denorm plugin configurations are saved and enabled, open <a href="/admin/plugin-configs/denorm">Denorm plugin configurations</a>. That management page is separate from this map of plugin declarations and the operational Status view.</p>
  `,
};
