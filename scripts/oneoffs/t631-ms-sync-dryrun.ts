import { t631Fetch } from "../../server/modules/sitespecific/t631/client/fetch";
import { syncWorkerEins } from "../../server/modules/sitespecific/t631/client/sync-workers";

async function main() {
  const fetchResult = await t631Fetch("sirius_edls_server_worker_list");
  if (!fetchResult.success) throw new Error(`fetch failed: ${fetchResult.error}`);
  const result = await syncWorkerEins(fetchResult.data as any, true);
  const { details, ...counters } = result;
  console.log("COUNTERS:", JSON.stringify(counters, null, 2));
  const byAction: Record<string, number> = {};
  for (const d of details) byAction[d.action] = (byAction[d.action] ?? 0) + 1;
  console.log("DETAIL ACTIONS:", JSON.stringify(byAction, null, 2));
  const interesting = details.filter((d) =>
    ["ms_unmatched", "would_set_status", "would_edls_activate", "would_edls_deactivate", "error"].includes(d.action),
  );
  console.log("SAMPLE:", JSON.stringify(interesting.slice(0, 25), null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
