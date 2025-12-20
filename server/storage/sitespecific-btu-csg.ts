import { db } from "../db";
import { sql } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "./utils";

export interface BtuCsgRecord {
  id: string;
  bpsId: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  nonBpsEmail: string | null;
  school: string | null;
  principalHeadmaster: string | null;
  role: string | null;
  typeOfClass: string | null;
  course: string | null;
  section: string | null;
  numberOfStudents: string | null;
  comments: string | null;
  status: string;
  adminNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsertBtuCsgRecord {
  bpsId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  nonBpsEmail?: string | null;
  school?: string | null;
  principalHeadmaster?: string | null;
  role?: string | null;
  typeOfClass?: string | null;
  course?: string | null;
  section?: string | null;
  numberOfStudents?: string | null;
  comments?: string | null;
  status?: string;
  adminNotes?: string | null;
}

function mapRowToRecord(row: any): BtuCsgRecord {
  return {
    id: row.id,
    bpsId: row.bps_id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    nonBpsEmail: row.non_bps_email,
    school: row.school,
    principalHeadmaster: row.principal_headmaster,
    role: row.role,
    typeOfClass: row.type_of_class,
    course: row.course,
    section: row.section,
    numberOfStudents: row.number_of_students,
    comments: row.comments,
    status: row.status,
    adminNotes: row.admin_notes,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export interface BtuCsgStorage {
  getAll(): Promise<BtuCsgRecord[]>;
  get(id: string): Promise<BtuCsgRecord | undefined>;
  create(record: InsertBtuCsgRecord): Promise<BtuCsgRecord>;
  update(id: string, record: Partial<InsertBtuCsgRecord>): Promise<BtuCsgRecord | undefined>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

export function createBtuCsgStorage(): BtuCsgStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil("sitespecific_btu_csg");
    },

    async getAll(): Promise<BtuCsgRecord[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const result = await db.execute(sql`
        SELECT * FROM sitespecific_btu_csg ORDER BY created_at DESC
      `);
      return result.rows.map(mapRowToRecord);
    },

    async get(id: string): Promise<BtuCsgRecord | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const result = await db.execute(sql`
        SELECT * FROM sitespecific_btu_csg WHERE id = ${id}
      `);
      if (result.rows.length === 0) return undefined;
      return mapRowToRecord(result.rows[0]);
    },

    async create(record: InsertBtuCsgRecord): Promise<BtuCsgRecord> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const result = await db.execute(sql`
        INSERT INTO sitespecific_btu_csg (
          bps_id, first_name, last_name, phone, non_bps_email,
          school, principal_headmaster, role, type_of_class,
          course, section, number_of_students, comments, status, admin_notes
        ) VALUES (
          ${record.bpsId ?? null},
          ${record.firstName ?? null},
          ${record.lastName ?? null},
          ${record.phone ?? null},
          ${record.nonBpsEmail ?? null},
          ${record.school ?? null},
          ${record.principalHeadmaster ?? null},
          ${record.role ?? null},
          ${record.typeOfClass ?? null},
          ${record.course ?? null},
          ${record.section ?? null},
          ${record.numberOfStudents ?? null},
          ${record.comments ?? null},
          ${record.status ?? 'pending'},
          ${record.adminNotes ?? null}
        ) RETURNING *
      `);
      return mapRowToRecord(result.rows[0]);
    },

    async update(id: string, record: Partial<InsertBtuCsgRecord>): Promise<BtuCsgRecord | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const setClauses: string[] = [];
      const values: any[] = [];
      
      if (record.bpsId !== undefined) { setClauses.push('bps_id = $' + (values.push(record.bpsId))); }
      if (record.firstName !== undefined) { setClauses.push('first_name = $' + (values.push(record.firstName))); }
      if (record.lastName !== undefined) { setClauses.push('last_name = $' + (values.push(record.lastName))); }
      if (record.phone !== undefined) { setClauses.push('phone = $' + (values.push(record.phone))); }
      if (record.nonBpsEmail !== undefined) { setClauses.push('non_bps_email = $' + (values.push(record.nonBpsEmail))); }
      if (record.school !== undefined) { setClauses.push('school = $' + (values.push(record.school))); }
      if (record.principalHeadmaster !== undefined) { setClauses.push('principal_headmaster = $' + (values.push(record.principalHeadmaster))); }
      if (record.role !== undefined) { setClauses.push('role = $' + (values.push(record.role))); }
      if (record.typeOfClass !== undefined) { setClauses.push('type_of_class = $' + (values.push(record.typeOfClass))); }
      if (record.course !== undefined) { setClauses.push('course = $' + (values.push(record.course))); }
      if (record.section !== undefined) { setClauses.push('section = $' + (values.push(record.section))); }
      if (record.numberOfStudents !== undefined) { setClauses.push('number_of_students = $' + (values.push(record.numberOfStudents))); }
      if (record.comments !== undefined) { setClauses.push('comments = $' + (values.push(record.comments))); }
      if (record.status !== undefined) { setClauses.push('status = $' + (values.push(record.status))); }
      if (record.adminNotes !== undefined) { setClauses.push('admin_notes = $' + (values.push(record.adminNotes))); }
      
      setClauses.push('updated_at = NOW()');
      
      if (setClauses.length === 1) {
        return this.get(id);
      }

      const result = await db.execute(sql.raw(`
        UPDATE sitespecific_btu_csg 
        SET ${setClauses.join(', ')}
        WHERE id = '${id}'
        RETURNING *
      `));
      
      if (result.rows.length === 0) return undefined;
      return mapRowToRecord(result.rows[0]);
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const result = await db.execute(sql`
        DELETE FROM sitespecific_btu_csg WHERE id = ${id} RETURNING id
      `);
      return result.rows.length > 0;
    },
  };
}
