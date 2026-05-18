import type { DashboardPlugin } from "../types";

export const myStewardPlugin: DashboardPlugin = {
  id: "my-steward",
  name: "My Steward",
  description: "Display stewards assigned to your home employer and bargaining unit",
  requiredComponent: "worker.steward",

  async content(ctx) {
    const dbUser = ctx.dbUser;
    if (!dbUser.email) {
      return { stewards: [], worker: null };
    }

    const worker = await ctx.storage.workers.getWorkerByContactEmail(dbUser.email);
    if (!worker) {
      return { stewards: [], worker: null };
    }

    const employer = worker.denormHomeEmployerId
      ? await ctx.storage.employers.getEmployer(worker.denormHomeEmployerId)
      : null;
    const bargainingUnit = worker.bargainingUnitId
      ? await ctx.storage.bargainingUnits.getBargainingUnitById(worker.bargainingUnitId)
      : null;

    if (!worker.denormHomeEmployerId || !worker.bargainingUnitId) {
      return {
        stewards: [],
        worker: { id: worker.id },
        employer: employer ? { id: employer.id, name: employer.name } : null,
        bargainingUnit: bargainingUnit
          ? { id: bargainingUnit.id, name: bargainingUnit.name }
          : null,
      };
    }

    const assignments =
      await ctx.storage.workerStewardAssignments.getStewardsByEmployerAndBargainingUnit(
        worker.denormHomeEmployerId,
        worker.bargainingUnitId,
      );

    const stewardsWithPhones = await Promise.all(
      assignments.map(async (steward) => {
        const stewardWorker = await ctx.storage.workers.getWorker(steward.workerId);
        if (!stewardWorker) return steward;
        const phoneNumbers = await ctx.storage.contacts.phoneNumbers.getPhoneNumbersByContact(
          stewardWorker.contactId,
        );
        const primaryPhone =
          phoneNumbers.find((p) => p.isPrimary)?.phoneNumber ||
          phoneNumbers[0]?.phoneNumber ||
          null;
        return { ...steward, phone: primaryPhone };
      }),
    );

    return {
      stewards: stewardsWithPhones,
      worker: { id: worker.id },
      employer: employer ? { id: employer.id, name: employer.name } : null,
      bargainingUnit: bargainingUnit
        ? { id: bargainingUnit.id, name: bargainingUnit.name }
        : null,
    };
  },

  client: {
    component: "my-steward:MySteward",
    order: 7,
  },
};
