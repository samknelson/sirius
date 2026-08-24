/**
 * One-off end-to-end verification for the remaining notifiers' token roots,
 * after applying the rules the grievance status notifier established: a root
 * is named after its entity kind, advertises nothing its record cannot
 * supply, and reaches related values through the related record.
 *
 * Against real data, per converted notifier:
 *   1. every root builds a record whose ROW carries every field its kind
 *      advertises (the failure mode that renders blank in a delivered
 *      message: the catalog offers the column, the built row omits it),
 *   2. the shipped default templates render real values, no token empty,
 *   3. the stored-template rewrite converts an old custom template, survives
 *      the grammar's awkward shapes, and is idempotent,
 *   4. the boot migration rewrites a real config row and is a no-op on rerun.
 *
 * Run: npx tsx scripts/oneoffs/verify-notifier-token-roots.ts
 */
import { eq } from "drizzle-orm";
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";
import { eventNotifierRegistry } from "../../server/plugins/event-notifier/registry";
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import {
  NOTIFIER_TEMPLATE_REWRITES,
  rewriteTemplateTokens,
} from "../../server/plugins/event-notifier/template-token-migrations";
import { storage } from "../../server/storage";
import { loadComponentCache } from "../../server/services/component-cache";
import { db } from "../../server/storage/db";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  await loadComponentCache();
  initializeEventNotifierPluginSystem();
  initializeTokenPluginSystem();
  const { missingCatalogFields } = await import(
    "../../server/plugins/tokens/root-coverage"
  );
  const { renderTokens, createTokenEvalContext } = await import(
    "../../server/plugins/tokens"
  );

  /** Build every root, assert coverage, render the shipped defaults. */
  async function verify(pluginId: string, payload: unknown) {
    const plugin = eventNotifierRegistry.list().find((p) => p.id === pluginId);
    if (!plugin?.tokenTemplates) throw new Error(`${pluginId} not registered`);
    console.log(`\n--- ${pluginId} ---`);
    const ctx = { event: pluginId, payload } as never;

    const seeds: Array<{ name: string; entity: unknown }> = [];
    for (const root of plugin.tokenTemplates.roots) {
      const built = await root.build(ctx);
      check(`${pluginId}: root {{${root.name}}} builds a record`, built !== null);
      if (!built) continue;
      check(
        `${pluginId}: root {{${root.name}}} is named after its kind`,
        root.name === built.kind,
        `kind ${built.kind}`,
      );
      const missing = missingCatalogFields(built);
      check(
        `${pluginId}: root {{${root.name}}} supplies every advertised field`,
        missing.length === 0,
        missing.length ? `missing: ${missing.join(", ")}` : `kind ${built.kind}`,
      );
      seeds.push({ name: root.name, entity: built });
    }
    seeds.push({
      name: "event",
      entity: { kind: "event", row: { type: pluginId, firedAt: new Date() } },
    });

    const templates = plugin.tokenTemplates.defaultTemplates();
    const evalCtx = createTokenEvalContext(storage, null, { seeds } as never);
    for (const [channel, fields] of Object.entries(templates)) {
      for (const [field, template] of Object.entries(
        fields as Record<string, string>,
      )) {
        const r = await renderTokens(template, evalCtx);
        console.log(`  ${channel}.${field}: ${r.output}`);
        check(
          `${pluginId}: ${channel}.${field} renders without unknown tokens`,
          r.unknownTokens.length === 0,
          r.unknownTokens.join(", "),
        );
        check(
          `${pluginId}: ${channel}.${field} renders no empty/missing token`,
          r.missingValues.length === 0 && r.emptyValues.length === 0,
          [...r.missingValues, ...r.emptyValues].join(", "),
        );
      }
    }
    return seeds;
  }

  // Real rows, snapshotted onto the payloads the way the storage layer
  // emits them.
  const { workerDispatchStatus, dispatchJobs } = await import(
    "../../shared/schema/dispatch/schema"
  );
  const { dispatchJobFore } = await import(
    "../../shared/schema/dispatch/fore-schema"
  );
  type DispatchJobFore = typeof dispatchJobFore.$inferSelect;
  const { grievanceSettlements } = await import(
    "../../shared/schema/grievance/settlement-schema"
  );
  const { edlsSheets } = await import("../../shared/schema/edls/schema");
  const { grievances } = await import("../../shared/schema");

  // --- dispatch status: the availability row the event carried ---
  const [wds] = await db.select().from(workerDispatchStatus).limit(1);
  if (!wds) console.log("SKIP: no worker_dispatch_status rows");
  else
    await verify("dispatch-status-notifier", {
      statusId: wds.id,
      workerId: wds.workerId,
      status: wds.status,
      row: wds,
      previousStatus: null,
    });

  // --- dispatch fore: the membership and the job, both off the event ---
  // A removal's membership row is gone before anyone can read it, so the
  // event carries it; when the dev DB has none, stand in a typed row (the
  // compiler is what guarantees the emit site passes a whole one).
  const [job] = await db.select().from(dispatchJobs).limit(1);
  const [existingFore] = await db.select().from(dispatchJobFore).limit(1);
  if (!job) console.log("SKIP: no dispatch_jobs rows");
  else {
    const fore: DispatchJobFore = existingFore ?? {
      id: "00000000-0000-0000-0000-000000000000",
      jobId: job.id,
      workerId: "00000000-0000-0000-0000-000000000001",
      data: null,
    };
    await verify("dispatch-fore-notifier", {
      foreId: fore.id,
      jobId: fore.jobId,
      workerId: fore.workerId,
      action: "removed",
      fore,
      job,
    });
  }

  // --- settlement: the settlement off the event, grievance from the grievance ---
  const [settlement] = await db.select().from(grievanceSettlements).limit(1);
  if (!settlement) console.log("SKIP: no grievance_settlements rows");
  else {
    const titleInfo = await storage.grievances.getAssignmentTitleInfo(
      settlement.grievanceId,
    );
    const [grievanceRow] = await db
      .select()
      .from(grievances)
      .where(eq(grievances.id, settlement.grievanceId));
    await verify("grievance-settlement", {
      grievanceId: settlement.grievanceId,
      settlementId: settlement.id,
      operation: "updated",
      row: settlement,
      grievance: grievanceRow ?? null,
      grievanceTitleParts: titleInfo
        ? { name: titleInfo.name, categoryName: titleInfo.categoryName }
        : null,
    });
  }

  // --- edls sheet: the sheet the event carried ---
  const [sheet] = await db.select().from(edlsSheets).limit(1);
  if (!sheet) console.log("SKIP: no edls_sheets rows");
  else
    await verify("edls-sheet-status-notifier", {
      sheetId: sheet.id,
      previousStatus: null,
      newStatus: sheet.status,
      sheet,
    });

  // --- stored-template rewrites ---
  // The grammar allows arguments in any order, arbitrary whitespace, and
  // quotes/braces inside argument values — the shapes a text-level rewrite
  // silently mangles — so every rewrite is exercised against all of them.
  const rewriteFor = (pluginId: string) => {
    const r = NOTIFIER_TEMPLATE_REWRITES.find((x) => x.pluginId === pluginId);
    if (!r) throw new Error(`no rewrite registered for ${pluginId}`);
    return r;
  };

  const cases: Array<{
    pluginId: string;
    legacy: string;
    expected: string;
    awkward: Array<[string, string, string]>;
  }> = [
    {
      pluginId: "dispatch-status-notifier",
      legacy:
        'Status: {{dispatch.field(name="status_label")}} for ' +
        '{{dispatch.worker.contact.field(name="display_name")}} ' +
        '({{dispatch.field(name="seniority_date", format="Y-m-d")}})',
      expected:
        'Status: {{dispatch_worker_status.field(name="status_label")}} for ' +
        '{{dispatch_worker_status.worker.contact.field(name="display_name")}} ' +
        '({{dispatch_worker_status.field(name="seniority_date", format="Y-m-d")}})',
      awkward: [
        [
          "arguments in the other order",
          '{{dispatch.field(default="—", name="status")}}',
          '{{dispatch_worker_status.field(default="—", name="status")}}',
        ],
        [
          "whitespace around the chain and arguments",
          '{{  dispatch.field( name = "status" )  }}',
          '{{dispatch_worker_status.field(name="status")}}',
        ],
        [
          "a brace inside an argument value",
          '{{dispatch.field(name="status", default="{unset}")}}',
          '{{dispatch_worker_status.field(name="status", default="{unset}")}}',
        ],
        [
          "an escaped quote inside an argument value",
          '{{dispatch.field(name="status", default="say \\"none\\"")}}',
          '{{dispatch_worker_status.field(name="status", default="say \\"none\\"")}}',
        ],
        [
          "a token about something else",
          '{{worker.field(name="first_name")}}',
          '{{worker.field(name="first_name")}}',
        ],
        [
          "an unparseable token, left alone",
          "{{dispatch.field(name=unquoted)}}",
          "{{dispatch.field(name=unquoted)}}",
        ],
      ],
    },
    {
      pluginId: "dispatch-fore-notifier",
      legacy:
        '{{dispatch_fore.field(name="action_label")}} on ' +
        '"{{dispatch_fore.field(name="job_title")}}" at ' +
        '{{dispatch_fore.field(name="employer_name")}} ' +
        '({{dispatch_fore.dispatch_job.field(name="start_ymd", format="Y-m-d")}})',
      expected:
        '{{dispatch_fore.field(name="action_label")}} on ' +
        '"{{dispatch_job.field(name="title")}}" at ' +
        '{{dispatch_job.field(name="employer_id")}} ' +
        '({{dispatch_job.field(name="start_ymd", format="Y-m-d")}})',
      awkward: [
        [
          "arguments in the other order",
          '{{dispatch_fore.field(default="—", name="job_title")}}',
          '{{dispatch_job.field(default="—", name="title")}}',
        ],
        [
          "whitespace around the chain and arguments",
          '{{  dispatch_fore.field( name = "employer_name" )  }}',
          '{{dispatch_job.field(name="employer_id")}}',
        ],
        [
          "a brace inside an argument value",
          '{{dispatch_fore.field(name="job_title", default="{unset}")}}',
          '{{dispatch_job.field(name="title", default="{unset}")}}',
        ],
        [
          "an escaped quote inside an argument value",
          '{{dispatch_fore.field(name="job_title", default="say \\"none\\"")}}',
          '{{dispatch_job.field(name="title", default="say \\"none\\"")}}',
        ],
        [
          "a field that stayed on the membership",
          '{{dispatch_fore.field(name="action")}}',
          '{{dispatch_fore.field(name="action")}}',
        ],
        [
          "a hop to the worker, untouched",
          '{{dispatch_fore.worker.contact.field(name="display_name")}}',
          '{{dispatch_fore.worker.contact.field(name="display_name")}}',
        ],
        [
          "an unparseable token, left alone",
          "{{dispatch_fore.field(name=unquoted)}}",
          "{{dispatch_fore.field(name=unquoted)}}",
        ],
      ],
    },
    {
      pluginId: "grievance-settlement",
      legacy:
        '{{grievance_settlement.field(name="grievance_title")}}: ' +
        '{{grievance_settlement.field(name="summary")}} ' +
        '({{grievance_settlement.grievance.field(name="sirius_id")}})',
      expected:
        '{{grievance.field(name="display_title")}}: ' +
        '{{grievance_settlement.field(name="summary")}} ' +
        '({{grievance.field(name="sirius_id")}})',
      awkward: [
        [
          "arguments in the other order",
          '{{grievance_settlement.field(default="—", name="grievance_title")}}',
          '{{grievance.field(default="—", name="display_title")}}',
        ],
        [
          "whitespace around the chain and arguments",
          '{{  grievance_settlement.field( name = "grievance_title" )  }}',
          '{{grievance.field(name="display_title")}}',
        ],
        [
          "a brace inside an argument value",
          '{{grievance_settlement.field(name="grievance_title", default="{unset}")}}',
          '{{grievance.field(name="display_title", default="{unset}")}}',
        ],
        [
          "an escaped quote inside an argument value",
          '{{grievance_settlement.field(name="grievance_title", default="say \\"none\\"")}}',
          '{{grievance.field(name="display_title", default="say \\"none\\"")}}',
        ],
        [
          "a field that stayed on the settlement",
          '{{grievance_settlement.field(name="amount")}}',
          '{{grievance_settlement.field(name="amount")}}',
        ],
        [
          "a deeper chain off the grievance hop",
          '{{grievance_settlement.grievance.field(name="name", default="—")}}',
          '{{grievance.field(name="name", default="—")}}',
        ],
        [
          "an unparseable token, left alone",
          "{{grievance_settlement.field(name=unquoted)}}",
          "{{grievance_settlement.field(name=unquoted)}}",
        ],
      ],
    },
  ];

  for (const c of cases) {
    console.log(`\n--- ${c.pluginId} rewrite ---`);
    const rewrite = rewriteFor(c.pluginId);
    const once = rewriteTemplateTokens(c.legacy, rewrite);
    console.log(`  legacy:    ${c.legacy}\n  rewritten: ${once}`);
    check(`${c.pluginId}: rewrites a legacy template`, once === c.expected, once);
    check(
      `${c.pluginId}: rewrite is idempotent`,
      rewriteTemplateTokens(once, rewrite) === once,
    );
    for (const [label, input, expected] of c.awkward) {
      const got = rewriteTemplateTokens(input, rewrite);
      check(`${c.pluginId}: rewrite handles ${label}`, got === expected, `got ${got}`);
      check(
        `${c.pluginId}: rewrite of ${label} is idempotent`,
        rewriteTemplateTokens(got, rewrite) === got,
      );
    }
    // A rewrite must not touch tokens belonging to another notifier's roots.
    for (const other of cases) {
      if (other.pluginId === c.pluginId) continue;
      check(
        `${c.pluginId}: leaves ${other.pluginId} tokens alone`,
        rewriteTemplateTokens(other.legacy, rewrite) === other.legacy,
      );
    }
  }

  // --- the boot migration against REAL config rows ---
  const { migrateNotifierTemplateTokens } = await import(
    "../../server/plugins/event-notifier/template-token-migrations"
  );
  for (const c of cases) {
    const [cfg] = await storage.pluginConfigs.getByKindAndPlugin(
      "event-notifier",
      c.pluginId,
    );
    if (!cfg) {
      console.log(`SKIP: no ${c.pluginId} config to migrate`);
      continue;
    }
    const original = cfg.data;
    await storage.pluginConfigs.update(cfg.id, {
      data: {
        ...((original ?? {}) as Record<string, unknown>),
        templates: { inapp: { title: c.legacy } },
      },
    });
    await migrateNotifierTemplateTokens();
    const after = await storage.pluginConfigs.get(cfg.id);
    const title = (after?.data as any)?.templates?.inapp?.title as string;
    check(
      `${c.pluginId}: boot migration rewrote the stored template`,
      title === c.expected,
      title,
    );
    await migrateNotifierTemplateTokens();
    const again = await storage.pluginConfigs.get(cfg.id);
    check(
      `${c.pluginId}: boot migration is a no-op on the second run`,
      (again?.data as any)?.templates?.inapp?.title === c.expected,
    );
    await storage.pluginConfigs.update(cfg.id, { data: original as never });
    const restored = await storage.pluginConfigs.get(cfg.id);
    check(
      `${c.pluginId}: config restored to its original data`,
      JSON.stringify(restored?.data) === JSON.stringify(original),
    );
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
