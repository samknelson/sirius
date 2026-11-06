import { describe, expect, it, vi } from "vitest";
import { handleDependentsSubmit } from "../../server/plugins/wizards/enrollment/foundation";
import { lifeEventEnrollmentPlugin } from "../../server/plugins/wizards/plugins/life-event-enrollment";
vi.mock("../../server/plugins/wizards/attachments", () => ({
  listWizardAttachments: async () => [{ id: "document-1" }],
}));
// Staff can establish relationships while assisting an enrollment.
vi.mock("../../server/services/access-policy-evaluator", () => ({
  checkAccessInline: async () => ({ granted: true }),
}));

vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({
    get: async () => ({ id: "spouse", name: "Spouse" }),
  }),
}));

const existingContact = {
  id: "contact-existing",
  displayName: "Jordan Example",
  birthDate: "1990-02-03",
  gender: "gender-old",
  genderNota: null,
  genderCalc: "Existing designation",
};

function makeStorage(options: {
  matched?: boolean;
  initialContact?: Record<string, unknown>;
} = {}) {
  const contact = { ...(options.initialContact ?? {}) } as Record<string, any>;
  const worker = options.matched
    ? { id: "dependent-existing", contactId: "contact-existing" }
    : { id: "dependent-new", contactId: "contact-new" };
  const storage: any = {
    workers: {
      getWorkerBySSN: vi.fn(async () => (options.matched ? worker : undefined)),
      getWorker: vi.fn(async (workerId: string) =>
        workerId === worker.id ? worker : undefined,
      ),
      createWorker: vi.fn(async () => worker),
      updateWorkerSSN: vi.fn(async () => worker),
      updateWorkerContactBirthDate: vi.fn(async () => worker),
      updateWorkerContactGender: vi.fn(
        async (workerId: string, gender: string, genderNota: string | null) => {
          if (workerId !== worker.id) throw new Error("Unexpected worker");
          contact.gender = gender;
          contact.genderNota = genderNota;
          contact.genderCalc =
            gender === "gender-nota" ? genderNota : "Selected designation";
          return worker;
        },
      ),
    },
    contacts: {
      getContact: vi.fn(async () => contact),
    },
    workerRelations: {
      searchWorkerRelations: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: "relation-new" })),
    },
    workerTrustElections: {
      checkDualCoverage: vi.fn(async () => []),
    },
  };
  return { storage, worker, contact };
}

function makeAddContext(storage: any, input: Record<string, unknown>) {
  return {
    wizardId: "wizard-1",
    wizard: {
      id: "wizard-1",
      status: "draft",
      data: { workerId: "subscriber-1", dependents: [], pendingDocument: null },
    },
    input,
    storage,
  } as any;
}

const addInput = {
  action: "add",
  ssn: "123-45-6789",
  birthDate: "1990-02-03",
  given: "Jordan",
  family: "Example",
  relationTypeId: "spouse",
  documentFileId: "document-1",
};

describe("enrollment dependent gender", () => {
  it("allows a new dependent to be added without a gender designation", async () => {
    const { storage } = makeStorage();
    const result = await handleDependentsSubmit(
      makeAddContext(storage, addInput),
      "first_time_enrollment",
    );

    expect(storage.workers.updateWorkerContactGender).not.toHaveBeenCalled();
    expect((result.data?.dependents as any[])[0]).toMatchObject({
      workerId: "dependent-new",
      genderCalc: null,
    });
    expect((result.data?.dependents as any[])[0]).not.toHaveProperty("gender");
    expect((result.data?.dependents as any[])[0]).not.toHaveProperty("genderNota");
  });

  it("saves a selected gender on a newly created dependent contact", async () => {
    const { storage, contact } = makeStorage();
    const result = await handleDependentsSubmit(
      makeAddContext(storage, { ...addInput, gender: "gender-female" }),
      "first_time_enrollment",
    );

    expect(storage.workers.updateWorkerContactGender).toHaveBeenCalledWith(
      "dependent-new",
      "gender-female",
      null,
    );
    expect(contact.gender).toBe("gender-female");
    expect((result.data?.dependents as any[])[0].genderCalc).toBe(
      "Selected designation",
    );
  });

  it("preserves an existing matched dependent's gender when the field is blank", async () => {
    const { storage } = makeStorage({
      matched: true,
      initialContact: existingContact,
    });
    const result = await handleDependentsSubmit(
      makeAddContext(storage, { ...addInput, given: undefined, family: undefined }),
      "open_enrollment_enrollment",
    );

    expect(storage.workers.updateWorkerContactGender).not.toHaveBeenCalled();
    expect((result.data?.dependents as any[])[0]).toMatchObject({
      matchedExisting: true,
      genderCalc: "Existing designation",
    });
  });

  it("passes specified text to contact storage for the Specify Gender option", async () => {
    const { storage, contact } = makeStorage();
    const result = await handleDependentsSubmit(
      makeAddContext(storage, {
        ...addInput,
        gender: "gender-nota",
        genderNota: "Nonbinary",
      }),
      "life_event_enrollment",
    );

    expect(storage.workers.updateWorkerContactGender).toHaveBeenCalledWith(
      "dependent-new",
      "gender-nota",
      "Nonbinary",
    );
    expect(contact.genderNota).toBe("Nonbinary");
    expect((result.data?.dependents as any[])[0].genderCalc).toBe("Nonbinary");
  });

  it("requires the note option's existing contact-storage validation", async () => {
    const { storage } = makeStorage();
    storage.workers.updateWorkerContactGender.mockRejectedValue(
      new Error("Gender specification is required for this option"),
    );
    await expect(
      handleDependentsSubmit(
        makeAddContext(storage, { ...addInput, gender: "gender-nota" }),
        "life_event_enrollment",
      ),
    ).rejects.toThrow("Gender specification is required for this option");
    expect(storage.workerRelations.create).not.toHaveBeenCalled();
  });

  it("updates only relationships verified on the wizard's active election", async () => {
    const contact = { ...existingContact };
    const sourceElection = {
      id: "election-1",
      workerId: "subscriber-1",
      relationshipIds: ["relation-1"],
      relationships: [
        {
          id: "relation-1",
          label: "Jordan Example",
          coveredWorkerId: "dependent-1",
        },
      ],
    };
    const storage: any = {
      workerTrustElections: {
        getViewById: vi.fn(async () => sourceElection),
        getActiveViewByWorker: vi.fn(async () => sourceElection),
      },
      workers: {
        getWorker: vi.fn(async () => ({ id: "dependent-1", contactId: contact.id })),
        updateWorkerContactGender: vi.fn(async (_id, gender, genderNota) => {
          contact.gender = gender;
          contact.genderNota = genderNota;
          contact.genderCalc = "Updated designation";
        }),
      },
      contacts: { getContact: vi.fn(async () => contact) },
    };
    const step = lifeEventEnrollmentPlugin.steps.find(
      (entry) => entry.id === "dependents",
    )!;
    const ctx: any = {
      wizardId: "wizard-1",
      wizard: {
        id: "wizard-1",
        status: "draft",
        data: {
          workerId: "subscriber-1",
          sourceElectionId: "election-1",
          eventType: "divorce",
          eventAction: "remove",
          currentRelationshipIds: ["relation-1"],
          currentRelationships: [
            { relationId: "relation-1", label: "Jordan Example" },
          ],
          dependents: [],
        },
      },
      input: {
        action: "setCurrentGender",
        relationId: "relation-1",
        gender: "gender-female",
      },
      storage,
    };

    const result = await step.submit!(ctx);
    expect(storage.workers.updateWorkerContactGender).toHaveBeenCalledWith(
      "dependent-1",
      "gender-female",
      null,
    );
    expect(result.data?.currentRelationships).toMatchObject([
      { relationId: "relation-1", genderCalc: "Updated designation" },
    ]);

    storage.workers.updateWorkerContactGender.mockClear();
    storage.workerTrustElections.getActiveViewByWorker.mockResolvedValue({
      ...sourceElection,
      id: "election-2",
    });
    await expect(step.submit!(ctx)).rejects.toThrow(
      "That relationship is no longer on the current election",
    );
    expect(storage.workers.updateWorkerContactGender).not.toHaveBeenCalled();

    await expect(
      step.submit!({
        ...ctx,
        input: { ...ctx.input, relationId: "not-current" },
      }),
    ).rejects.toThrow("That relationship is not on the current election");
  });
});
