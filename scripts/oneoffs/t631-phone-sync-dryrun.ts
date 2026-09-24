import { t631Fetch } from "../../server/modules/sitespecific/t631/client/fetch";
import { syncWorkerEins } from "../../server/modules/sitespecific/t631/client/sync-workers";

async function main() {
  const fetchResult = await t631Fetch("sirius_edls_server_worker_list");
  if (!fetchResult.success) {
    console.error("T631 fetch failed:", fetchResult.error);
    process.exit(1);
  }
  const responseBody = fetchResult.data as Parameters<typeof syncWorkerEins>[0];
  const result = await syncWorkerEins(responseBody, true);
  const { details, ...counters } = result;
  console.log("COUNTERS:", JSON.stringify(counters, null, 2));
  const phoneActions = details.filter((d) =>
    ["would_delete_phone", "would_create_phone", "would_keep_phone", "would_optin", "phone_invalid", "phone_skipped"].includes(d.action),
  );
  console.log("PHONE ACTION COUNT:", phoneActions.length);
  console.log("SAMPLE PHONE ACTIONS:", JSON.stringify(phoneActions.slice(0, 15), null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
