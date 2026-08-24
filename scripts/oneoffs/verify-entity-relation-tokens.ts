/**
 * One-off verification for the generated entity relation tokens.
 *
 * Run: npx tsx scripts/oneoffs/verify-entity-relation-tokens.ts
 */
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";
import { eventNotifierRegistry } from "../../server/plugins/event-notifier/registry";
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
    buildTokenCatalogForRoots,
  } = await import("../../server/plugins/tokens");

  console.log("\n--- generated entity relations ---");
  const generated = tokenPluginRegistry
    .list()
    .filter((p) => p.metadata.id.startsWith("token.entity_relation."));
  for (const p of generated) {
    console.log(
      `  {{${p.metadata.inputTypes.join("|")}.${p.metadata.segmentName}}} ` +
        `-> ${p.metadata.outputType}  [${p.metadata.id}]` +
        (p.metadata.requiredComponent ? ` component=${p.metadata.requiredComponent}` : ""),
    );
  }
  check("at least one entity relation generated", generated.length > 0, `${generated.length}`);

  const jobEmployer = generated.find(
    (p) =>
      p.metadata.segmentName === "employer" &&
      p.metadata.inputTypes.includes("dispatch_job"),
  );
  check("dispatch_job -> employer relation generated", Boolean(jobEmployer));

  console.log("\n--- hand-written segments are not shadowed ---");
  for (const [name, input, expectedId] of [
    ["contact", "worker", "token.worker.contact"],
    ["bargaining_unit", "worker", "token.worker.bargaining_unit"],
    ["worker", "dispatch_worker_status", "token.dispatch_worker_status.worker"],
    ["dispatch_job", "dispatch_fore", "token.dispatch_fore.dispatch_job"],
  ] as const) {
    const dupes = tokenPluginRegistry
      .list()
      .filter(
        (p) =>
          p.metadata.segmentName === name && p.metadata.inputTypes.includes(input),
      );
    check(
      `{{${input}.${name}}} still has exactly one handler`,
      dupes.length === 1 && dupes[0].metadata.id === expectedId,
      dupes.map((d) => d.metadata.id).join(", ") || "none",
    );
  }

  console.log("\n--- validation ---");
  const roots = ["dispatch_fore", "dispatch_job", "event"];
  for (const expr of [
    "dispatch_job.employer",
    'dispatch_job.employer.field(name="sirius_id")',
    'dispatch_job.field(name="employer_id")',
  ]) {
    const v = validateTokenExpressionForRoots(expr, roots);
    check(`{{${expr}}} validates`, v.ok, v.ok ? undefined : v.error);
  }

  console.log("\n--- catalog under the fore notifier's roots ---");
  const catalog = buildTokenCatalogForRoots(roots);
  const employerEntries = catalog.filter((e) => e.id.includes("dispatch_job.employer"));
  console.log(`  catalog entries: ${catalog.length}`);
  for (const e of employerEntries) console.log(`  ${e.insertText}  — ${e.label}`);
  check("catalog offers the job's employer", employerEntries.length > 0);

  console.log("\n--- render against a real job ---");
  const { data: jobs } = await storage.dispatchJobs.getPaginated(1, 25);
  const job = jobs.find((j) => j.employerId);
  if (!job) {
    check("a dispatch job with an employer exists to render against", false);
  } else {
    const row = await storage.dispatchJobs.get(job.id);
    const { dispatchJobs } = await import("../../shared/schema");
    const ctx = createTokenEvalContext(storage, undefined, {
      seeds: [
        {
          name: "dispatch_job",
          entity: {
            kind: "dispatch_job",
            row: row as unknown as Record<string, unknown>,
            table: dispatchJobs,
          },
        },
      ],
    });
    const shortForm = await renderTokens("{{dispatch_job.employer}}", ctx);
    const longForm = await renderTokens(
      '{{dispatch_job.field(name="employer_id")}}',
      ctx,
    );
    const other = await renderTokens(
      '{{dispatch_job.employer.field(name="sirius_id")}}',
      ctx,
    );
    console.log(`  job: ${job.title} (${job.employerName})`);
    console.log(`  short form : "${shortForm.output}"`);
    console.log(`  long form  : "${longForm.output}"`);
    console.log(`  sirius_id  : "${other.output}"`);
    check(
      "short form renders the same text as the foreign-key field",
      shortForm.output === longForm.output && shortForm.output === job.employerName,
    );
    check(
      "a field beyond the name is now reachable",
      other.output !== "" && other.output !== shortForm.output,
      other.output,
    );
    check("no unknown tokens", shortForm.unknownTokens.length === 0);
  }

  console.log("\n--- the fore notifier's shipped default ---");
  const fore = eventNotifierRegistry
    .list()
    .find((p) => p.id === "dispatch-fore-notifier");
  const defaults = fore?.tokenTemplates?.defaultTemplates?.();
  const inapp = defaults?.inapp;
  console.log(`  ${inapp?.body ?? "(none)"}`);
  check(
    "the shipped default uses the generated relation",
    typeof inapp?.body === "string" && inapp.body.includes("{{dispatch_job.employer}}"),
  );

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
