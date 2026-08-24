/**
 * One-off end-to-end verification for the grievance status notifier's token
 * roots, after renaming `grievance_status` → `grievance_status_history` and
 * seeding `grievance` as a root of its own.
 *
 * Proves the three things the change is about, against real data:
 *   1. each root builds a record that carries EVERY field its kind advertises
 *      (the failure mode that used to render blank in delivered messages),
 *   2. the shipped default templates render real values, and
 *   3. the stored-template rewrite converts an old custom template and is
 *      idempotent.
 *
 * Run: npx tsx scripts/oneoffs/verify-grievance-status-tokens.ts
 */
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
import { grievanceStatusHistory } from "../../shared/schema/grievance/schema";
import { desc } from "drizzle-orm";

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

  const plugin = eventNotifierRegistry
    .list()
    .find((p) => p.id === "grievance-status-notifier");
  if (!plugin?.tokenTemplates) throw new Error("notifier not registered");

  const [entry] = await db
    .select()
    .from(grievanceStatusHistory)
    .orderBy(desc(grievanceStatusHistory.date))
    .limit(1);
  if (!entry) throw new Error("no grievance status history rows to test with");
  console.log(
    `Subject: status entry ${entry.id} on grievance ${entry.grievanceId}\n`,
  );

  // The dispatcher hands each root the event context; mirror the payload the
  // status-history storage now emits.
  const ctx = {
    event: "grievance_status_history_saved",
    payload: {
      grievanceId: entry.grievanceId,
      previousStatusId: null,
      previousStatusName: null,
      newStatusId: entry.statusId,
      newStatusName: null,
      newStatusHistoryId: entry.id,
    },
  } as never;

  const seeds = [];
  for (const root of plugin.tokenTemplates.roots) {
    const built = await root.build(ctx);
    check(`root {{${root.name}}} builds a record`, built !== null);
    if (!built) continue;
    const missing = missingCatalogFields(built);
    check(
      `root {{${root.name}}} supplies every advertised field`,
      missing.length === 0,
      missing.length ? `missing: ${missing.join(", ")}` : `kind ${built.kind}`,
    );
    seeds.push({ name: root.name, entity: built });
  }
  seeds.push({
    name: "event",
    entity: { kind: "event", row: { type: ctx.event, firedAt: new Date() } },
  });

  // Render the shipped defaults exactly as delivery would.
  const templates = plugin.tokenTemplates.defaultTemplates();
  const evalCtx = createTokenEvalContext(storage, null, { seeds });
  console.log("\nRendered default templates:");
  for (const [channel, fields] of Object.entries(templates)) {
    for (const [field, template] of Object.entries(
      fields as Record<string, string>,
    )) {
      const r = await renderTokens(template, evalCtx);
      console.log(`  ${channel}.${field}: ${r.output}`);
      check(
        `${channel}.${field} renders without unknown tokens`,
        r.unknownTokens.length === 0,
        r.unknownTokens.join(", "),
      );
      // A token that resolves to nothing is the exact bug being fixed: it
      // passes validation and arrives blank.
      check(
        `${channel}.${field} renders no empty/missing token`,
        r.missingValues.length === 0 && r.emptyValues.length === 0,
        [...r.missingValues, ...r.emptyValues].join(", "),
      );
    }
  }

  // Stored-template rewrite. The grammar allows arguments in any order,
  // arbitrary whitespace, and quotes/braces inside argument values — the
  // shapes a text-level rewrite silently mangles — so exercise all of them.
  const [rewrite] = NOTIFIER_TEMPLATE_REWRITES;
  const legacy =
    'Grievance {{grievance_status.field(name="grievance_title")}} is now ' +
    '{{grievance_status.field(name="status_name")}} ' +
    '({{grievance_status.field(name="date", format="Y-m-d")}}) — ' +
    '{{grievance_status.grievance.field(name="sirius_id")}}';
  const once = rewriteTemplateTokens(legacy, rewrite);
  const twice = rewriteTemplateTokens(once, rewrite);
  console.log(`\nLegacy custom template:\n  ${legacy}\nRewritten:\n  ${once}`);
  check("rewrite leaves no old root", !once.includes("grievance_status."));
  check(
    "rewrite maps the flattened title to the grievance",
    once.includes('grievance.field(name="display_title")'),
  );
  check(
    "rewrite maps the flattened status name to the status FK",
    once.includes('grievance_status_history.field(name="status_id")'),
  );
  check(
    "rewrite preserves other args",
    once.includes('name="date", format="Y-m-d"'),
  );
  check("rewrite is idempotent", once === twice);

  const awkward: Array<[string, string, string]> = [
    [
      "arguments in the other order",
      '{{grievance_status.field(default="Unknown", name="status_name")}}',
      '{{grievance_status_history.field(default="Unknown", name="status_id")}}',
    ],
    [
      "whitespace around the chain and arguments",
      '{{  grievance_status.field( name = "grievance_title" )  }}',
      '{{grievance.field(name="display_title")}}',
    ],
    [
      "a brace inside an argument value",
      '{{grievance_status.field(name="status_name", default="{unset}")}}',
      '{{grievance_status_history.field(name="status_id", default="{unset}")}}',
    ],
    [
      "an escaped quote inside an argument value",
      '{{grievance_status.field(name="status_name", default="say \\"none\\"")}}',
      '{{grievance_status_history.field(name="status_id", default="say \\"none\\"")}}',
    ],
    [
      "a deeper chain off the grievance hop",
      '{{grievance_status.grievance.field(name="name", default="—")}}',
      '{{grievance.field(name="name", default="—")}}',
    ],
    [
      "a token about something else",
      '{{worker.field(name="first_name")}}',
      '{{worker.field(name="first_name")}}',
    ],
    [
      "an unparseable token, left alone",
      "{{grievance_status.field(name=unquoted)}}",
      "{{grievance_status.field(name=unquoted)}}",
    ],
  ];
  console.log("");
  for (const [label, input, expected] of awkward) {
    const got = rewriteTemplateTokens(input, rewrite);
    check(`rewrite handles ${label}`, got === expected, `got ${got}`);
    check(
      `rewrite of ${label} is idempotent`,
      rewriteTemplateTokens(got, rewrite) === got,
    );
  }

  const rewrittenCtx = createTokenEvalContext(storage, null, { seeds });
  const legacyResult = await renderTokens(once, rewrittenCtx);
  console.log(`Rendered:\n  ${legacyResult.output}`);
  check(
    "rewritten custom template renders without unknown tokens",
    legacyResult.unknownTokens.length === 0,
    legacyResult.unknownTokens.join(", "),
  );
  check(
    "rewritten custom template renders no empty/missing token",
    legacyResult.missingValues.length === 0 &&
      legacyResult.emptyValues.length === 0,
    [...legacyResult.missingValues, ...legacyResult.emptyValues].join(", "),
  );

  // The boot migration against a REAL config row: plant a legacy custom
  // template, run the migration the way boot does, then put the config back
  // exactly as it was.
  const { migrateNotifierTemplateTokens } = await import(
    "../../server/plugins/event-notifier/template-token-migrations"
  );
  const [cfg] = await storage.pluginConfigs.getByKindAndPlugin(
    "event-notifier",
    "grievance-status-notifier",
  );
  if (!cfg) {
    console.log("SKIP: no grievance-status-notifier config to migrate");
  } else {
    const original = cfg.data;
    const planted = {
      ...((original ?? {}) as Record<string, unknown>),
      templates: { inapp: { title: legacy } },
    };
    await storage.pluginConfigs.update(cfg.id, { data: planted });
    await migrateNotifierTemplateTokens();
    const after = await storage.pluginConfigs.get(cfg.id);
    const title = (after?.data as any)?.templates?.inapp?.title as string;
    check("boot migration rewrote the stored template", title === once, title);
    await migrateNotifierTemplateTokens();
    const again = await storage.pluginConfigs.get(cfg.id);
    check(
      "boot migration is a no-op on the second run",
      (again?.data as any)?.templates?.inapp?.title === once,
    );
    await storage.pluginConfigs.update(cfg.id, { data: original as never });
    const restored = await storage.pluginConfigs.get(cfg.id);
    check(
      "config restored to its original data",
      JSON.stringify(restored?.data) === JSON.stringify(original),
    );
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
