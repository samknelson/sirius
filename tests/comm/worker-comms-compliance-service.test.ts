import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IStorage } from "../../server/storage";
import type { User } from "../../shared/schema";
import { workerCommsDefinitionSchema } from "../../shared/worker-comms-compliance";
const { checkAccess, enabled } = vi.hoisted(() => ({
  checkAccess: vi.fn(), enabled: vi.fn(),
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({ checkAccess }));
vi.mock("../../server/modules/components", () => ({ isComponentEnabled: enabled }));
import { assertWorkerCommsSelection, saveWorkerCommsDefinition, getWorkerCommsDefinition, deleteWorkerCommsDefinition } from "../../server/services/worker-comms-compliance";

const body = () => workerCommsDefinitionSchema.parse({ name: "Statements", commTagId: "tag", statuses: ["sent"], population: {} });
const options = {
  tags: [{ id: "tag", name: "Statement" }], memberStatuses: [], benefits: [], employers: [], employerTypes: [],
  bargainingUnits: [], representatives: [], benefitsEnabled: true, bargainingUnitsEnabled: true, politicalEnabled: false,
};
function setup() {
  const fake = {
    variables: {
      getByName: vi.fn().mockResolvedValue({ id: "variable", name: "worker_comms_compliance_definition:def", value: body() }),
      create: vi.fn().mockResolvedValue({ id: "variable" }),
      update: vi.fn().mockResolvedValue({ id: "variable" }),
      delete: vi.fn().mockResolvedValue(true),
    },
    workerCommsCompliance: {
      options: vi.fn().mockResolvedValue(options),
      contacts: vi.fn().mockResolvedValue(["one", "two"]),
    },
  };
  return { fake, storage: fake as unknown as IStorage };
}
const user = { id: "staff" } as User;
describe("compliance definitions and bulk handoff", () => {
  beforeEach(() => { vi.clearAllMocks(); checkAccess.mockResolvedValue({ granted: true }); enabled.mockResolvedValue(true); });
  it("refuses stale or fabricated contact IDs before enrollment", async () => {
    const { fake, storage } = setup();
    await expect(assertWorkerCommsSelection(storage, user, { definitionId: "def", view: "without" }, ["one", "outsider"]))
      .rejects.toMatchObject({ status: 409 });
    expect(fake.workerCommsCompliance.contacts).toHaveBeenCalledWith({ ...body(), id: "def" }, "without");
    expect(fake.variables.create).not.toHaveBeenCalled();
    await expect(assertWorkerCommsSelection(storage, user, { definitionId: "def", view: "without" }, ["one"])).resolves.toBeUndefined();
  });
  it("refuses bulk report handoff when component or staff access is missing", async () => {
    const { fake, storage } = setup();
    checkAccess.mockResolvedValue({ granted: false });
    await expect(assertWorkerCommsSelection(storage, user, { definitionId: "def", view: "all" }, ["one"])).rejects.toMatchObject({ status: 403 });
    checkAccess.mockResolvedValue({ granted: true });
    enabled.mockResolvedValue(false);
    await expect(assertWorkerCommsSelection(storage, user, { definitionId: "def", view: "all" }, ["one"])).rejects.toMatchObject({ status: 403 });
    expect(fake.workerCommsCompliance.contacts).not.toHaveBeenCalled();
  });
  it("refuses malformed selection rather than falling back to a broader view", async () => {
    const { storage } = setup();
    await expect(assertWorkerCommsSelection(storage, user, { definitionId: "def", view: "typo" }, ["one"])).rejects.toMatchObject({ status: 400 });
  });
  it("rejects removed tag or population references without saving or broadening", async () => {
    const { fake, storage } = setup();
    await expect(saveWorkerCommsDefinition(storage, { ...body(), commTagId: "missing" })).rejects.toMatchObject({ status: 409 });
    await expect(saveWorkerCommsDefinition(storage, { ...body(), population: { benefitIds: ["missing"] } })).rejects.toMatchObject({ status: 409 });
    expect(fake.variables.create).not.toHaveBeenCalled();
    expect(fake.variables.update).not.toHaveBeenCalled();
  });
  it("saves separate definitions without replacing a shared definitions array", async () => {
    const { fake, storage } = setup();
    const result = await saveWorkerCommsDefinition(storage, body());
    expect(fake.variables.create).toHaveBeenCalledWith({ name: `worker_comms_compliance_definition:${result.id}`, value: body() });
    expect(result.name).toBe("Statements");
    expect(fake.variables.update).not.toHaveBeenCalled();
  });
  it("deleting a definition leaves communication history and messages untouched", async () => {
    const { fake, storage } = setup();
    await deleteWorkerCommsDefinition(storage, "def");
    expect(fake.variables.delete).toHaveBeenCalledWith("variable");
  });
  it("does not silently recreate a deleted definition during editing or reading", async () => {
    const { fake, storage } = setup();
    fake.variables.getByName.mockResolvedValue(undefined);
    await expect(getWorkerCommsDefinition(storage, "def")).rejects.toMatchObject({ status: 404 });
    await expect(saveWorkerCommsDefinition(storage, body(), "def")).rejects.toMatchObject({ status: 404 });
    expect(fake.variables.create).not.toHaveBeenCalled();
  });
});
