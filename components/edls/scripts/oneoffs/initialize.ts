import { loadComponentCache, isComponentEnabledSync } from "../../../../server/services/component/cache";
import { registerEdlsSnapshotCapture } from "../../server/snapshot-capture";
import "../../server/plugins/tokens/plugins/edls";
import "../../server/plugins/tokens/plugins/edls-worker";

let initialized = false;
/** Restore declarations formerly imported through core barrels, without booting a server. */
export async function initializeEdlsOperator(): Promise<void> {
  if (initialized) return;
  await loadComponentCache();
  if (!isComponentEnabledSync("edls")) throw new Error("This operator command requires enabled EDLS");
  registerEdlsSnapshotCapture();
  initialized = true;
}
