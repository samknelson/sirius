import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { emptyWmbPhase } from "../../scripts/s1-migration/lib/wmb-event-phase";
import { SCHEDULED_SYNC_ARGS } from "../../scripts/s1-migration/lib/daily-automation";

const fake = vi.hoisted(() => ({
  spawn: vi.fn(), publish: vi.fn(), rm: vi.fn(), code: 0,
  report: {} as Record<string, unknown>,
}));
vi.mock("node:child_process", () => ({ spawn: fake.spawn }));
vi.mock("node:fs/promises", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  rm: fake.rm,
}));
vi.mock("../../scripts/s1-migration/lib/script-env", () => ({ getRawProcessEnv: () => ({}) }));
vi.mock("../../scripts/s1-migration/lib/sns-alert", () => ({ publishS1AutomationAlert: fake.publish }));
const originalArgv = process.argv;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.argv = ["node", "run-scheduled-daily.ts"];
  fake.code = 0;
  fake.report = {
    command: "sync", mode: "daily", profile: "production", result: "PASS",
    forceReconcile: false, skipStage: false, skipSeeders: true, keepGoing: true, dryRun: false,
    financialLinkApprovals: { payment: false, ar: false },
    gates: { stage: "pass", fleet: "pass", parity: "pass", financialIdentity: "pass", wmbEvents: "disabled" },
    wmbEvents: { ...emptyWmbPhase(false), status: "disabled", reason: "awaiting-tested-image-activation" },
    financialIdentity: { blocked: 0, mismatched: 0, counts: { attribution_mismatches: 0 },
      rebinds: ["private-row-do-not-publish"] },
  };
  fake.publish.mockResolvedValue(undefined);
  fake.rm.mockImplementation(async (path: string) => {
    const { rm } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    await rm(path, { force: true });
  });
  fake.spawn.mockImplementation((_cmd: string, _args: string[], options: { env: Record<string, string> }) => {
    const child = new EventEmitter();
    setImmediate(() => {
      writeFileSync(options.env.S1_RESULT_JSON_PATH, JSON.stringify(fake.report));
      child.emit("exit", fake.code);
    });
    return child;
  });
});
afterEach(() => { process.argv = originalArgv; process.exitCode = 0; vi.restoreAllMocks(); });
async function runWrapper() {
  await import("../../scripts/s1-migration/run-scheduled-daily");
  await vi.waitFor(() => expect(fake.rm).toHaveBeenCalledOnce());
}
describe("actual scheduler wrapper financial path", () => {
  it("launches only the fixed ordinary daily command and publishes aggregate identity proof", async () => {
    await runWrapper();
    expect(fake.spawn).toHaveBeenCalledWith("npx", [...SCHEDULED_SYNC_ARGS], expect.anything());
    const [subject, message] = fake.publish.mock.calls[0];
    expect(subject).toBe("S1 daily sync completed");
    expect(JSON.parse(message).financialIdentity).toMatchObject({ status: "pass", mismatched: 0 });
    expect(message).not.toContain("private-row-do-not-publish");
    expect(process.exitCode).not.toBe(1);
  });
  it("publishes failure for equal-total wrong-worker attribution", async () => {
    fake.report.result = "FAIL";
    fake.report.financialIdentity = { blocked: 0, mismatched: 2, counts: { attribution_mismatches: 2 } };
    await runWrapper();
    expect(fake.publish.mock.calls[0][0]).toBe("S1 daily sync failed");
    expect(JSON.parse(fake.publish.mock.calls[0][1])).toMatchObject({
      result: "FAIL", financialIdentity: { status: "fail", mismatched: 2 },
    });
    expect(process.exitCode).toBe(1);
  });
  it("never announces success when the child exits nonzero with a PASS file", async () => {
    fake.code = 1;
    await runWrapper();
    expect(fake.publish.mock.calls[0][0]).toBe("S1 daily sync failed");
    expect(process.exitCode).toBe(1);
  });
  it("announces failure after a completed fleet containing a failed loader", async () => {
    fake.code = 1;
    fake.report.result = "FAIL";
    fake.report.gates = { ...(fake.report.gates as object), fleet: "fail" };
    fake.report.failures = ["elections: disallowed rejects: employer_ref_missing=1"];
    await runWrapper();
    expect(fake.publish.mock.calls[0][0]).toBe("S1 daily sync failed");
    expect(JSON.parse(fake.publish.mock.calls[0][1])).toMatchObject({
      status: "failure", result: "FAIL", gates: { fleet: "fail" },
    });
    expect(process.exitCode).toBe(1);
  });
  it("refuses a child PASS without financial identity proof", async () => {
    delete fake.report.financialIdentity;
    await runWrapper();
    expect(fake.publish.mock.calls[0][0]).toBe("S1 daily sync failed");
    expect(process.exitCode).toBe(1);
  });
  it.each(["--approve-payment-links", "--keep-going", "--mode=daily", "--unknown"])(
    "refuses caller argument %s before launching a child", async (flag) => {
    process.argv.push(flag);
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await import("../../scripts/s1-migration/run-scheduled-daily");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(fake.spawn).not.toHaveBeenCalled();
  });
});
