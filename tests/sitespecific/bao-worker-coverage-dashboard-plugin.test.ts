import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@shared/schema";

const { linkedWorker, buildSummary, userHasPermission, checkAccess, componentEnabled, getUser } =
  vi.hoisted(() => ({
    linkedWorker: vi.fn(),
    buildSummary: vi.fn(),
    userHasPermission: vi.fn(),
    checkAccess: vi.fn(),
    componentEnabled: vi.fn(),
    getUser: vi.fn(),
  }));

vi.mock("../../server/auth/worker-link", () => ({
  resolveLinkedWorkerId: linkedWorker,
}));
vi.mock("../../server/services/sitespecific/bao/worker-coverage-dashboard", () => ({
  buildWorkerCoverageSummary: buildSummary,
}));
vi.mock("../../server/storage", () => ({
  storage: {
    users: { userHasPermission, getUser },
  },
}));
vi.mock("../../server/modules/components", () => ({
  isComponentEnabled: componentEnabled,
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  checkAccess,
}));

import { baoWorkerCoveragePlugin } from "../../server/plugins/dashboard/plugins/bao-worker-coverage";
import {
  checkStaffWorkerCoverageAccess,
  checkTargetPluginGating,
  resolveDashboardTargetUser,
} from "../../server/plugins/dashboard/registry";

const memberContent = (baoWorkerCoveragePlugin.content as Record<string, (ctx: any) => Promise<unknown>>)[""];
const staffContent = (baoWorkerCoveragePlugin.content as Record<string, (ctx: any) => Promise<unknown>>)["staff-worker"];

describe("BAO worker coverage dashboard authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    componentEnabled.mockResolvedValue(true);
    checkAccess.mockResolvedValue({ granted: true });
    userHasPermission.mockResolvedValue(true);
  });

  it("resolves coverage only from the effective dashboard dbUser, not query input", async () => {
    const dbUser = { id: "effective-user" };
    linkedWorker.mockResolvedValue("linked-worker");
    buildSummary.mockResolvedValue({ state: "available", workerId: "linked-worker" });
    const ctx = {
      dbUser,
      query: { workerId: "attacker-selected-worker" },
      storage: {
        users: { userHasPermission: vi.fn().mockResolvedValue(true) },
        workers: { getWorker: vi.fn().mockResolvedValue({ id: "linked-worker" }) },
      },
    };

    await expect(memberContent(ctx)).resolves.toEqual({
      state: "available",
      workerId: "linked-worker",
    });
    expect(linkedWorker).toHaveBeenCalledWith(dbUser);
    expect(buildSummary).toHaveBeenCalledWith(ctx.storage, "linked-worker");
    expect(buildSummary).not.toHaveBeenCalledWith(
      expect.anything(),
      "attacker-selected-worker",
    );
  });

  it("returns explicit unlinked state and does not request worker data", async () => {
    linkedWorker.mockResolvedValue(null);
    const ctx = {
      dbUser: { id: "unlinked-user" },
      storage: { users: { userHasPermission: vi.fn().mockResolvedValue(true) } },
    };
    await expect(memberContent(ctx)).resolves.toMatchObject({
      state: "unlinked",
    });
    expect(buildSummary).not.toHaveBeenCalled();
  });

  it("refuses direct content access for users without worker permission", async () => {
    const ctx = {
      dbUser: { id: "staff-only-user" },
      storage: { users: { userHasPermission: vi.fn().mockResolvedValue(false) } },
    };
    await expect(memberContent(ctx))
      .rejects.toMatchObject({ status: 403 });
    expect(linkedWorker).not.toHaveBeenCalled();
  });

  it("retains staff-only target override checks and gates the target on worker permission", async () => {
    const staffUser = { id: "staff-user" } as User;
    const targetUser = { id: "target-user" } as User;
    getUser.mockResolvedValue(targetUser);
    checkAccess.mockResolvedValueOnce({ granted: false, reason: "not staff" });
    await expect(resolveDashboardTargetUser(
      { query: { targetUserId: "target-user" } } as any,
      staffUser,
    )).resolves.toMatchObject({ ok: false, status: 403 });

    checkAccess.mockResolvedValue({ granted: true });
    userHasPermission.mockResolvedValue(false);
    await expect(checkTargetPluginGating(baoWorkerCoveragePlugin, targetUser)).resolves.toMatchObject({
      ok: false,
      status: 403,
    });

    userHasPermission.mockResolvedValue(true);
    await expect(checkTargetPluginGating(baoWorkerCoveragePlugin, targetUser)).resolves.toEqual({
      ok: true,
    });
  });

  it("authorizes only staff with access to the requested worker for staff content", async () => {
    const user = { id: "staff-user" } as User;
    const req = { query: { workerId: "selected-worker" } } as any;
    checkAccess.mockResolvedValueOnce({ granted: false });
    await expect(checkStaffWorkerCoverageAccess(baoWorkerCoveragePlugin, req, user))
      .resolves.toMatchObject({ ok: false, status: 403 });
    expect(checkAccess).toHaveBeenCalledTimes(1);

    checkAccess.mockResolvedValueOnce({ granted: true }).mockResolvedValueOnce({ granted: false });
    await expect(checkStaffWorkerCoverageAccess(baoWorkerCoveragePlugin, req, user))
      .resolves.toMatchObject({ ok: false, status: 403 });

    await expect(checkStaffWorkerCoverageAccess(
      baoWorkerCoveragePlugin,
      { query: { workerId: "selected-worker", targetUserId: "other-user" } } as any,
      user,
    )).resolves.toMatchObject({ ok: false, status: 400 });

    await expect(checkStaffWorkerCoverageAccess(baoWorkerCoveragePlugin, req, user))
      .resolves.toEqual({ ok: true, workerId: "selected-worker" });
    expect(checkAccess).toHaveBeenCalledWith("staff", user);
    expect(checkAccess).toHaveBeenCalledWith("worker.view", user, "selected-worker");
    componentEnabled.mockResolvedValueOnce(false);
    await expect(checkStaffWorkerCoverageAccess(baoWorkerCoveragePlugin, req, user))
      .resolves.toMatchObject({ ok: false, status: 403 });
  });

  it("uses the selected worker on the authorized staff dashboard action", async () => {
    const storage = { workers: { getWorker: vi.fn().mockResolvedValue({ id: "selected-worker" }) } };
    buildSummary.mockResolvedValue({ state: "available", workerId: "selected-worker" });
    await expect(staffContent({ query: { workerId: "selected-worker" }, storage }))
      .resolves.toMatchObject({ workerId: "selected-worker" });
    expect(buildSummary).toHaveBeenCalledWith(storage, "selected-worker");
    expect(linkedWorker).not.toHaveBeenCalled();
  });
});