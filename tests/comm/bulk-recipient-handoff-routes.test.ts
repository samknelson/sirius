import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IStorage } from "../../server/storage";
import type { Express } from "express";

const mocks = vi.hoisted(() => ({
  handoff: vi.fn(), effective: vi.fn(), deliver: vi.fn(), bulk: true, access: true,
}));
vi.mock("../../server/services/bulk-recipient-handoff", () => ({ handoffBulkRecipients: mocks.handoff }));
vi.mock("../../server/modules/bulk/deliver", () => ({
  deliverToContact: mocks.deliver, deliverToParticipant: mocks.deliver, resolveAddressForMedium: vi.fn(),
}));
vi.mock("../../server/modules/bulk/token-roots", () => ({}));
vi.mock("../../server/plugins/tokens", () => ({}));
vi.mock("../../server/plugins/tokens/plugins/bulk-participant", () => ({}));
vi.mock("../../server/plugins/tokens/contexts", () => ({ tokenContextRootNames: vi.fn() }));
vi.mock("../../server/modules/contact-links", () => ({}));
vi.mock("../../server/storage/bulk/participants", () => ({ createBulkParticipantStorage: () => ({}) }));
vi.mock("../../server/logger", () => ({ storageLogger: {} }));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: mocks.effective }));
vi.mock("../../server/modules/components", () => ({
  requireComponent: () => (_req: unknown, res: any, next: () => void) => mocks.bulk ? next() : res.status(403).json({ message: "Bulk disabled" }),
  isComponentEnabled: vi.fn(),
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({ checkAccess: vi.fn() }));
vi.mock("../../server/storage/transaction-context", () => ({ runInTransaction: vi.fn() }));
import { registerBulkMessageRoutes } from "../../server/modules/bulk/messages";
import { WorkerCommsError } from "../../server/services/worker-comms-compliance";

function harness() {
  const routes = new Map<string, any[]>();
  const app = Object.fromEntries(["get", "post", "patch", "put", "delete"].map(method => [
    method, (path: string, ...handlers: any[]) => routes.set(`${method}:${path}`, handlers),
  ])) as unknown as Express;
  registerBulkMessageRoutes(app, (_req, _res, next) => next(), () => (_req, res, next) =>
    mocks.access ? next() : res.status(403).json({ message: "Denied" }), {} as IStorage);
  return async (body: unknown) => {
    const res = { code: 200, body: undefined as any, setHeader: vi.fn(), status(code: number) { this.code = code; return this; }, json(value: any) { this.body = value; return this; } };
    const handlers = routes.get("post:/api/bulk-messages/from-recipients")!;
    async function run(index: number): Promise<void> {
      if (!handlers[index]) return;
      let pending: Promise<void> | undefined;
      await handlers[index]({ body, session: { masqueradeUserId: "effective" }, user: { id: "original" } }, res, () => { pending = run(index + 1); });
      await pending;
    }
    await run(0);
    return res;
  };
}
describe("recipient handoff HTTP boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bulk = mocks.access = true;
    mocks.effective.mockResolvedValue({ dbUser: { id: "effective" } });
    mocks.handoff.mockResolvedValue({ bulkMessage: { id: "draft" }, participantsCreated: 1 });
  });
  it.each([undefined, "existing"])("passes the effective actor and optional report selection to %s draft", async bulkMessageId => {
    const request = harness();
    const reportSelection = { definitionId: "definition", view: "without" };
    expect((await request({ contactIds: ["c"], bulkMessageId, reportSelection })).code).toBe(201);
    expect(mocks.handoff).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bulkMessageId, actor: { id: "effective" }, reportSelection, hasReportSelection: true,
    }));
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("keeps no-report callers compatible and preserves actionable 409 failures", async () => {
    const request = harness();
    expect((await request({ contactIds: ["c"] })).code).toBe(201);
    expect(mocks.handoff).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ hasReportSelection: false }));
    mocks.handoff.mockRejectedValue(new WorkerCommsError("Refresh your selection", 409));
    expect(await request({ contactIds: ["c"] })).toMatchObject({ code: 409, body: { message: "Refresh your selection" } });
  });
  it("returns a retryable conflict after a concurrent recipient insert rolls the handoff back", async () => {
    mocks.handoff.mockRejectedValue({ cause: { code: "23505" } });
    expect(await harness()({ contactIds: ["c"] })).toMatchObject({ code: 409 });
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it.each(["bulk", "access"])("refuses handoff when %s is unavailable", async gate => {
    if (gate === "bulk") mocks.bulk = false; else mocks.access = false;
    expect((await harness()({ contactIds: ["c"] })).code).toBe(403);
    expect(mocks.handoff).not.toHaveBeenCalled();
  });
  it("refuses malformed destinations and recipients before mutation", async () => {
    const request = harness();
    for (const body of [{ contactIds: [] }, { contactIds: ["c"], bulkMessageId: 42 }, { contactIds: ["c"], bulkMessageId: "" }]) {
      expect((await request(body)).code).toBe(400);
    }
    expect(mocks.handoff).not.toHaveBeenCalled();
  });
});
