import { getAccessStorage } from "../../../services/access-policy-evaluator";
import { isComponentEnabledSync } from "../../../services/component-cache";
import type { DashboardPlugin } from "../types";

export const myShopsPlugin: DashboardPlugin = {
  id: "my-shops",
  name: "My Shops",
  description:
    "Display employers the current user is a contact for, with latest GBHET legal wizard and ledger balances",

  async content(ctx) {
    const dbUser = ctx.dbUser;

    const accessStorage = getAccessStorage();
    if (!accessStorage) {
      throw Object.assign(new Error("Access storage not initialized"), { status: 500 });
    }
    const hasEmployerPerm = await accessStorage.hasPermission(dbUser.id, "employer");
    if (!hasEmployerPerm) {
      throw Object.assign(new Error("Access denied"), { status: 403 });
    }

    if (!dbUser.email) {
      return [];
    }

    const contact = await ctx.storage.contacts.getContactByEmail(dbUser.email);
    if (!contact) {
      return [];
    }

    const employerContactRecords = await ctx.storage.employerContacts.listByContactId(contact.id);
    const employerIds = Array.from(new Set(employerContactRecords.map((ec) => ec.employerId)));
    if (employerIds.length === 0) {
      return [];
    }

    const employersList = await Promise.all(
      employerIds.map((id) => ctx.storage.employers.getEmployer(id)),
    );
    const activeEmployers = employersList.filter(
      (emp): emp is NonNullable<typeof emp> => emp !== null && emp !== undefined,
    );
    if (activeEmployers.length === 0) {
      return [];
    }

    const activeIds = activeEmployers.map((e) => e.id);
    const gbhetLegalTypes = ["gbhet_legal_workers_monthly", "gbhet_legal_workers_corrections"];

    const latestWizards = await ctx.storage.wizardEmployerMonthly.getLatestCompletedByEmployers(
      activeIds,
      gbhetLegalTypes,
    );

    const latestByEmployer = new Map<string, (typeof latestWizards)[0]>();
    for (const row of latestWizards) {
      latestByEmployer.set(row.employerId, row);
    }

    const ledgerEnabled = isComponentEnabledSync("ledger");
    let eaRows: Array<{
      eaId: string;
      entityId: string;
      accountId: string;
      accountName: string | null;
    }> = [];
    let balanceMap = new Map<string, string>();

    if (ledgerEnabled) {
      eaRows = await ctx.storage.ledger.ea.getByEntityIdsWithAccount("employer", activeIds);
      const eaIds = eaRows.map((r) => r.eaId);
      balanceMap = await ctx.storage.ledger.entries.getBalancesByEaIds(eaIds);
    }

    return activeEmployers.map((emp) => {
      const latestWiz = latestByEmployer.get(emp.id);
      const empEaRows = eaRows.filter((r) => r.entityId === emp.id);
      return {
        employerId: emp.id,
        employerName: emp.name,
        latestWizard: latestWiz
          ? {
              type: latestWiz.wizardType,
              year: latestWiz.year,
              month: latestWiz.month,
              completedAt: latestWiz.completedAt?.toISOString() ?? null,
            }
          : null,
        accounts: empEaRows.map((ea) => ({
          accountId: ea.accountId,
          accountName: ea.accountName ?? "Account",
          balance: balanceMap.get(ea.eaId) ?? "0.00",
        })),
      };
    });
  },
};
