import { db } from "../db";
import { workerStewardAssignments, employers, bargainingUnits, workers, contacts, type WorkerStewardAssignment, type InsertWorkerStewardAssignment } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface WorkerStewardAssignmentWithDetails extends WorkerStewardAssignment {
  employer?: { id: string; name: string };
  bargainingUnit?: { id: string; name: string };
}

export interface StewardByEmployerDetails {
  id: string;
  workerId: string;
  employerId: string;
  bargainingUnitId: string;
  worker: {
    id: string;
    contactId: string;
  };
  bargainingUnit: {
    id: string;
    name: string;
  };
  contact: {
    id: string;
    displayName: string;
    email: string | null;
    primaryPhoneNumber: string | null;
  };
}

export interface StewardAssignmentListItem extends WorkerStewardAssignment {
  employer?: { id: string; name: string };
  bargainingUnit?: { id: string; name: string };
  worker?: { id: string; displayName: string };
}

export interface WorkerStewardAssignmentStorage {
  getAssignmentsByWorkerId(workerId: string): Promise<WorkerStewardAssignmentWithDetails[]>;
  getAssignmentsByEmployerId(employerId: string): Promise<WorkerStewardAssignment[]>;
  getAssignmentById(id: string): Promise<WorkerStewardAssignment | undefined>;
  getAllAssignments(): Promise<StewardAssignmentListItem[]>;
  createAssignment(data: InsertWorkerStewardAssignment): Promise<WorkerStewardAssignment>;
  updateAssignment(id: string, data: Partial<InsertWorkerStewardAssignment>): Promise<WorkerStewardAssignment | undefined>;
  deleteAssignment(id: string): Promise<boolean>;
  findExistingAssignment(workerId: string, employerId: string, bargainingUnitId: string): Promise<WorkerStewardAssignment | undefined>;
}

export function createWorkerStewardAssignmentStorage(): WorkerStewardAssignmentStorage {
  const storage: WorkerStewardAssignmentStorage = {
    async getAssignmentsByWorkerId(workerId: string): Promise<WorkerStewardAssignmentWithDetails[]> {
      const assignments = await db
        .select({
          assignment: workerStewardAssignments,
          employer: {
            id: employers.id,
            name: employers.name,
          },
          bargainingUnit: {
            id: bargainingUnits.id,
            name: bargainingUnits.name,
          },
        })
        .from(workerStewardAssignments)
        .leftJoin(employers, eq(workerStewardAssignments.employerId, employers.id))
        .leftJoin(bargainingUnits, eq(workerStewardAssignments.bargainingUnitId, bargainingUnits.id))
        .where(eq(workerStewardAssignments.workerId, workerId));

      return assignments.map(row => ({
        ...row.assignment,
        employer: row.employer || undefined,
        bargainingUnit: row.bargainingUnit || undefined,
      }));
    },

    async getAssignmentsByEmployerId(employerId: string): Promise<WorkerStewardAssignment[]> {
      return await db
        .select()
        .from(workerStewardAssignments)
        .where(eq(workerStewardAssignments.employerId, employerId));
    },

    async getAssignmentById(id: string): Promise<WorkerStewardAssignment | undefined> {
      const [assignment] = await db
        .select()
        .from(workerStewardAssignments)
        .where(eq(workerStewardAssignments.id, id));
      return assignment || undefined;
    },

    async getAllAssignments(): Promise<StewardAssignmentListItem[]> {
      const assignments = await db
        .select({
          assignment: workerStewardAssignments,
          employer: {
            id: employers.id,
            name: employers.name,
          },
          bargainingUnit: {
            id: bargainingUnits.id,
            name: bargainingUnits.name,
          },
          worker: {
            id: workers.id,
          },
          contact: {
            displayName: contacts.displayName,
          },
        })
        .from(workerStewardAssignments)
        .leftJoin(employers, eq(workerStewardAssignments.employerId, employers.id))
        .leftJoin(bargainingUnits, eq(workerStewardAssignments.bargainingUnitId, bargainingUnits.id))
        .leftJoin(workers, eq(workerStewardAssignments.workerId, workers.id))
        .leftJoin(contacts, eq(workers.contactId, contacts.id));

      return assignments.map(row => ({
        ...row.assignment,
        employer: row.employer || undefined,
        bargainingUnit: row.bargainingUnit || undefined,
        worker: row.worker && row.contact ? {
          id: row.worker.id,
          displayName: row.contact.displayName,
        } : undefined,
      }));
    },

    async createAssignment(data: InsertWorkerStewardAssignment): Promise<WorkerStewardAssignment> {
      const [assignment] = await db
        .insert(workerStewardAssignments)
        .values(data)
        .returning();
      return assignment;
    },

    async updateAssignment(id: string, data: Partial<InsertWorkerStewardAssignment>): Promise<WorkerStewardAssignment | undefined> {
      const [updated] = await db
        .update(workerStewardAssignments)
        .set(data)
        .where(eq(workerStewardAssignments.id, id))
        .returning();
      return updated || undefined;
    },

    async deleteAssignment(id: string): Promise<boolean> {
      const result = await db
        .delete(workerStewardAssignments)
        .where(eq(workerStewardAssignments.id, id))
        .returning();
      return result.length > 0;
    },

    async findExistingAssignment(workerId: string, employerId: string, bargainingUnitId: string): Promise<WorkerStewardAssignment | undefined> {
      const [assignment] = await db
        .select()
        .from(workerStewardAssignments)
        .where(and(
          eq(workerStewardAssignments.workerId, workerId),
          eq(workerStewardAssignments.employerId, employerId),
          eq(workerStewardAssignments.bargainingUnitId, bargainingUnitId)
        ));
      return assignment || undefined;
    },
  };

  return storage;
}

interface StewardAssemblyDependencies {
  workers: { getWorker(id: string): Promise<{ id: string; contactId: string } | undefined> };
  contacts: {
    getContact(id: string): Promise<{ id: string; displayName: string; email: string | null } | undefined>;
    phoneNumbers: {
      getPhoneNumbersByContact(contactId: string): Promise<{ phoneNumber: string; isPrimary: boolean }[]>;
    };
  };
  bargainingUnits: { getBargainingUnitById(id: string): Promise<{ id: string; name: string } | undefined> };
  workerStewardAssignments: { getAssignmentsByEmployerId(employerId: string): Promise<WorkerStewardAssignment[]> };
}

export interface WorkerRepresentativeDetails {
  id: string;
  workerId: string;
  employerId: string;
  bargainingUnitId: string;
  employer: {
    id: string;
    name: string;
  };
  bargainingUnit: {
    id: string;
    name: string;
  };
  steward: {
    id: string;
    contactId: string;
    displayName: string;
    email: string | null;
    primaryPhoneNumber: string | null;
  };
  matchesWorkerBargainingUnit: boolean;
}

interface RepresentativeAssemblyDependencies {
  workers: { getWorker(id: string): Promise<{ id: string; contactId: string; bargainingUnitId: string | null } | undefined> };
  contacts: {
    getContact(id: string): Promise<{ id: string; displayName: string; email: string | null } | undefined>;
    phoneNumbers: {
      getPhoneNumbersByContact(contactId: string): Promise<{ phoneNumber: string; isPrimary: boolean }[]>;
    };
  };
  employers: { getEmployer(id: string): Promise<{ id: string; name: string } | undefined> };
  bargainingUnits: { getBargainingUnitById(id: string): Promise<{ id: string; name: string } | undefined> };
  workerHours: { getWorkerHoursCurrent(workerId: string): Promise<{ employerId: string; employmentStatus: { employed: boolean } }[]> };
  workerStewardAssignments: { getAssignmentsByEmployerId(employerId: string): Promise<WorkerStewardAssignment[]> };
}

export async function assembleWorkerRepresentatives(
  storage: RepresentativeAssemblyDependencies,
  workerId: string
): Promise<WorkerRepresentativeDetails[]> {
  const worker = await storage.workers.getWorker(workerId);
  if (!worker) {
    return [];
  }

  const currentEmployment = await storage.workerHours.getWorkerHoursCurrent(workerId);
  const activeEmployerIds = currentEmployment
    .filter(e => e.employmentStatus?.employed)
    .map(e => e.employerId);

  if (activeEmployerIds.length === 0) {
    return [];
  }

  const assignmentsByEmployer = await Promise.all(
    activeEmployerIds.map(employerId => storage.workerStewardAssignments.getAssignmentsByEmployerId(employerId))
  );

  const allAssignments = assignmentsByEmployer.flat();
  if (allAssignments.length === 0) {
    return [];
  }

  const stewardWorkerIds = [...new Set(allAssignments.map(a => a.workerId))];
  const employerIds = [...new Set(allAssignments.map(a => a.employerId))];
  const bargainingUnitIds = [...new Set(allAssignments.map(a => a.bargainingUnitId))];

  const [stewardWorkersData, employersData, bargainingUnitsData] = await Promise.all([
    Promise.all(stewardWorkerIds.map(id => storage.workers.getWorker(id))),
    Promise.all(employerIds.map(id => storage.employers.getEmployer(id))),
    Promise.all(bargainingUnitIds.map(id => storage.bargainingUnits.getBargainingUnitById(id))),
  ]);

  const stewardWorkerMap = new Map(stewardWorkersData.filter(Boolean).map(w => [w!.id, w!]));
  const employerMap = new Map(employersData.filter(Boolean).map(e => [e!.id, e!]));
  const bargainingUnitMap = new Map(bargainingUnitsData.filter(Boolean).map(bu => [bu!.id, bu!]));

  const contactIds = [...new Set([...stewardWorkerMap.values()].map(w => w.contactId))];
  
  const [contactsData, phoneNumbersData] = await Promise.all([
    Promise.all(contactIds.map(id => storage.contacts.getContact(id))),
    Promise.all(contactIds.map(id => storage.contacts.phoneNumbers.getPhoneNumbersByContact(id))),
  ]);

  const contactMap = new Map(contactsData.filter(Boolean).map(c => [c!.id, c!]));
  const phoneNumberMap = new Map(contactIds.map((id, idx) => {
    const phones = phoneNumbersData[idx];
    const primary = phones.find(p => p.isPrimary);
    return [id, primary?.phoneNumber || null];
  }));

  const results: WorkerRepresentativeDetails[] = [];

  for (const assignment of allAssignments) {
    const stewardWorker = stewardWorkerMap.get(assignment.workerId);
    if (!stewardWorker) {
      console.warn(`[worker-representatives] Steward assignment ${assignment.id} references missing worker ${assignment.workerId}, skipping`);
      continue;
    }

    const contact = contactMap.get(stewardWorker.contactId);
    if (!contact) {
      console.warn(`[worker-representatives] Steward worker ${stewardWorker.id} references missing contact ${stewardWorker.contactId}, skipping`);
      continue;
    }

    const employer = employerMap.get(assignment.employerId);
    if (!employer) {
      console.warn(`[worker-representatives] Assignment ${assignment.id} references missing employer ${assignment.employerId}, skipping`);
      continue;
    }

    const bargainingUnit = bargainingUnitMap.get(assignment.bargainingUnitId);
    const primaryPhoneNumber = phoneNumberMap.get(stewardWorker.contactId) || null;

    results.push({
      id: assignment.id,
      workerId: assignment.workerId,
      employerId: assignment.employerId,
      bargainingUnitId: assignment.bargainingUnitId,
      employer: { id: employer.id, name: employer.name },
      bargainingUnit: bargainingUnit 
        ? { id: bargainingUnit.id, name: bargainingUnit.name }
        : { id: assignment.bargainingUnitId, name: "Unknown" },
      steward: {
        id: stewardWorker.id,
        contactId: stewardWorker.contactId,
        displayName: contact.displayName,
        email: contact.email,
        primaryPhoneNumber,
      },
      matchesWorkerBargainingUnit: worker.bargainingUnitId === assignment.bargainingUnitId,
    });
  }

  return results;
}

export async function assembleEmployerStewardDetails(
  storage: StewardAssemblyDependencies,
  employerId: string
): Promise<StewardByEmployerDetails[]> {
  const assignments = await storage.workerStewardAssignments.getAssignmentsByEmployerId(employerId);
  
  if (assignments.length === 0) {
    return [];
  }

  const workerIds = [...new Set(assignments.map(a => a.workerId))];
  const bargainingUnitIds = [...new Set(assignments.map(a => a.bargainingUnitId))];

  const [workersData, bargainingUnitsData] = await Promise.all([
    Promise.all(workerIds.map(id => storage.workers.getWorker(id))),
    Promise.all(bargainingUnitIds.map(id => storage.bargainingUnits.getBargainingUnitById(id))),
  ]);

  const workerMap = new Map(workersData.filter(Boolean).map(w => [w!.id, w!]));
  const bargainingUnitMap = new Map(bargainingUnitsData.filter(Boolean).map(bu => [bu!.id, bu!]));

  const contactIds = [...new Set([...workerMap.values()].map(w => w.contactId))];
  
  const [contactsData, phoneNumbersData] = await Promise.all([
    Promise.all(contactIds.map(id => storage.contacts.getContact(id))),
    Promise.all(contactIds.map(id => storage.contacts.phoneNumbers.getPhoneNumbersByContact(id))),
  ]);

  const contactMap = new Map(contactsData.filter(Boolean).map(c => [c!.id, c!]));
  const phoneNumberMap = new Map(contactIds.map((id, idx) => {
    const phones = phoneNumbersData[idx];
    const primary = phones.find(p => p.isPrimary);
    return [id, primary?.phoneNumber || null];
  }));

  const results: StewardByEmployerDetails[] = [];

  for (const assignment of assignments) {
    const worker = workerMap.get(assignment.workerId);
    if (!worker) {
      console.warn(`[worker-steward-assignments] Steward assignment ${assignment.id} references missing worker ${assignment.workerId}, skipping`);
      continue;
    }

    const contact = contactMap.get(worker.contactId);
    if (!contact) {
      console.warn(`[worker-steward-assignments] Worker ${worker.id} references missing contact ${worker.contactId}, skipping steward assignment ${assignment.id}`);
      continue;
    }

    const bargainingUnit = bargainingUnitMap.get(assignment.bargainingUnitId);
    const primaryPhoneNumber = phoneNumberMap.get(worker.contactId) || null;

    results.push({
      id: assignment.id,
      workerId: assignment.workerId,
      employerId: assignment.employerId,
      bargainingUnitId: assignment.bargainingUnitId,
      worker: { id: worker.id, contactId: worker.contactId },
      bargainingUnit: bargainingUnit 
        ? { id: bargainingUnit.id, name: bargainingUnit.name } 
        : { id: assignment.bargainingUnitId, name: "Unknown" },
      contact: { 
        id: contact.id, 
        displayName: contact.displayName, 
        email: contact.email, 
        primaryPhoneNumber 
      },
    });
  }

  return results;
}
