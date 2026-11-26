/**
 * EDLS portion of the former mixed notifier-root verification.
 * Read-only: render shipped defaults against a real sheet without sending.
 * Run from the repository root:
 * npx tsx components/edls/scripts/oneoffs/verify-notifier-token-roots.ts
 */
import { initializeEdlsOperator } from "./initialize";
import { storage } from "../../../../server/storage";
import { initializeEventNotifierPluginSystem } from "../../../../server/plugins/event-notifier";
import { initializeTokenPluginSystem, createTokenEvalContext, renderTokens } from "../../../../server/plugins/tokens";
import { missingIndexedFields } from "../../../../server/plugins/tokens/root-coverage";
import { edlsSheetStatusNotifier } from "../../server/plugins/event-notifier/plugins/edls-sheet-status-notifier";
import { EDLS_SHEET_SAVED } from "../../server/events";

async function main() {
  await initializeEdlsOperator();
  initializeEventNotifierPluginSystem();
  initializeTokenPluginSystem();
  const sheet = (await storage.edlsSheets.getAll())[0];
  if (!sheet) {
    console.log("SKIP: no EDLS sheets available for notifier-root verification");
    return;
  }
  const plugin = edlsSheetStatusNotifier;
  if (!plugin.tokenTemplates) throw new Error("EDLS status notifier has no template declaration");
  const context = {
    event: EDLS_SHEET_SAVED,
    payload: { sheetId: sheet.id, previousStatus: null, newStatus: sheet.status, sheet },
  };
  const seeds: Array<{ name: string; entity: unknown }> = [];
  for (const root of plugin.tokenTemplates.roots) {
    const built = await root.build(context);
    if (!built || built.kind !== root.name) throw new Error(`Invalid notifier root ${root.name}`);
    const missing = missingIndexedFields(built);
    if (missing.length) throw new Error(`Root ${root.name} omits advertised fields: ${missing.join(", ")}`);
    seeds.push({ name: root.name, entity: built });
  }
  seeds.push({ name: "event", entity: { kind: "event", row: { type: EDLS_SHEET_SAVED, firedAt: new Date() } } });
  const evaluation = createTokenEvalContext(storage, undefined, { seeds } as never);
  for (const [channel, fields] of Object.entries(plugin.tokenTemplates.defaultTemplates())) {
    for (const [field, template] of Object.entries(fields as Record<string, string>)) {
      const result = await renderTokens(template, evaluation);
      if (result.unknownTokens.length || result.missingValues.length || result.emptyValues.length) {
        throw new Error(`Default ${channel}.${field} did not render completely: ${[
          ...result.unknownTokens, ...result.missingValues, ...result.emptyValues,
        ].join(", ")}`);
      }
      console.log(`PASS: ${channel}.${field} rendered without unknown or empty tokens`);
    }
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
