import { t631Fetch } from "../../server/modules/sitespecific/t631/client/fetch";
import { syncWorkerEins } from "../../server/modules/sitespecific/t631/client/sync-workers";

async function main() {
  const fetchResult = await t631Fetch("sirius_edls_server_worker_list");
  if (!fetchResult.success) throw new Error(`fetch failed: ${fetchResult.error}`);
  const res = await syncWorkerEins(fetchResult.data as any, true);
  console.log(JSON.stringify({ created: res.created, updated: res.updated, unchanged: res.unchanged, skipped: res.skipped, errors: res.errors }, null, 2));
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
