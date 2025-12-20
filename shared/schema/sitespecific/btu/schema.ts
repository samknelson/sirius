import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const BTU_CSG_TABLE_NAME = "sitespecific_btu_csg";

export const BTU_CSG_CREATE_SQL = `
CREATE TABLE IF NOT EXISTS ${BTU_CSG_TABLE_NAME} (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  bps_id TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  non_bps_email TEXT,
  school TEXT,
  principal_headmaster TEXT,
  role TEXT,
  type_of_class TEXT,
  course TEXT,
  section TEXT,
  number_of_students TEXT,
  comments TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_${BTU_CSG_TABLE_NAME}_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_${BTU_CSG_TABLE_NAME}_updated_at ON ${BTU_CSG_TABLE_NAME};
CREATE TRIGGER trigger_update_${BTU_CSG_TABLE_NAME}_updated_at
  BEFORE UPDATE ON ${BTU_CSG_TABLE_NAME}
  FOR EACH ROW
  EXECUTE FUNCTION update_${BTU_CSG_TABLE_NAME}_updated_at();
`;

export const BTU_CSG_DROP_SQL = `
DROP TRIGGER IF EXISTS trigger_update_${BTU_CSG_TABLE_NAME}_updated_at ON ${BTU_CSG_TABLE_NAME};
DROP FUNCTION IF EXISTS update_${BTU_CSG_TABLE_NAME}_updated_at();
DROP TABLE IF EXISTS ${BTU_CSG_TABLE_NAME};
`;

export const sitespecificBtuCsg = pgTable(BTU_CSG_TABLE_NAME, {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bpsId: text("bps_id"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  nonBpsEmail: text("non_bps_email"),
  school: text("school"),
  principalHeadmaster: text("principal_headmaster"),
  role: text("role"),
  typeOfClass: text("type_of_class"),
  course: text("course"),
  section: text("section"),
  numberOfStudents: text("number_of_students"),
  comments: text("comments"),
  status: text("status").default("pending").notNull(),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBtuCsgSchema = createInsertSchema(sitespecificBtuCsg).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BtuCsgRecord = typeof sitespecificBtuCsg.$inferSelect;
export type InsertBtuCsgRecord = z.infer<typeof insertBtuCsgSchema>;
