import { expect, it, vi } from "vitest";
vi.mock("../../server/modules/components", () => ({ isComponentEnabled: () => false }));
import { registerWorkerSyncStrategy, syncWorkerEins } from "../../server/modules/sitespecific/t631/client/sync-workers";
it("refuses absent and disabled identity strategies before any mutation unit or deactivation", async () => {
  const unit = vi.fn();
  const run = vi.fn();
  await expect(syncWorkerEins({success: true, data: {workers: []}}, false, unit)).rejects.toThrow("no workers were changed");
  registerWorkerSyncStrategy({component: "optional.test", run});
  await expect(syncWorkerEins({success: true, data: {workers: []}}, true, unit)).rejects.toThrow("unavailable");
  expect(unit).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
