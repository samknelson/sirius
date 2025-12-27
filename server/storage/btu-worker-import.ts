import { db } from "../db";
import {
  workers,
  workerIds,
  workerHours,
  contacts,
  employers,
  bargainingUnits,
  optionsWorkerIdType,
  optionsEmploymentStatus,
  type Worker,
  type Contact,
  type WorkerId,
  type WorkerHours,
} from "@shared/schema";
import { sitespecificBtuEmployerMap } from "@shared/schema/sitespecific/btu/schema";
import { eq, and, sql, inArray, not } from "drizzle-orm";
import { storage } from "./index";

const BPS_EMPLOYEE_ID_TYPE_NAME = "BPS Employee ID";

export interface EmployerInfo {
  employerId: string;
  employerName: string;
}

export interface EmployerMappingResult {
  primaryEmployer: EmployerInfo;
  secondaryEmployer: EmployerInfo | null;
  bargainingUnitId: string | null;
}

export interface BtuWorkerImportStorage {
  ensureBpsEmployeeIdType(): Promise<{ id: string; name: string }>;
  findWorkerByBpsEmployeeId(bpsEmployeeId: string): Promise<Worker | undefined>;
  findEmployerMapping(deptId: string, locationId: string, jobCode: string): Promise<EmployerMappingResult | null>;
  createWorkerWithContact(data: {
    firstName: string;
    lastName: string;
    middleName?: string;
    email?: string;
    phone?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
    bpsEmployeeId: string;
    bargainingUnitId?: string;
  }): Promise<Worker>;
  updateWorkerContact(workerId: string, data: {
    firstName?: string;
    lastName?: string;
    middleName?: string;
    email?: string;
    phone?: string;
  }): Promise<void>;
  upsertEmploymentRecord(workerId: string, data: {
    employerId: string;
    isPrimary: boolean;
    asOfDate: string;
    bargainingUnitId?: string;
  }): Promise<WorkerHours>;
  getActiveEmploymentsForBargainingUnit(bargainingUnitId: string, asOfDate: Date): Promise<Array<{
    workerId: string;
    employerId: string;
    employmentStatusCode: string;
    isHome: boolean;
  }>>;
  terminateEmployment(data: {
    workerId: string;
    employerId: string;
    asOfDate: Date;
  }): Promise<WorkerHours>;
  terminateWorkersNotInList(bpsEmployeeIds: string[], asOfDate: string, employerIds: string[]): Promise<number>;
  getEmploymentStatusByCode(code: string): Promise<{ id: string; name: string; code: string } | undefined>;
  getEmployerByName(name: string): Promise<{ id: string; name: string } | undefined>;
}

export function createBtuWorkerImportStorage(): BtuWorkerImportStorage {
  return {
    async ensureBpsEmployeeIdType(): Promise<{ id: string; name: string }> {
      const existingTypes = await storage.options.workerIdTypes.getAllWorkerIdTypes();
      const existingType = existingTypes.find(t => t.name === BPS_EMPLOYEE_ID_TYPE_NAME);
      
      if (existingType) {
        return { id: existingType.id, name: existingType.name };
      }
      
      const newType = await storage.options.workerIdTypes.createWorkerIdType({
        name: BPS_EMPLOYEE_ID_TYPE_NAME,
        sequence: 0,
      });
      
      return { id: newType.id, name: newType.name };
    },

    async findWorkerByBpsEmployeeId(bpsEmployeeId: string): Promise<Worker | undefined> {
      const bpsIdType = await this.ensureBpsEmployeeIdType();
      
      const [result] = await db
        .select({ worker: workers })
        .from(workerIds)
        .innerJoin(workers, eq(workerIds.workerId, workers.id))
        .where(
          and(
            eq(workerIds.typeId, bpsIdType.id),
            eq(workerIds.value, bpsEmployeeId.trim())
          )
        );
      
      return result?.worker;
    },

    async findEmployerMapping(deptId: string, locationId: string, jobCode: string): Promise<EmployerMappingResult | null> {
      const trimmedDept = deptId.trim();
      const trimmedLoc = locationId.trim();
      const trimmedJob = jobCode.trim();
      
      console.log(`[BTU Import] Looking up mapping: Dept="${trimmedDept}", Loc="${trimmedLoc}", Job="${trimmedJob}"`);
      
      // Use raw SQL for debugging
      const rawResults = await db.execute(sql`
        SELECT * FROM sitespecific_btu_employer_map 
        WHERE department_id = ${trimmedDept} 
          AND location_id = ${trimmedLoc} 
          AND job_code = ${trimmedJob}
      `);
      
      console.log(`[BTU Import] Raw SQL result count:`, rawResults.rows?.length);
      
      const [mapping] = await db
        .select()
        .from(sitespecificBtuEmployerMap)
        .where(
          and(
            eq(sitespecificBtuEmployerMap.departmentId, trimmedDept),
            eq(sitespecificBtuEmployerMap.locationId, trimmedLoc),
            eq(sitespecificBtuEmployerMap.jobCode, trimmedJob)
          )
        );
      
      console.log(`[BTU Import] Drizzle result:`, mapping ? `Found ID: ${mapping.id}` : 'NOT FOUND');
      
      if (!mapping) return null;
      
      // Look up primary employer by name
      const [primaryEmployer] = await db
        .select()
        .from(employers)
        .where(eq(employers.name, mapping.employerName || ''));
      
      if (!primaryEmployer) {
        console.warn(`Primary employer not found for name: ${mapping.employerName}`);
        return null;
      }
      
      // Look up secondary employer if specified
      let secondaryEmployer: EmployerInfo | null = null;
      if (mapping.secondaryEmployerName) {
        const [secEmp] = await db
          .select()
          .from(employers)
          .where(eq(employers.name, mapping.secondaryEmployerName));
        
        if (secEmp) {
          secondaryEmployer = {
            employerId: secEmp.id,
            employerName: secEmp.name,
          };
        } else {
          console.warn(`Secondary employer not found for name: ${mapping.secondaryEmployerName}`);
        }
      }
      
      return {
        primaryEmployer: {
          employerId: primaryEmployer.id,
          employerName: primaryEmployer.name,
        },
        secondaryEmployer,
        bargainingUnitId: mapping.bargainingUnitId || null,
      };
    },

    async createWorkerWithContact(data: {
      firstName: string;
      lastName: string;
      middleName?: string;
      email?: string;
      phone?: string;
      address1?: string;
      address2?: string;
      city?: string;
      state?: string;
      zip?: string;
      bpsEmployeeId: string;
      bargainingUnitId?: string;
    }): Promise<Worker> {
      const bpsIdType = await this.ensureBpsEmployeeIdType();
      
      const contact = await storage.contacts.createContact({
        displayName: data.middleName 
          ? `${data.lastName}, ${data.firstName} ${data.middleName}`
          : `${data.lastName}, ${data.firstName}`,
        given: data.firstName,
        family: data.lastName,
        middle: data.middleName || null,
        email: data.email || null,
      });
      
      const [worker] = await db
        .insert(workers)
        .values({
          contactId: contact.id,
          bargainingUnitId: data.bargainingUnitId || null,
        })
        .returning();
      
      await db.insert(workerIds).values({
        workerId: worker.id,
        typeId: bpsIdType.id,
        value: data.bpsEmployeeId.trim(),
      });
      
      if (data.phone) {
        await storage.contacts.phoneNumbers.createPhoneNumber({
          contactId: contact.id,
          phoneNumber: data.phone,
          isPrimary: true,
        });
      }
      
      if (data.address1 && data.city && data.state && data.zip) {
        await storage.contacts.addresses.createContactPostal({
          contactId: contact.id,
          street: data.address2 ? `${data.address1}, ${data.address2}` : data.address1,
          city: data.city,
          state: data.state,
          postalCode: data.zip,
          country: 'US',
          isPrimary: true,
        });
      }
      
      return worker;
    },

    async updateWorkerContact(workerId: string, data: {
      firstName?: string;
      lastName?: string;
      middleName?: string;
      email?: string;
      phone?: string;
    }): Promise<void> {
      const [worker] = await db
        .select()
        .from(workers)
        .where(eq(workers.id, workerId));
      
      if (!worker) return;
      
      const updateData: any = {};
      if (data.firstName) updateData.given = data.firstName;
      if (data.lastName) updateData.family = data.lastName;
      if (data.middleName !== undefined) updateData.additional = data.middleName || null;
      if (data.email) updateData.email = data.email;
      
      if (Object.keys(updateData).length > 0) {
        if (data.firstName || data.lastName) {
          const firstName = data.firstName || '';
          const lastName = data.lastName || '';
          const middleName = data.middleName || '';
          updateData.displayName = middleName 
            ? `${lastName}, ${firstName} ${middleName}`
            : `${lastName}, ${firstName}`;
        }
        
        await db
          .update(contacts)
          .set(updateData)
          .where(eq(contacts.id, worker.contactId));
      }
    },

    async getEmploymentStatusByCode(code: string): Promise<{ id: string; name: string; code: string } | undefined> {
      const [status] = await db
        .select()
        .from(optionsEmploymentStatus)
        .where(eq(optionsEmploymentStatus.code, code));
      
      return status ? { id: status.id, name: status.name, code: status.code } : undefined;
    },

    async getEmployerByName(name: string): Promise<{ id: string; name: string } | undefined> {
      const normalizedName = name.trim().toLowerCase();
      
      const allEmployers = await db.select().from(employers);
      const matched = allEmployers.find(e => e.name.trim().toLowerCase() === normalizedName);
      
      return matched ? { id: matched.id, name: matched.name } : undefined;
    },

    async upsertEmploymentRecord(workerId: string, data: {
      employerId: string;
      isPrimary: boolean;
      asOfDate: string;
      bargainingUnitId?: string;
    }): Promise<WorkerHours> {
      const statusCode = data.isPrimary ? 'A' : 'A2';
      const status = await this.getEmploymentStatusByCode(statusCode);
      if (!status) {
        throw new Error(`Employment status not found for code: ${statusCode}`);
      }
      
      const asOfDate = new Date(data.asOfDate);
      const year = asOfDate.getFullYear();
      const month = asOfDate.getMonth() + 1;
      
      if (data.bargainingUnitId) {
        await db
          .update(workers)
          .set({ bargainingUnitId: data.bargainingUnitId })
          .where(eq(workers.id, workerId));
      }
      
      const result = await storage.workerHours.upsertWorkerHours({
        workerId,
        employerId: data.employerId,
        employmentStatusId: status.id,
        year,
        month,
        hours: null,
        home: data.isPrimary,
      });
      
      return result.data;
    },

    async getActiveEmploymentsForBargainingUnit(bargainingUnitId: string, asOfDate: Date): Promise<Array<{
      workerId: string;
      employerId: string;
      employmentStatusCode: string;
      isHome: boolean;
    }>> {
      const year = asOfDate.getFullYear();
      const month = asOfDate.getMonth() + 1;
      
      const activeStatus = await this.getEmploymentStatusByCode('A');
      const activeSecondaryStatus = await this.getEmploymentStatusByCode('A2');
      
      if (!activeStatus && !activeSecondaryStatus) {
        return [];
      }
      
      const statusIds = [activeStatus?.id, activeSecondaryStatus?.id].filter(Boolean) as string[];
      
      const results = await db
        .select({
          workerId: workerHours.workerId,
          employerId: workerHours.employerId,
          employmentStatusId: workerHours.employmentStatusId,
          home: workerHours.home,
          statusCode: optionsEmploymentStatus.code,
        })
        .from(workerHours)
        .innerJoin(workers, eq(workerHours.workerId, workers.id))
        .innerJoin(optionsEmploymentStatus, eq(workerHours.employmentStatusId, optionsEmploymentStatus.id))
        .where(
          and(
            eq(workers.bargainingUnitId, bargainingUnitId),
            eq(workerHours.year, year),
            eq(workerHours.month, month),
            inArray(workerHours.employmentStatusId, statusIds)
          )
        );
      
      return results.map(r => ({
        workerId: r.workerId,
        employerId: r.employerId,
        employmentStatusCode: r.statusCode,
        isHome: r.home,
      }));
    },

    async terminateEmployment(data: {
      workerId: string;
      employerId: string;
      asOfDate: Date;
    }): Promise<WorkerHours> {
      const terminatedStatus = await this.getEmploymentStatusByCode('t');
      if (!terminatedStatus) {
        throw new Error('Terminated employment status not found');
      }
      
      const year = data.asOfDate.getFullYear();
      const month = data.asOfDate.getMonth() + 1;
      
      const result = await storage.workerHours.upsertWorkerHours({
        workerId: data.workerId,
        employerId: data.employerId,
        employmentStatusId: terminatedStatus.id,
        year,
        month,
        hours: null,
        home: false,
      });
      
      return result.data;
    },

    async terminateWorkersNotInList(bpsEmployeeIds: string[], asOfDate: string, employerIds: string[]): Promise<number> {
      if (bpsEmployeeIds.length === 0 || employerIds.length === 0) return 0;
      
      const bpsIdType = await this.ensureBpsEmployeeIdType();
      const date = new Date(asOfDate);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      
      const activeStatus = await this.getEmploymentStatusByCode('A');
      const activeSecondaryStatus = await this.getEmploymentStatusByCode('A2');
      
      if (!activeStatus && !activeSecondaryStatus) return 0;
      
      const statusIds = [activeStatus?.id, activeSecondaryStatus?.id].filter(Boolean) as string[];
      
      const activeEmployments = await db
        .select({
          workerId: workerHours.workerId,
          employerId: workerHours.employerId,
          bpsId: workerIds.value,
        })
        .from(workerHours)
        .innerJoin(workerIds, and(
          eq(workerHours.workerId, workerIds.workerId),
          eq(workerIds.typeId, bpsIdType.id)
        ))
        .where(
          and(
            eq(workerHours.year, year),
            eq(workerHours.month, month),
            inArray(workerHours.employmentStatusId, statusIds),
            inArray(workerHours.employerId, employerIds),
            not(inArray(workerIds.value, bpsEmployeeIds))
          )
        );
      
      let terminatedCount = 0;
      for (const emp of activeEmployments) {
        try {
          await this.terminateEmployment({
            workerId: emp.workerId,
            employerId: emp.employerId,
            asOfDate: date,
          });
          terminatedCount++;
        } catch (err) {
          console.error(`Failed to terminate employment for worker ${emp.workerId}:`, err);
        }
      }
      
      return terminatedCount;
    },
  };
}
