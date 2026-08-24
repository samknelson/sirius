/**
 * One-off verification for the derived entity `path` / `url` tokens.
 *
 * Against real data:
 *   1. the leaves exist ONLY for kinds that declared where their records
 *      live, and a kind with no page offers neither,
 *   2. `{{x.path}}`, `{{x.url}}` and `{{x.field(name="path")}}` agree,
 *      and the `tab` argument reaches a real sub-page,
 *   3. a sub-entity renders its PARENT's page,
 *   4. a row with no usable id renders nothing at all — never a bare
 *      origin, never a dangling slash,
 *   5. a bad `tab` is refused at save time, and a retired one still
 *      renders the kind's default rather than a wrong link,
 *   6. the coverage report does not call `path` missing,
 *   7. sample mode shows a plausible link, and the picker offers the
 *      kind's real tabs as choices.
 *
 * Run: npx tsx scripts/oneoffs/verify-entity-path-tokens.ts
 */
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import { tokenPluginRegistry } from "../../server/plugins/tokens/registry";
import { storage } from "../../server/storage";
import { loadComponentCache } from "../../server/services/component-cache";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  await loadComponentCache();
  initializeEventNotifierPluginSystem();
  initializeTokenPluginSystem();
  const {
    renderTokens,
    createTokenEvalContext,
    validateTokenExpressionForRoots,
    listEntityLocationKinds,
    tabChoicesForKind,
    expandTokenType,
    missingCatalogFields,
    buildFieldCatalog,
  } = await import("../../server/plugins/tokens");
  const { grievances, grievanceStatusHistory } = await import(
    "../../shared/schema"
  );

  console.log("\n--- kinds that named a page ---");
  const declaring = listEntityLocationKinds();
  console.log(`  ${declaring.join(", ")}`);
  for (const kind of ["worker", "employer", "grievance", "dispatch_job"]) {
    check(`${kind} declares a location`, declaring.includes(kind));
  }
  for (const kind of ["contact", "address", "event", "options_gender"]) {
    check(`${kind} declares none`, !declaring.includes(kind));
  }

  console.log("\n--- leaves exist only where declared ---");
  for (const segment of ["path", "url"]) {
    const inputs = tokenPluginRegistry
      .list()
      .filter((p) => p.metadata.segmentName === segment)
      .flatMap((p) => p.metadata.inputTypes)
      .sort();
    check(
      `every ${segment} leaf belongs to a declaring kind`,
      inputs.length === declaring.length &&
        inputs.every((k) => declaring.includes(k)),
      inputs.join(", "),
    );
  }
  const catalog = buildFieldCatalog();
  check(
    "grievance advertises a path field",
    (catalog.grievance?.names ?? []).includes("path"),
  );
  check(
    "contact advertises none",
    !(catalog.contact?.names ?? []).includes("path"),
  );

  console.log("\n--- validation ---");
  const roots = ["grievance", "grievance_status_history"];
  for (const expr of [
    "grievance.path",
    "grievance.url",
    'grievance.path(tab="notes")',
    'grievance.url(tab="settlements")',
    'grievance.field(name="path")',
    "grievance_status_history.path",
  ]) {
    const v = validateTokenExpressionForRoots(expr, roots);
    check(`{{${expr}}} validates`, v.ok, v.ok ? undefined : v.error);
  }
  for (const expr of [
    'grievance.path(tab="no-such-tab")',
    "contact.path",
    "contact.url",
  ]) {
    const v = validateTokenExpressionForRoots(expr, [...roots, "contact"]);
    check(`{{${expr}}} is refused`, !v.ok, v.ok ? "accepted!" : v.error);
  }

  console.log("\n--- the picker's tab choices ---");
  const grievanceTabs = tabChoicesForKind("grievance").map((c) => c.value);
  console.log(`  grievance: ${grievanceTabs.join(", ")}`);
  check(
    "grievance offers its real tabs",
    ["details", "timeline", "settlements", "files", "notes", "logs"].every((t) =>
      grievanceTabs.includes(t),
    ),
  );
  const expansion = expandTokenType("grievance");
  const pathChild = expansion.children.find((c) => c.segment === "path");
  check("the browser offers a path leaf", Boolean(pathChild));
  check(
    "its tab argument carries choices, not a blank box",
    (pathChild?.args?.tab?.choices?.length ?? 0) > 0,
    `${pathChild?.args?.tab?.choices?.length ?? 0} choices, default ` +
      `${pathChild?.args?.tab?.default}`,
  );
  check(
    "inserting it writes the bare token (the tab is optional)",
    pathChild?.suffix === ".path",
    pathChild?.suffix,
  );
  const dateChild = expandTokenType("worker").children.find(
    (c) => c.segment === "date",
  );
  check(
    "a free-text argument still has no choices",
    dateChild ? !dateChild.args?.format?.choices : true,
  );

  console.log("\n--- render against a real grievance ---");
  const grievanceRows = await storage.grievances.search({});
  const grievance = grievanceRows[0];
  if (!grievance) {
    check("a grievance exists to render against", false);
  } else {
    const row = await storage.grievances.get(grievance.id);
    const ctx = createTokenEvalContext(storage, undefined, {
      seeds: [
        {
          name: "grievance",
          entity: {
            kind: "grievance",
            row: row as unknown as Record<string, unknown>,
            table: grievances,
          },
        },
      ],
    });
    const path = await renderTokens("{{grievance.path}}", ctx);
    const url = await renderTokens("{{grievance.url}}", ctx);
    const field = await renderTokens('{{grievance.field(name="path")}}', ctx);
    const notes = await renderTokens('{{grievance.path(tab="notes")}}', ctx);
    const retired = await renderTokens('{{grievance.path(tab="gone")}}', ctx);
    console.log(`  path   : "${path.output}"`);
    console.log(`  url    : "${url.output}"`);
    console.log(`  field  : "${field.output}"`);
    console.log(`  notes  : "${notes.output}"`);
    console.log(`  retired: "${retired.output}"`);
    check(
      "path is the grievance detail route",
      path.output === `/grievance/${grievance.id}`,
    );
    check("url is the origin plus that path", url.output.endsWith(path.output));
    check("url is absolute", /^https?:\/\/[^/]+\//.test(url.output));
    check("the field renders exactly what the leaf does", field.output === path.output);
    check("the tab argument reaches the sub-page", notes.output === `${path.output}/notes`);
    check(
      "a tab that no longer exists falls back to the default",
      retired.output === path.output,
    );
    check("no unknown tokens", path.unknownTokens.length === 0);
    check(
      "coverage does not call path missing",
      !missingCatalogFields({
        kind: "grievance",
        row: row as unknown as Record<string, unknown>,
        table: grievances,
      }).includes("path"),
    );
  }

  console.log("\n--- a sub-entity borrows its parent's page ---");
  const entry = grievance
    ? (await storage.grievanceStatusHistory.list(grievance.id))[0]
    : undefined;
  if (!entry) {
    check("a status entry exists to render against", false);
  } else {
    const ctx = createTokenEvalContext(storage, undefined, {
      seeds: [
        {
          name: "grievance_status_history",
          entity: {
            kind: "grievance_status_history",
            row: entry as unknown as Record<string, unknown>,
            table: grievanceStatusHistory,
          },
        },
      ],
    });
    const out = await renderTokens("{{grievance_status_history.path}}", ctx);
    console.log(`  path: "${out.output}"`);
    check(
      "it renders the grievance's timeline",
      out.output === `/grievance/${entry.grievanceId}/timeline`,
    );
  }

  console.log("\n--- a record with no usable id renders nothing ---");
  const emptyCtx = createTokenEvalContext(storage, undefined, {
    seeds: [
      {
        name: "grievance",
        entity: { kind: "grievance", row: { id: "" }, table: grievances },
      },
    ],
  });
  const emptyPath = await renderTokens("{{grievance.path}}", emptyCtx);
  const emptyUrl = await renderTokens("{{grievance.url}}", emptyCtx);
  check("path renders empty", emptyPath.output === "", `"${emptyPath.output}"`);
  check(
    "url renders empty, not a bare origin",
    emptyUrl.output === "",
    `"${emptyUrl.output}"`,
  );

  console.log("\n--- sample mode shows a plausible link ---");
  const sampleCtx = createTokenEvalContext(storage, undefined, { sample: true });
  const samplePath = await renderTokens("{{grievance.path}}", sampleCtx);
  const sampleUrl = await renderTokens('{{grievance.url(tab="notes")}}', sampleCtx);
  console.log(`  path: "${samplePath.output}"`);
  console.log(`  url : "${sampleUrl.output}"`);
  check("a sample path looks like a link", samplePath.output.startsWith("/grievance/"));
  check(
    "a sample url is absolute and honours the tab",
    /^https?:\/\//.test(sampleUrl.output) && sampleUrl.output.endsWith("/notes"),
  );

  console.log("\n--- every shipped default validates against its own roots ---");
  // A default template that fails validation rejects the save of EVERY
  // config for that notifier, so each edited default is checked against
  // the roots its own notifier declares — including the per-config
  // variants, whose link target changes with the recipient kind.
  const { eventNotifierRegistry } = await import(
    "../../server/plugins/event-notifier/registry"
  );
  const variantsByPlugin: Record<string, unknown[]> = {
    sitespecific_t631_interview: [
      { recipientKind: "worker" },
      { recipientKind: "employer" },
      { recipientKind: "staff" },
    ],
  };
  for (const plugin of eventNotifierRegistry.list()) {
    const tokens = plugin.tokenTemplates;
    if (!tokens) continue;
    const rootNames = tokens.roots.map((r) => r.name);
    for (const configData of variantsByPlugin[plugin.id] ?? [undefined]) {
      const templates = tokens.defaultTemplates(configData);
      for (const [channel, fields] of Object.entries(templates)) {
        for (const [field, template] of Object.entries(
          (fields ?? {}) as Record<string, string>,
        )) {
          if (typeof template !== "string") continue;
          for (const expr of template.matchAll(/\{\{([^}]+)\}\}/g)) {
            const v = validateTokenExpressionForRoots(expr[1].trim(), rootNames);
            check(
              `${plugin.id} ${channel}.${field}: {{${expr[1].trim()}}}`,
              v.ok,
              v.ok ? undefined : v.error,
            );
          }
        }
      }
    }
  }

  console.log(
    failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
