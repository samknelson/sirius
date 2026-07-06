import { getClient, runInTransaction } from "../transaction-context";
import {
  grievances,
  grievanceWorkers,
  grievanceEmployers,
  grievanceUsers,
  grievanceComplaints,
  grievanceRemedies,
  optionsGrievanceStatus,
  optionsGrievanceCategory,
  optionsGrievanceComplaints,
  optionsGrievanceRemedies,
  optionsGrievanceRoles,
  grievanceNameDenorm,
  workers,
  contacts,
  employers,
  users,
  denorm,
  bargainingUnits,
  type Grievance,
  type InsertGrievance,
  type GrievanceWorker,
  type GrievanceEmployer,
  type GrievanceUser,
  type GrievanceComplaint,
  type GrievanceRemedy,
} from "@shared/schema";
import { eq, and, ne, inArray, asc, isNull, sql } from "drizzle-orm";
import { generateGrievanceSiriusId } from "./sirius-id-generator";
import { grievantSummary, type GrievantSummaryWorker } from "./grievant-summary";
import { type StorageLoggingConfig } from "../middleware/logging";
import { onAfterCommit } from "../transaction-context";
import { eventBus, EventType } from "../../services/event-bus";

/**
 * Emit the grievance-saved event once the surrounding transaction (if any)
 * commits, so the `grievance_name_denorm` denorm plugin recomputes the display
 * name from committed data. Best-effort: a failed emit never fails the write.
 */
function emitGrievanceSaved(grievanceId: string): void {
  onAfterCommit(() => {
    void eventBus.emit(EventType.GRIEVANCE_SAVED, { grievanceId });
  });
}

/**
 * Emit the grievance-assignment-saved event once the surrounding transaction
 * (if any) commits, so the grievance-assignment event-notifier plugin can fan a
 * notification out to the affected user. Best-effort: a failed emit never fails
 * the write.
 */
function emitGrievanceAssignmentSaved(
  grievanceId: string,
  userId: string,
  roleId: string,
  operation: "created" | "updated" | "deleted",
): void {
  onAfterCommit(() => {
    void eventBus.emit(EventType.GRIEVANCE_ASSIGNMENT_SAVED, {
      grievanceId,
      userId,
      roleId,
      operation,
    });
  });
}

export interface GrievanceListItem extends Grievance {
  statusName: string | null;
  categoryName: string | null;
  workerCount: number;
  employerCount: number;
  grievantSummary: string;
  employerName: string | null;
}

export interface GrievanceLinkedWorker {
  workerId: string;
  siriusId: number | null;
  displayName: string | null;
  primary: boolean;
}

export interface GrievanceLinkedEmployer {
  employerId: string;
  name: string;
}

export interface GrievanceWorkerName {
  given: string | null;
  family: string | null;
  displayName: string | null;
  primary: boolean;
}

export interface GrievanceLinkedUser {
  id: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roleId: string;
  roleName: string | null;
}

export interface GrievanceComplaintWithDetails extends GrievanceComplaint {
  complaintName: string | null;
}

export interface GrievanceRemedyWithDetails extends GrievanceRemedy {
  remedyName: string | null;
}

export interface GrievanceWithDetails extends Grievance {
  statusName: string | null;
  categoryName: string | null;
  bargainingUnitName: string | null;
  /** Denormalized display name from `grievance_name_denorm`; null if not yet computed. */
  name: string | null;
  workers: GrievanceLinkedWorker[];
  employers: GrievanceLinkedEmployer[];
  users: GrievanceLinkedUser[];
  complaints: GrievanceComplaintWithDetails[];
  remedies: GrievanceRemedyWithDetails[];
}

export interface GrievanceSearchFilters {
  workerId?: string;
  employerId?: string;
}

export interface GrievanceStorage {
  search(filters?: GrievanceSearchFilters): Promise<GrievanceListItem[]>;
  get(id: string): Promise<(Grievance & { name: string | null }) | undefined>;
  getWithDetails(id: string): Promise<GrievanceWithDetails | undefined>;
  create(data: InsertGrievance): Promise<Grievance>;
  update(id: string, data: Partial<InsertGrievance>): Promise<Grievance | undefined>;
  delete(id: string): Promise<boolean>;
  listWorkers(grievanceId: string): Promise<GrievanceLinkedWorker[]>;
  addWorkerForGrievance(
    grievanceId: string,
    workerId: string,
  ): Promise<
    | { worker: GrievanceWorker }
    | { error: "not-found" | "class" | "individual-full" }
  >;
  updateWorker(
    grievanceId: string,
    workerId: string,
    data: { primary?: boolean },
  ): Promise<GrievanceWorker | undefined>;
  removeWorker(grievanceId: string, workerId: string): Promise<boolean>;
  getWorkerStats(grievanceId: string): Promise<{ count: number; primaryCount: number }>;
  listEmployers(grievanceId: string): Promise<GrievanceLinkedEmployer[]>;
  addEmployer(grievanceId: string, employerId: string): Promise<GrievanceEmployer>;
  removeEmployer(grievanceId: string, employerId: string): Promise<boolean>;
  listUsers(grievanceId: string): Promise<GrievanceLinkedUser[]>;
  addUser(
    grievanceId: string,
    data: { userId: string; roleId: string; data?: unknown },
  ): Promise<GrievanceUser>;
  updateUser(
    grievanceId: string,
    rowId: string,
    data: { roleId?: string; data?: unknown },
  ): Promise<GrievanceUser | undefined>;
  removeUser(grievanceId: string, rowId: string): Promise<boolean>;
  /** A single grievance-user assignment row, scoped to its grievance. */
  getUserAssignment(
    grievanceId: string,
    rowId: string,
  ): Promise<{ id: string; userId: string; roleId: string } | undefined>;
  /** Whether the supplied grievance role option id currently exists. */
  roleOptionExists(id: string): Promise<boolean>;
  /**
   * The parts needed to compose a grievance's display title (denorm name and
   * category name) for notifications. Undefined if the grievance is gone.
   */
  getAssignmentTitleInfo(
    grievanceId: string,
  ): Promise<
    { id: string; name: string | null; categoryName: string | null } | undefined
  >;
  /**
   * The system role ids a user must hold (any one of) to be assignable to
   * the given grievance role. Empty array = no restriction.
   */
  rolePermittedSystemRoleIds(roleId: string): Promise<string[]>;
  /** Whether the supplied user id currently exists. */
  userExists(id: string): Promise<boolean>;
  listComplaints(grievanceId: string): Promise<GrievanceComplaintWithDetails[]>;
  addComplaint(
    grievanceId: string,
    data: { complaintId?: string | null; description: string },
  ): Promise<GrievanceComplaint>;
  updateComplaint(
    grievanceId: string,
    rowId: string,
    data: { complaintId?: string | null; description?: string; sequence?: number },
  ): Promise<GrievanceComplaint | undefined>;
  removeComplaint(grievanceId: string, rowId: string): Promise<boolean>;
  listRemedies(grievanceId: string): Promise<GrievanceRemedyWithDetails[]>;
  addRemedy(
    grievanceId: string,
    data: { remedyId?: string | null; description: string },
  ): Promise<GrievanceRemedy>;
  updateRemedy(
    grievanceId: string,
    rowId: string,
    data: { remedyId?: string | null; description?: string; sequence?: number },
  ): Promise<GrievanceRemedy | undefined>;
  removeRemedy(grievanceId: string, rowId: string): Promise<boolean>;
  /** Whether the supplied complaint option id currently exists. */
  complaintOptionExists(id: string): Promise<boolean>;
  /** Whether the supplied remedy option id currently exists. */
  remedyOptionExists(id: string): Promise<boolean>;
  getLogLabel(id: string): Promise<string | undefined>;
  /**
   * Grievance ids that SHOULD have a denorm row for `configId` but don't yet
   * (read-only anti-join). Backfill source for the `grievance_name_denorm`
   * plugin.
   */
  findIdsMissingDenorm(configId: string, limit: number): Promise<string[]>;
  /**
   * Grievance-scoped denorm entity ids whose grievance no longer exists
   * (read-only anti-join). Widow source for the `grievance_name_denorm` plugin.
   */
  findDenormWidowIds(configId: string, limit: number): Promise<string[]>;
  /**
   * The linked workers' name parts for a grievance, used to build the
   * denormalized grievance name. Returns given/family/displayName and whether
   * each worker is the lead (primary).
   */
  getWorkersForName(grievanceId: string): Promise<GrievanceWorkerName[]>;
}

export function createGrievanceStorage(): GrievanceStorage {
  return {
    async search(filters: GrievanceSearchFilters = {}): Promise<GrievanceListItem[]> {
      const client = getClient();

      const conditions = [];
      if (filters.workerId) {
        conditions.push(
          inArray(
            grievances.id,
            client
              .select({ grievanceId: grievanceWorkers.grievanceId })
              .from(grievanceWorkers)
              .where(eq(grievanceWorkers.workerId, filters.workerId)),
          ),
        );
      }
      if (filters.employerId) {
        conditions.push(
          inArray(
            grievances.id,
            client
              .select({ grievanceId: grievanceEmployers.grievanceId })
              .from(grievanceEmployers)
              .where(eq(grievanceEmployers.employerId, filters.employerId)),
          ),
        );
      }

      const baseQuery = client
        .select({
          id: grievances.id,
          siriusId: grievances.siriusId,
          classDescription: grievances.classDescription,
          cardinality: grievances.cardinality,
          statusId: grievances.statusId,
          categoryId: grievances.categoryId,
          data: grievances.data,
          timelineTemplateId: grievances.timelineTemplateId,
          bargainingUnitId: grievances.bargainingUnitId,
          statusName: optionsGrievanceStatus.name,
          categoryName: optionsGrievanceCategory.name,
        })
        .from(grievances)
        .leftJoin(optionsGrievanceStatus, eq(grievances.statusId, optionsGrievanceStatus.id))
        .leftJoin(optionsGrievanceCategory, eq(grievances.categoryId, optionsGrievanceCategory.id));

      const rows =
        conditions.length > 0 ? await baseQuery.where(and(...conditions)) : await baseQuery;

      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const workerLinks = await client
        .select({
          grievanceId: grievanceWorkers.grievanceId,
          given: contacts.given,
          family: contacts.family,
          displayName: contacts.displayName,
          primary: grievanceWorkers.primary,
        })
        .from(grievanceWorkers)
        .innerJoin(workers, eq(grievanceWorkers.workerId, workers.id))
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(inArray(grievanceWorkers.grievanceId, ids))
        .orderBy(asc(contacts.displayName));
      const employerLinks = await client
        .select({
          grievanceId: grievanceEmployers.grievanceId,
          name: employers.name,
        })
        .from(grievanceEmployers)
        .innerJoin(employers, eq(grievanceEmployers.employerId, employers.id))
        .where(inArray(grievanceEmployers.grievanceId, ids))
        .orderBy(asc(employers.name));

      const workersByGrievance = new Map<string, GrievantSummaryWorker[]>();
      for (const l of workerLinks) {
        const arr = workersByGrievance.get(l.grievanceId) ?? [];
        arr.push({
          given: l.given,
          family: l.family,
          displayName: l.displayName,
          primary: l.primary,
        });
        workersByGrievance.set(l.grievanceId, arr);
      }
      const employersByGrievance = new Map<string, string[]>();
      for (const l of employerLinks) {
        const arr = employersByGrievance.get(l.grievanceId) ?? [];
        arr.push(l.name);
        employersByGrievance.set(l.grievanceId, arr);
      }

      return rows.map((r) => {
        const gWorkers = workersByGrievance.get(r.id) ?? [];
        const gEmployers = employersByGrievance.get(r.id) ?? [];
        const employerName =
          gEmployers.length === 0
            ? null
            : gEmployers.length === 1
              ? gEmployers[0]
              : `${gEmployers[0]} (+${gEmployers.length - 1})`;
        return {
          ...r,
          workerCount: gWorkers.length,
          employerCount: gEmployers.length,
          grievantSummary: grievantSummary(r.cardinality, gWorkers, r.classDescription),
          employerName,
        };
      });
    },

    async get(id: string): Promise<(Grievance & { name: string | null }) | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          id: grievances.id,
          siriusId: grievances.siriusId,
          classDescription: grievances.classDescription,
          cardinality: grievances.cardinality,
          statusId: grievances.statusId,
          categoryId: grievances.categoryId,
          data: grievances.data,
          timelineTemplateId: grievances.timelineTemplateId,
          bargainingUnitId: grievances.bargainingUnitId,
          name: grievanceNameDenorm.name,
        })
        .from(grievances)
        .leftJoin(grievanceNameDenorm, eq(grievanceNameDenorm.grievanceId, grievances.id))
        .where(eq(grievances.id, id));
      return row || undefined;
    },

    async getWithDetails(id: string): Promise<GrievanceWithDetails | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          id: grievances.id,
          siriusId: grievances.siriusId,
          classDescription: grievances.classDescription,
          cardinality: grievances.cardinality,
          statusId: grievances.statusId,
          categoryId: grievances.categoryId,
          data: grievances.data,
          timelineTemplateId: grievances.timelineTemplateId,
          bargainingUnitId: grievances.bargainingUnitId,
          employerContactId: grievances.employerContactId,
          statusName: optionsGrievanceStatus.name,
          categoryName: optionsGrievanceCategory.name,
          bargainingUnitName: bargainingUnits.name,
          name: grievanceNameDenorm.name,
        })
        .from(grievances)
        .leftJoin(optionsGrievanceStatus, eq(grievances.statusId, optionsGrievanceStatus.id))
        .leftJoin(optionsGrievanceCategory, eq(grievances.categoryId, optionsGrievanceCategory.id))
        .leftJoin(bargainingUnits, eq(grievances.bargainingUnitId, bargainingUnits.id))
        .leftJoin(grievanceNameDenorm, eq(grievanceNameDenorm.grievanceId, grievances.id))
        .where(eq(grievances.id, id));

      if (!row) return undefined;

      const linkedWorkers = await this.listWorkers(id);
      const linkedEmployers = await this.listEmployers(id);
      const linkedUsers = await this.listUsers(id);
      const complaints = await this.listComplaints(id);
      const remedies = await this.listRemedies(id);

      return {
        ...row,
        workers: linkedWorkers,
        employers: linkedEmployers,
        users: linkedUsers,
        complaints,
        remedies,
      };
    },

    async create(data: InsertGrievance): Promise<Grievance> {
      return runInTransaction(async () => {
        const client = getClient();
        const siriusId =
          data.siriusId == null || data.siriusId === ""
            ? await generateGrievanceSiriusId()
            : data.siriusId;
        const [row] = await client
          .insert(grievances)
          .values({ ...data, siriusId })
          .returning();
        emitGrievanceSaved(row.id);
        return row;
      });
    },

    async update(id: string, data: Partial<InsertGrievance>): Promise<Grievance | undefined> {
      return runInTransaction(async () => {
        const client = getClient();
        const { siriusId: rawSiriusId, ...restData } = data;
        const values: Partial<typeof grievances.$inferInsert> = { ...restData };

        const providedId =
          typeof rawSiriusId === "string" ? rawSiriusId.trim() : rawSiriusId;

        if (typeof providedId === "string" && providedId !== "") {
          // Explicit non-empty ID (admin override) — use it as given.
          values.siriusId = providedId;
        } else {
          // No usable ID was supplied. Fill one in only when the grievance would
          // otherwise be left without an ID; never overwrite an existing one and
          // never blank one out (a grievance is never left ID-less after a save).
          const [existing] = await client
            .select({ siriusId: grievances.siriusId })
            .from(grievances)
            .where(eq(grievances.id, id))
            .limit(1);

          if (existing && (existing.siriusId == null || existing.siriusId === "")) {
            values.siriusId = await generateGrievanceSiriusId();
          }
          // Otherwise (row missing, or it already has an ID the caller didn't
          // change): leave siriusId out entirely so the stored ID is untouched.
        }

        const [row] = await client
          .update(grievances)
          .set(values)
          .where(eq(grievances.id, id))
          .returning();
        if (row) emitGrievanceSaved(row.id);
        return row || undefined;
      });
    },

    async delete(id: string): Promise<boolean> {
      return runInTransaction(async () => {
        const client = getClient();
        await client.delete(grievanceWorkers).where(eq(grievanceWorkers.grievanceId, id));
        await client.delete(grievanceEmployers).where(eq(grievanceEmployers.grievanceId, id));
        await client.delete(grievanceUsers).where(eq(grievanceUsers.grievanceId, id));
        const result = await client.delete(grievances).where(eq(grievances.id, id)).returning();
        return result.length > 0;
      });
    },

    async listWorkers(grievanceId: string): Promise<GrievanceLinkedWorker[]> {
      const client = getClient();
      return client
        .select({
          workerId: grievanceWorkers.workerId,
          siriusId: workers.siriusId,
          displayName: contacts.displayName,
          primary: grievanceWorkers.primary,
        })
        .from(grievanceWorkers)
        .innerJoin(workers, eq(grievanceWorkers.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(grievanceWorkers.grievanceId, grievanceId))
        .orderBy(asc(contacts.displayName));
    },

    async addWorkerForGrievance(
      grievanceId: string,
      workerId: string,
    ): Promise<
      | { worker: GrievanceWorker }
      | { error: "not-found" | "class" | "individual-full" }
    > {
      // Lock the grievance row so concurrent adds are serialized. This is what
      // makes the "individual grievance has at most one worker" rule hold
      // without a dedicated DB constraint: the count check and the insert run
      // inside one transaction that owns the grievance row.
      return runInTransaction(async () => {
        const client = getClient();
        const [grievance] = await client
          .select({ cardinality: grievances.cardinality })
          .from(grievances)
          .where(eq(grievances.id, grievanceId))
          .for("update");
        if (!grievance) {
          return { error: "not-found" as const };
        }
        if (grievance.cardinality === "class") {
          return { error: "class" as const };
        }

        let primary = false;
        if (grievance.cardinality === "individual") {
          const existing = await client
            .select({ workerId: grievanceWorkers.workerId })
            .from(grievanceWorkers)
            .where(eq(grievanceWorkers.grievanceId, grievanceId));
          if (existing.length >= 1) {
            return { error: "individual-full" as const };
          }
          // The single worker on an individual grievance is implicitly the lead.
          primary = true;
        }

        const [row] = await client
          .insert(grievanceWorkers)
          .values({ grievanceId, workerId, primary })
          .returning();
        emitGrievanceSaved(grievanceId);
        return { worker: row };
      });
    },

    async updateWorker(
      grievanceId: string,
      workerId: string,
      data: { primary?: boolean },
    ): Promise<GrievanceWorker | undefined> {
      return runInTransaction(async () => {
        const client = getClient();
        if (data.primary === true) {
          // Demote any existing lead so the one-primary-per-grievance index holds.
          await client
            .update(grievanceWorkers)
            .set({ primary: false })
            .where(
              and(
                eq(grievanceWorkers.grievanceId, grievanceId),
                ne(grievanceWorkers.workerId, workerId),
              ),
            );
        }
        const [row] = await client
          .update(grievanceWorkers)
          .set(data)
          .where(
            and(
              eq(grievanceWorkers.grievanceId, grievanceId),
              eq(grievanceWorkers.workerId, workerId),
            ),
          )
          .returning();
        if (row) emitGrievanceSaved(grievanceId);
        return row || undefined;
      });
    },

    async removeWorker(grievanceId: string, workerId: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(grievanceWorkers)
        .where(and(eq(grievanceWorkers.grievanceId, grievanceId), eq(grievanceWorkers.workerId, workerId)))
        .returning();
      if (result.length > 0) emitGrievanceSaved(grievanceId);
      return result.length > 0;
    },

    async getWorkerStats(grievanceId: string): Promise<{ count: number; primaryCount: number }> {
      const client = getClient();
      const rows = await client
        .select({ primary: grievanceWorkers.primary })
        .from(grievanceWorkers)
        .where(eq(grievanceWorkers.grievanceId, grievanceId));
      return {
        count: rows.length,
        primaryCount: rows.filter((r) => r.primary).length,
      };
    },

    async listEmployers(grievanceId: string): Promise<GrievanceLinkedEmployer[]> {
      const client = getClient();
      return client
        .select({
          employerId: grievanceEmployers.employerId,
          name: employers.name,
        })
        .from(grievanceEmployers)
        .innerJoin(employers, eq(grievanceEmployers.employerId, employers.id))
        .where(eq(grievanceEmployers.grievanceId, grievanceId))
        .orderBy(asc(employers.name));
    },

    async addEmployer(grievanceId: string, employerId: string): Promise<GrievanceEmployer> {
      const client = getClient();
      const [row] = await client
        .insert(grievanceEmployers)
        .values({ grievanceId, employerId })
        .returning();
      emitGrievanceSaved(grievanceId);
      return row;
    },

    async removeEmployer(grievanceId: string, employerId: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(grievanceEmployers)
        .where(and(eq(grievanceEmployers.grievanceId, grievanceId), eq(grievanceEmployers.employerId, employerId)))
        .returning();
      if (result.length > 0) emitGrievanceSaved(grievanceId);
      return result.length > 0;
    },

    async listUsers(grievanceId: string): Promise<GrievanceLinkedUser[]> {
      const client = getClient();
      return client
        .select({
          id: grievanceUsers.id,
          userId: grievanceUsers.userId,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          roleId: grievanceUsers.roleId,
          roleName: optionsGrievanceRoles.name,
        })
        .from(grievanceUsers)
        .innerJoin(users, eq(grievanceUsers.userId, users.id))
        .leftJoin(optionsGrievanceRoles, eq(grievanceUsers.roleId, optionsGrievanceRoles.id))
        .where(eq(grievanceUsers.grievanceId, grievanceId))
        .orderBy(asc(optionsGrievanceRoles.sequence), asc(users.email));
    },

    async addUser(
      grievanceId: string,
      data: { userId: string; roleId: string; data?: unknown },
    ): Promise<GrievanceUser> {
      const client = getClient();
      const [row] = await client
        .insert(grievanceUsers)
        .values({
          grievanceId,
          userId: data.userId,
          roleId: data.roleId,
          data: data.data ?? null,
        })
        .returning();
      emitGrievanceAssignmentSaved(grievanceId, row.userId, row.roleId, "created");
      return row;
    },

    async updateUser(
      grievanceId: string,
      rowId: string,
      data: { roleId?: string; data?: unknown },
    ): Promise<GrievanceUser | undefined> {
      const client = getClient();
      const existing = await this.getUserAssignment(grievanceId, rowId);
      const updates: Partial<typeof grievanceUsers.$inferInsert> = {};
      if (data.roleId !== undefined) updates.roleId = data.roleId;
      if (data.data !== undefined) updates.data = data.data;
      const [row] = await client
        .update(grievanceUsers)
        .set(updates)
        .where(
          and(
            eq(grievanceUsers.id, rowId),
            eq(grievanceUsers.grievanceId, grievanceId),
          ),
        )
        .returning();
      // Only notify when the assignment's role actually changed; edits that
      // touch only the free-form `data` payload are not a role change.
      if (row && existing && row.roleId !== existing.roleId) {
        emitGrievanceAssignmentSaved(grievanceId, row.userId, row.roleId, "updated");
      }
      return row || undefined;
    },

    async removeUser(grievanceId: string, rowId: string): Promise<boolean> {
      const client = getClient();
      // Capture the userId/roleId before the row is gone so the removal can be
      // notified to the affected user.
      const existing = await this.getUserAssignment(grievanceId, rowId);
      const result = await client
        .delete(grievanceUsers)
        .where(
          and(
            eq(grievanceUsers.id, rowId),
            eq(grievanceUsers.grievanceId, grievanceId),
          ),
        )
        .returning();
      if (result.length > 0 && existing) {
        emitGrievanceAssignmentSaved(
          grievanceId,
          existing.userId,
          existing.roleId,
          "deleted",
        );
      }
      return result.length > 0;
    },

    async getUserAssignment(
      grievanceId: string,
      rowId: string,
    ): Promise<{ id: string; userId: string; roleId: string } | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          id: grievanceUsers.id,
          userId: grievanceUsers.userId,
          roleId: grievanceUsers.roleId,
        })
        .from(grievanceUsers)
        .where(
          and(
            eq(grievanceUsers.id, rowId),
            eq(grievanceUsers.grievanceId, grievanceId),
          ),
        );
      return row || undefined;
    },

    async roleOptionExists(id: string): Promise<boolean> {
      const client = getClient();
      const [row] = await client
        .select({ id: optionsGrievanceRoles.id })
        .from(optionsGrievanceRoles)
        .where(eq(optionsGrievanceRoles.id, id));
      return !!row;
    },

    async getAssignmentTitleInfo(
      grievanceId: string,
    ): Promise<
      { id: string; name: string | null; categoryName: string | null } | undefined
    > {
      const client = getClient();
      const [row] = await client
        .select({
          id: grievances.id,
          name: grievanceNameDenorm.name,
          categoryName: optionsGrievanceCategory.name,
        })
        .from(grievances)
        .leftJoin(
          optionsGrievanceCategory,
          eq(grievances.categoryId, optionsGrievanceCategory.id),
        )
        .leftJoin(
          grievanceNameDenorm,
          eq(grievanceNameDenorm.grievanceId, grievances.id),
        )
        .where(eq(grievances.id, grievanceId));
      return row || undefined;
    },

    async rolePermittedSystemRoleIds(roleId: string): Promise<string[]> {
      const client = getClient();
      const [row] = await client
        .select({ data: optionsGrievanceRoles.data })
        .from(optionsGrievanceRoles)
        .where(eq(optionsGrievanceRoles.id, roleId));
      const ids = (row?.data as { permittedSystemRoleIds?: unknown } | null)
        ?.permittedSystemRoleIds;
      return Array.isArray(ids)
        ? ids.filter((x): x is string => typeof x === "string")
        : [];
    },

    async userExists(id: string): Promise<boolean> {
      const client = getClient();
      const [row] = await client
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id));
      return !!row;
    },

    async listComplaints(grievanceId: string): Promise<GrievanceComplaintWithDetails[]> {
      const client = getClient();
      return client
        .select({
          id: grievanceComplaints.id,
          grievanceId: grievanceComplaints.grievanceId,
          complaintId: grievanceComplaints.complaintId,
          description: grievanceComplaints.description,
          sequence: grievanceComplaints.sequence,
          complaintName: optionsGrievanceComplaints.name,
        })
        .from(grievanceComplaints)
        .leftJoin(
          optionsGrievanceComplaints,
          eq(grievanceComplaints.complaintId, optionsGrievanceComplaints.id),
        )
        .where(eq(grievanceComplaints.grievanceId, grievanceId))
        .orderBy(asc(grievanceComplaints.sequence), asc(grievanceComplaints.id));
    },

    async addComplaint(
      grievanceId: string,
      data: { complaintId?: string | null; description: string },
    ): Promise<GrievanceComplaint> {
      const client = getClient();
      // New lines append to the end of the grievance's complaint list.
      const [maxRow] = await client
        .select({
          max: sql<number>`COALESCE(MAX(${grievanceComplaints.sequence}), -1)`,
        })
        .from(grievanceComplaints)
        .where(eq(grievanceComplaints.grievanceId, grievanceId));
      const sequence = Number(maxRow?.max ?? -1) + 1;
      const [row] = await client
        .insert(grievanceComplaints)
        .values({
          grievanceId,
          complaintId: data.complaintId ?? null,
          description: data.description,
          sequence,
        })
        .returning();
      return row;
    },

    async updateComplaint(
      grievanceId: string,
      rowId: string,
      data: { complaintId?: string | null; description?: string; sequence?: number },
    ): Promise<GrievanceComplaint | undefined> {
      const set: Record<string, unknown> = {};
      if (data.complaintId !== undefined) set.complaintId = data.complaintId ?? null;
      if (data.description !== undefined) set.description = data.description;

      // When the sequence changes, swap it atomically with whatever line
      // currently holds the target sequence, mirroring the timeline-template
      // step reorder model: a single PATCH can move a line Up/Down without
      // ever leaving two lines sharing a sequence.
      if (data.sequence !== undefined && data.sequence !== null) {
        const targetSequence = data.sequence;
        set.sequence = targetSequence;
        return runInTransaction(async () => {
          const client = getClient();
          const [existing] = await client
            .select()
            .from(grievanceComplaints)
            .where(
              and(
                eq(grievanceComplaints.id, rowId),
                eq(grievanceComplaints.grievanceId, grievanceId),
              ),
            );
          if (!existing) return undefined;
          if (existing.sequence !== targetSequence) {
            const [conflict] = await client
              .select({ id: grievanceComplaints.id })
              .from(grievanceComplaints)
              .where(
                and(
                  eq(grievanceComplaints.grievanceId, grievanceId),
                  eq(grievanceComplaints.sequence, targetSequence),
                  ne(grievanceComplaints.id, rowId),
                ),
              )
              .orderBy(asc(grievanceComplaints.id))
              .limit(1);
            if (conflict) {
              await client
                .update(grievanceComplaints)
                .set({ sequence: existing.sequence })
                .where(eq(grievanceComplaints.id, conflict.id));
            }
          }
          const [row] = await client
            .update(grievanceComplaints)
            .set(set)
            .where(
              and(
                eq(grievanceComplaints.id, rowId),
                eq(grievanceComplaints.grievanceId, grievanceId),
              ),
            )
            .returning();
          return row || undefined;
        });
      }

      const client = getClient();
      const [row] = await client
        .update(grievanceComplaints)
        .set(set)
        .where(
          and(
            eq(grievanceComplaints.id, rowId),
            eq(grievanceComplaints.grievanceId, grievanceId),
          ),
        )
        .returning();
      return row || undefined;
    },

    async removeComplaint(grievanceId: string, rowId: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(grievanceComplaints)
        .where(
          and(
            eq(grievanceComplaints.id, rowId),
            eq(grievanceComplaints.grievanceId, grievanceId),
          ),
        )
        .returning();
      return result.length > 0;
    },

    async listRemedies(grievanceId: string): Promise<GrievanceRemedyWithDetails[]> {
      const client = getClient();
      return client
        .select({
          id: grievanceRemedies.id,
          grievanceId: grievanceRemedies.grievanceId,
          remedyId: grievanceRemedies.remedyId,
          description: grievanceRemedies.description,
          sequence: grievanceRemedies.sequence,
          remedyName: optionsGrievanceRemedies.name,
        })
        .from(grievanceRemedies)
        .leftJoin(
          optionsGrievanceRemedies,
          eq(grievanceRemedies.remedyId, optionsGrievanceRemedies.id),
        )
        .where(eq(grievanceRemedies.grievanceId, grievanceId))
        .orderBy(asc(grievanceRemedies.sequence), asc(grievanceRemedies.id));
    },

    async addRemedy(
      grievanceId: string,
      data: { remedyId?: string | null; description: string },
    ): Promise<GrievanceRemedy> {
      const client = getClient();
      const [maxRow] = await client
        .select({
          max: sql<number>`COALESCE(MAX(${grievanceRemedies.sequence}), -1)`,
        })
        .from(grievanceRemedies)
        .where(eq(grievanceRemedies.grievanceId, grievanceId));
      const sequence = Number(maxRow?.max ?? -1) + 1;
      const [row] = await client
        .insert(grievanceRemedies)
        .values({
          grievanceId,
          remedyId: data.remedyId ?? null,
          description: data.description,
          sequence,
        })
        .returning();
      return row;
    },

    async updateRemedy(
      grievanceId: string,
      rowId: string,
      data: { remedyId?: string | null; description?: string; sequence?: number },
    ): Promise<GrievanceRemedy | undefined> {
      const set: Record<string, unknown> = {};
      if (data.remedyId !== undefined) set.remedyId = data.remedyId ?? null;
      if (data.description !== undefined) set.description = data.description;

      if (data.sequence !== undefined && data.sequence !== null) {
        const targetSequence = data.sequence;
        set.sequence = targetSequence;
        return runInTransaction(async () => {
          const client = getClient();
          const [existing] = await client
            .select()
            .from(grievanceRemedies)
            .where(
              and(
                eq(grievanceRemedies.id, rowId),
                eq(grievanceRemedies.grievanceId, grievanceId),
              ),
            );
          if (!existing) return undefined;
          if (existing.sequence !== targetSequence) {
            const [conflict] = await client
              .select({ id: grievanceRemedies.id })
              .from(grievanceRemedies)
              .where(
                and(
                  eq(grievanceRemedies.grievanceId, grievanceId),
                  eq(grievanceRemedies.sequence, targetSequence),
                  ne(grievanceRemedies.id, rowId),
                ),
              )
              .orderBy(asc(grievanceRemedies.id))
              .limit(1);
            if (conflict) {
              await client
                .update(grievanceRemedies)
                .set({ sequence: existing.sequence })
                .where(eq(grievanceRemedies.id, conflict.id));
            }
          }
          const [row] = await client
            .update(grievanceRemedies)
            .set(set)
            .where(
              and(
                eq(grievanceRemedies.id, rowId),
                eq(grievanceRemedies.grievanceId, grievanceId),
              ),
            )
            .returning();
          return row || undefined;
        });
      }

      const client = getClient();
      const [row] = await client
        .update(grievanceRemedies)
        .set(set)
        .where(
          and(
            eq(grievanceRemedies.id, rowId),
            eq(grievanceRemedies.grievanceId, grievanceId),
          ),
        )
        .returning();
      return row || undefined;
    },

    async removeRemedy(grievanceId: string, rowId: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(grievanceRemedies)
        .where(
          and(
            eq(grievanceRemedies.id, rowId),
            eq(grievanceRemedies.grievanceId, grievanceId),
          ),
        )
        .returning();
      return result.length > 0;
    },

    async complaintOptionExists(id: string): Promise<boolean> {
      const client = getClient();
      const [row] = await client
        .select({ id: optionsGrievanceComplaints.id })
        .from(optionsGrievanceComplaints)
        .where(eq(optionsGrievanceComplaints.id, id));
      return !!row;
    },

    async remedyOptionExists(id: string): Promise<boolean> {
      const client = getClient();
      const [row] = await client
        .select({ id: optionsGrievanceRemedies.id })
        .from(optionsGrievanceRemedies)
        .where(eq(optionsGrievanceRemedies.id, id));
      return !!row;
    },

    async getLogLabel(id: string): Promise<string | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          categoryName: optionsGrievanceCategory.name,
        })
        .from(grievances)
        .leftJoin(optionsGrievanceCategory, eq(grievances.categoryId, optionsGrievanceCategory.id))
        .where(eq(grievances.id, id));
      if (!row) return undefined;
      return row.categoryName ? `${row.categoryName} grievance` : `grievance ${id.slice(0, 8)}`;
    },

    async findIdsMissingDenorm(configId: string, limit: number): Promise<string[]> {
      const client = getClient();
      const rows = await client
        .select({ id: grievances.id })
        .from(grievances)
        .leftJoin(
          denorm,
          and(eq(denorm.entityId, grievances.id), eq(denorm.configId, configId)),
        )
        .where(isNull(denorm.id))
        .limit(limit);
      return rows.map((r) => r.id);
    },

    async findDenormWidowIds(configId: string, limit: number): Promise<string[]> {
      const client = getClient();
      const rows = await client
        .select({ entityId: denorm.entityId })
        .from(denorm)
        .leftJoin(grievances, eq(grievances.id, denorm.entityId))
        .where(and(eq(denorm.configId, configId), isNull(grievances.id)))
        .limit(limit);
      return rows.map((r) => r.entityId);
    },

    async getWorkersForName(grievanceId: string): Promise<GrievanceWorkerName[]> {
      const client = getClient();
      return client
        .select({
          given: contacts.given,
          family: contacts.family,
          displayName: contacts.displayName,
          primary: grievanceWorkers.primary,
        })
        .from(grievanceWorkers)
        .innerJoin(workers, eq(grievanceWorkers.workerId, workers.id))
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(grievanceWorkers.grievanceId, grievanceId))
        .orderBy(asc(contacts.displayName));
    },
  };
}

async function describeGrievance(
  storage: GrievanceStorage,
  id: string,
): Promise<string> {
  const label = await storage.getLogLabel(id);
  return label ?? `grievance ${id.slice(0, 8)}`;
}

/**
 * Logging configuration for grievance storage operations.
 *
 * Worker / employer link mutations set the host entity to the parent grievance
 * id so they surface in the grievance's Logs tab.
 */
export const grievanceLoggingConfig: StorageLoggingConfig<GrievanceStorage> = {
  module: "grievances",
  methods: {
    create: {
      enabled: true,
      getEntityId: (_args, result) => result?.id,
      getHostEntityId: (_args, result) => result?.id,
      after: async (_args, result) => result,
      getDescription: async (_args, result, _b, _a, storage) => {
        if (!result?.id) return "Created grievance";
        return `Created ${await describeGrievance(storage, result.id)}`;
      },
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => storage.get(args[0]),
      after: async (args, result) => result,
      getDescription: async (args, _result, _b, _a, storage) =>
        `Updated ${await describeGrievance(storage, args[0])}`,
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      before: async (args, storage) => storage.get(args[0]),
      getDescription: async (args, _result, beforeState) => {
        const id = args[0] as string;
        return `Deleted grievance ${typeof id === "string" ? id.slice(0, 8) : id}`;
      },
    },
    addWorkerForGrievance: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Linked worker to grievance`,
    },
    updateWorker: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async () => `Updated worker on grievance`,
    },
    removeWorker: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Unlinked worker from grievance`,
    },
    addEmployer: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async () => `Linked employer to grievance`,
    },
    removeEmployer: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Unlinked employer from grievance`,
    },
    addUser: {
      enabled: true,
      getEntityId: (_args, result) => result?.id,
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async () => `Assigned user to grievance`,
    },
    updateUser: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async () => `Updated user role on grievance`,
    },
    removeUser: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Removed user from grievance`,
    },
    addComplaint: {
      enabled: true,
      getEntityId: (_args, result) => result?.id,
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async () => `Added complaint to grievance`,
    },
    updateComplaint: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async () => `Updated complaint on grievance`,
    },
    removeComplaint: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Removed complaint from grievance`,
    },
    addRemedy: {
      enabled: true,
      getEntityId: (_args, result) => result?.id,
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async () => `Added remedy to grievance`,
    },
    updateRemedy: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      after: async (_args, result) => result,
      getDescription: async () => `Updated remedy on grievance`,
    },
    removeRemedy: {
      enabled: true,
      getEntityId: (args) => args[1],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Removed remedy from grievance`,
    },
  },
};
