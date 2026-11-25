import { wcRequest } from "../../../../server/services/webclient";
import { syncWorkerEins } from "../../../../server/services/worker-sync";
import "../../../../server/generated/component-startups";
import { loadComponentCache } from "../../../../server/services/component/cache";

async function main() {
  await loadComponentCache();
  const answer = await wcRequest({
    vendor: { pluginId: "sitespecific-t631" },
    operation: "sitespecific.t631.worker.list",
    args: undefined,
  });
  if (answer.outcome !== "success") throw new Error(answer.error ?? "Worker list unavailable");
  const fetchResult = answer.value;
  if (!fetchResult.success) throw new Error(`fetch failed: ${fetchResult.error}`);
  const res = await syncWorkerEins(fetchResult.data as any, true);
  console.log(JSON.stringify({ workersCreated: res.workersCreated, created: res.created, updated: res.updated, unchanged: res.unchanged, skipped: res.skipped, errors: res.errors }, null, 2));
  const byError: Record<string, number> = {};
  for (const d of res.details) {
    const key = d.action + (d.error ? `:${d.error.split(" ")[0].split("(")[0]}` : "");
    byError[key] = (byError[key] || 0) + 1;
  }
  console.log(byError);
  console.log("sample details:", JSON.stringify(res.details.slice(0, 5), null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
