import { pgTable, varchar, date, integer, time, jsonb, unique, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { employers, workers, users, optionsDepartment, comm } from "../../schema";
import { dispatchJobGroups } from "../dispatch/job-group-schema";
import { facilities } from "../facility/schema";

export const edlsSheetStatusEnum = ["draft", "request", "lock", "trash", "reserved"] as const;
export type EdlsSheetStatus = typeof edlsSheetStatusEnum[number];

export const optionsEdlsShowStatus = pgTable("options_edls_show_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  siriusId: varchar("sirius_id", { length: 255 }).unique("options_edls_show_status_sirius_id_unique"),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const insertEdlsShowStatusSchema = createInsertSchema(optionsEdlsShowStatus).omit({
  id: true,
});

export type EdlsShowStatus = typeof optionsEdlsShowStatus.$inferSelect;
export type InsertEdlsShowStatus = z.infer<typeof insertEdlsShowStatusSchema>;

export const edlsSheets = pgTable("edls_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  departmentId: varchar("department_id").notNull().references(() => optionsDepartment.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  ymd: date("ymd").notNull(),
  workerCount: integer("worker_count").notNull().default(0),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  supervisor: varchar("supervisor").references(() => users.id, { onDelete: 'set null' }),
  assignee: varchar("assignee").references(() => users.id, { onDelete: 'set null' }),
  jobGroupId: varchar("job_group_id").references(() => dispatchJobGroups.id, { onDelete: 'set null' }),
  facilityId: varchar("facility_id").references(() => facilities.id, { onDelete: 'set null' }),
  showStatusId: varchar("show_status_id").references(() => optionsEdlsShowStatus.id, { onDelete: 'set null' }),
  notes: text("notes"),
  /**
   * Stamped once by the storage layer from the acting user at create time and
   * never rewritten afterwards. Null for sheets written without a request
   * context (background jobs, scripts) and for rows that predate the column.
   */
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
  /**
   * Timestamp of the sheet's most recent save. Refreshed by the storage layer
   * on every create and update, so no caller can forget to set it.
   */
  changed: timestamp("changed").notNull().default(sql`now()`),
  /**
   * Per-sheet opt-in for the worker-facing EDLS notifications. Off unless
   * somebody turns it on for this sheet — including every sheet that already
   * existed when the column was added — so a sheet reaching a notifier's
   * trigger status texts nobody by default. Written only by the dedicated
   * toggle endpoint, never by the general sheet create/update routes.
   */
  notificationsEnabled: boolean("notifications_enabled").notNull().default(false),
  data: jsonb("data"),
});

/**
 * `createdBy` / `changed` are storage-owned outputs: they are omitted here so
 * a request body can never set them (zod strips unknown keys).
 */
export const insertEdlsSheetsSchema = createInsertSchema(edlsSheets).omit({
  id: true,
  createdBy: true,
  changed: true,
}).extend({
  assignee: z.string().nullish(),
  jobGroupId: z.string().nullish(),
  facilityId: z.string().nullish(),
  showStatusId: z.string().nullish(),
});

export type EdlsSheet = typeof edlsSheets.$inferSelect;
export type InsertEdlsSheet = z.infer<typeof insertEdlsSheetsSchema>;

export const edlsCrews = pgTable("edls_crews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sheetId: varchar("sheet_id").notNull().references(() => edlsSheets.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  workerCount: integer("worker_count").notNull(),
  location: varchar("location", { length: 255 }),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  supervisor: varchar("supervisor").references(() => users.id, { onDelete: 'set null' }),
  taskId: varchar("task_id").references(() => optionsEdlsTasks.id, { onDelete: 'set null' }),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export const insertEdlsCrewsSchema = createInsertSchema(edlsCrews).omit({
  id: true,
});

export type EdlsCrew = typeof edlsCrews.$inferSelect;
export type InsertEdlsCrew = z.infer<typeof insertEdlsCrewsSchema>;

export const edlsAssignments = pgTable("edls_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ymd: date("ymd").notNull(),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  crewId: varchar("crew_id").notNull().references(() => edlsCrews.id, { onDelete: 'cascade' }),
  /**
   * RECEIPT for the message telling this worker about their assignment: it
   * means they have been told about the assignment AS IT STOOD when that
   * message went out. Set by whatever sent the message (today the EDLS sheet
   * worker SMS notifier), never from a request body.
   *
   * It is not merely provenance — it GATES SENDING. A worker holding one is
   * not texted again; any change to the assignment's values voids it, so the
   * sheet's next arrival at a trigger status texts exactly the workers whose
   * rows changed. A failed or undelivered message still counts as told: the
   * receipt records that the attempt was made, and a resend is forced by
   * editing the row, not by retrying automatically.
   *
   * Deleting the comm row clears the link rather than removing the
   * assignment, so purging the comm log never destroys scheduling data —
   * though it does hand the worker back to the next send, since the receipt
   * is gone with it.
   */
  commId: varchar("comm_id").references(() => comm.id, { onDelete: 'set null' }),
  /**
   * The WORKER'S OWN ANSWER to this assignment, given from the public
   * schedule page: null means they have not answered yet, true accepted,
   * false declined. Written only by its own storage operation
   * (`setAccepted`), never from a general update or a request body — nobody
   * answers on the worker's behalf, and staff cannot set, change, or clear
   * it.
   *
   * One answer only: the write is conditional on the row still being
   * unanswered, so a stale tab, a double tap, or a replayed request is
   * refused rather than overwriting the first answer.
   *
   * Answering is NOT a change to the assignment, so it leaves the receipt
   * (`commId`) alone — otherwise every acceptance would re-text the worker at
   * the sheet's next notifying transition. The reverse does apply: an edit to
   * the assignment's values voids the receipt AND clears the answer, because
   * the worker has neither been told about the assignment it just became nor
   * agreed to it, and is asked again.
   */
  accepted: boolean("accepted"),
  data: jsonb("data"),
}, (table) => [
  unique("edls_assignments_ymd_worker_id_unique").on(table.ymd, table.workerId),
]);

/**
 * `commId` is omitted: the link to a communication record is provenance owned
 * by whatever sends the message, not assignment input a caller may set. A
 * future writer gets a dedicated storage operation rather than accepting it
 * from a request body.
 *
 * `accepted` is omitted for the same reason from the other side: it is the
 * worker's own answer, set through `setAccepted` alone, so an assignment is
 * always created unanswered.
 */
export const insertEdlsAssignmentsSchema = createInsertSchema(edlsAssignments).omit({
  id: true,
  commId: true,
  accepted: true,
});

export type EdlsAssignment = typeof edlsAssignments.$inferSelect;
export type InsertEdlsAssignment = z.infer<typeof insertEdlsAssignmentsSchema>;

export interface AssignmentExtra {
  startTime?: string | null;
  note?: string | null;
  classificationId?: string | null;
}

export const updateAssignmentExtraSchema = z.object({
  startTime: z.string().nullable().optional(),
  note: z.string().max(35).nullable().optional(),
  classificationId: z.string().nullable().optional(),
});

export type UpdateAssignmentExtra = z.infer<typeof updateAssignmentExtraSchema>;

export const optionsEdlsTasks = pgTable("options_edls_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  siriusId: varchar("sirius_id", { length: 255 }),
  departmentId: varchar("department_id").notNull().references(() => optionsDepartment.id, { onDelete: 'cascade' }),
  data: jsonb("data"),
});

export const insertEdlsTaskSchema = createInsertSchema(optionsEdlsTasks).omit({
  id: true,
});

export type EdlsTask = typeof optionsEdlsTasks.$inferSelect;
export type InsertEdlsTask = z.infer<typeof insertEdlsTaskSchema>;

export const workerEdls = pgTable("worker_edls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().unique().references(() => workers.id, { onDelete: 'cascade' }),
  active: boolean("active").notNull().default(true),
  data: jsonb("data"),
});

export const insertWorkerEdlsSchema = createInsertSchema(workerEdls).omit({
  id: true,
});

export type WorkerEdls = typeof workerEdls.$inferSelect;
export type InsertWorkerEdls = z.infer<typeof insertWorkerEdlsSchema>;
