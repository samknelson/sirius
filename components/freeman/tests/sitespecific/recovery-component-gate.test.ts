import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ enabled: false, recover: vi.fn(), subscribe: vi.fn() }));
vi.mock("../../../../server/modules/components", () => ({ isComponentEnabled: () => state.enabled }));
vi.mock("../../../../server/services/event-bus", () => ({ eventBus: { on: state.subscribe }, EventType: { CRON_TICK_10M: "tick" } }));
vi.mock("../../../../server/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../../server/modules/sitespecific/freeman/edls-migrate/import", () => ({ recoverFreemanMigrate: state.recover }));
import { initializeFreemanMigrateRecovery } from "../../server/modules/sitespecific/freeman/edls-migrate/recovery";

it("keeps recovery registered but performs no recovery work while disabled", async () => {
  await initializeFreemanMigrateRecovery();
  expect(state.recover).not.toHaveBeenCalled();
  expect(state.subscribe).toHaveBeenCalledOnce();
  const tick = state.subscribe.mock.calls[0][0].handler;
  await tick();
  expect(state.recover).not.toHaveBeenCalled();
  state.enabled = true;
  await tick();
  expect(state.recover).toHaveBeenCalledOnce();
});
