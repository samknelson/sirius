import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("@shared/alter", () => ({
  alterHooks: { declare: (definition: unknown) => definition, run: mocks.run },
}));
import { validatePolicyRequestInputs } from "../../server/modules/access-policies";

beforeEach(() => mocks.run.mockReset());
describe("policy endpoint input boundary", () => {
  it("accepts only explicitly claimed scalar inputs", async () => {
    mocks.run.mockResolvedValue({ transition: "approved", count: 2, preview: false, empty: null });
    expect(await validatePolicyRequestInputs("sample.transition", {
      transition: "approved", count: "2", preview: "false", empty: "",
    })).toEqual({ transition: "approved", count: 2, preview: false, empty: null });
  });
  it.each([
    [{ extra: "x" }, {}],
    [{ transition: ["approved", "rejected"] }, {}],
    [{ entityData: "{}" }, { entityData: {} }],
    [{ user: "someone" }, { user: "someone" }],
    [{ entityId: "someone" }, { entityId: "someone" }],
    [{ storage: "anything" }, { storage: "anything" }],
    [{ prototype: "anything" }, { prototype: "anything" }],
    [{ count: "1" }, { count: NaN }],
    [{ count: "1" }, { count: Infinity }],
    [{ transition: "approved" }, { transition: "approved", invented: true }],
  ])("refuses unclaimed, structured, identity or fabricated data", async (inputs, values) => {
    mocks.run.mockResolvedValue(values);
    expect(await validatePolicyRequestInputs("sample.transition", inputs)).toBeNull();
  });
});
