/**
 * One-off verification for the worker kind's default leaf — what
 * `{{worker}}` on its own says.
 *
 * Checks that the short form is writable wherever a worker record is
 * reachable (the worker root, a hop from a contact or a participant,
 * and a notifier that reaches one WITHOUT offering the worker root),
 * that the picker and the browsable tree offer it, and that sample and
 * real renders both produce the worker's sirius id.
 *
 * Run: npx tsx scripts/oneoffs/verify-worker-default-leaf.ts
 */
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import { storage } from "../../server/storage";
import { loadComponentCache } from "../../server/services/component-cache";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  await loadComponentCache();
  initializeTokenPluginSystem();
  const { initializeEventNotifierPluginSystem } = await import(
    "../../server/plugins/event-notifier"
  );
  initializeEventNotifierPluginSystem();

  const {
    validateTokenExpressionForRoots,
    buildTokenCatalogForRoots,
    renderTokens,
    createTokenEvalContext,
  } = await import("../../server/plugins/tokens");
  const { listTokenTreeRoots, expandTokenType } = await import(
    "../../server/plugins/tokens/tree"
  );
  const { BULK_TOKEN_ROOT_NAMES } = await import(
    "../../server/modules/bulk/token-roots"
  );
  const { notifierTokenRootNames } = await import(
    "../../server/plugins/event-notifier/token-roots"
  );

  console.log("\n--- short form validates where a worker is reachable ---");
  for (const expr of [
    "worker",
    "bulk_participant.contact.worker",
    "contact.worker",
    'worker.field(name="sirius_id")',
    'worker.field(name="job_title")',
    "worker.contact",
  ]) {
    const r = validateTokenExpressionForRoots(expr, BULK_TOKEN_ROOT_NAMES);
    check(`bulk: {{${expr}}}`, r.ok, r.ok ? undefined : r.error);
  }

  // A notifier reaches a worker through a hop and does NOT offer the
  // worker root, so the short form has to validate there too.
  const notifierRoots = notifierTokenRootNames([{ name: "dispatch_worker_status" }]);
  for (const expr of [
    "dispatch_worker_status.worker",
    'dispatch_worker_status.worker.field(name="sirius_id")',
    "dispatch_worker_status.worker.contact",
  ]) {
    const r = validateTokenExpressionForRoots(expr, notifierRoots);
    check(`notifier: {{${expr}}}`, r.ok, r.ok ? undefined : r.error);
  }
  check(
    "the worker root is still not offered to a notifier",
    !validateTokenExpressionForRoots("worker", notifierRoots).ok,
  );

  console.log("\n--- the picker and the tree show it ---");
  const treeRoots = listTokenTreeRoots(BULK_TOKEN_ROOT_NAMES);
  const workerRoot = treeRoots.find((r) => r.name === "worker");
  check(
    "the worker tree root carries the default leaf",
    workerRoot?.defaultLeaf === "sirius_id",
    String(workerRoot?.defaultLeaf),
  );
  const contactChild = expandTokenType("contact").children.find(
    (c) => c.kind === "relation" && c.segment === "worker",
  );
  check(
    "the worker hop under a contact is insertable",
    contactChild?.kind === "relation" && contactChild.defaultLeaf === "sirius_id",
  );
  const catalog = buildTokenCatalogForRoots(BULK_TOKEN_ROOT_NAMES);
  const short = catalog.find((e) => e.id === "worker");
  check(
    "the flat picker offers the short form",
    short?.insertText === "{{worker}}",
    short?.label,
  );

  console.log("\n--- what it renders ---");
  const sampleCtx = createTokenEvalContext(storage, undefined, {
    sample: true,
    sampleSetIds: { worker: "martian" },
  });
  const sampled = await renderTokens("{{worker}}", sampleCtx, { strictUnknown: true });
  check("sample render", sampled.output === "SAMPLE-0001", sampled.output);
  check("no unknown token", sampled.unknownTokens.length === 0);

  const [worker] = await storage.workers.getAllWorkers();
  const contactId = typeof worker?.contactId === "string" ? worker.contactId : undefined;
  if (!contactId) {
    console.log("SKIP: no worker rows available");
  } else {
    const ctx = createTokenEvalContext(storage, contactId);
    const real = await renderTokens(
      '{{worker}} / {{worker.field(name="sirius_id")}} / {{contact.worker}}',
      ctx,
      { strictUnknown: true },
    );
    const parts = real.output.split(" / ");
    check(
      "a real worker renders its sirius id, however it is reached",
      parts[0] !== "" && parts[0] === parts[1] && parts[1] === parts[2],
      real.output,
    );
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
