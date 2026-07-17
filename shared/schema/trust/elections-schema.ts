import { pgTable, varchar, jsonb, date, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, policies, employers } from "../../schema";

/**
 * The three ways a worker's benefit election can be submitted. Every
 * posted enrollment records which one it is so downstream queues and
 * per-type notifications can filter on it.
 *
 * - `first_time`      → the worker's initial enrollment (the reframed
 *                       benefit-election wizard).
 * - `life_event`      → a qualifying-life-event change (future wizard).
 * - `open_enrollment` → a change made during an open-enrollment window
 *                       (future wizard + admin window).
 * - `cobra`           → a COBRA continuation-coverage election made from
 *                       an open COBRA case (BAO component).
 */
export const ENROLLMENT_TYPES = ["first_time", "life_event", "open_enrollment", "cobra"] as const;
export type EnrollmentType = (typeof ENROLLMENT_TYPES)[number];

export const workerTrustElections = pgTable("worker_trust_elections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'restrict' }),
  benefitIds: varchar("benefit_ids").array(),
  policyId: varchar("policy_id").notNull().references(() => policies.id, { onDelete: 'restrict' }),
  startYmd: date("start_ymd").notNull(),
  endYmd: date("end_ymd"),
  relationshipIds: varchar("relationship_ids").array(),
  enrollmentType: varchar("enrollment_type"),
  data: jsonb("data"),
});

export const insertWorkerTrustElectionSchema = createInsertSchema(workerTrustElections).omit({
  id: true,
});

export type WorkerTrustElection = typeof workerTrustElections.$inferSelect;
export type InsertWorkerTrustElection = z.infer<typeof insertWorkerTrustElectionSchema>;

export interface WorkerTrustElectionView extends WorkerTrustElection {
  workerName: string | null;
  policyName: string | null;
  employerName: string | null;
  benefits: { id: string; name: string }[];
  relationships: { id: string; label: string }[];
}

function toYmdString(value: string | Date): string {
  if (value instanceof Date) {
    const yr = value.getFullYear();
    const mo = String(value.getMonth() + 1).padStart(2, '0');
    const dy = String(value.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${dy}`;
  }
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function todayYmdLocal(): string {
  return toYmdString(new Date());
}

const ymdOrDate = z
  .union([z.string(), z.coerce.date()])
  .transform((v) => toYmdString(v));

export const createWorkerTrustElectionRequestSchema = z
  .object({
    employerId: z.string().min(1),
    policyId: z.string().min(1),
    startYmd: ymdOrDate,
    endYmd: ymdOrDate.nullable().optional(),
    benefitIds: z.array(z.string()).nullable().optional(),
    relationshipIds: z.array(z.string()).nullable().optional(),
    enrollmentType: z.enum(ENROLLMENT_TYPES).nullable().optional(),
    data: z.unknown().optional(),
  })
  .superRefine((val, ctx) => {
    // Future start dates are allowed: enrollment effective dates are
    // legitimately "first of next month" when posted after the 15th
    // (benefit election enrollment wizard rule).
    if (val.endYmd && val.endYmd <= val.startYmd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endYmd'], message: 'endYmd must be strictly after startYmd' });
    }
  });

export const updateWorkerTrustElectionRequestSchema = z
  .object({
    employerId: z.string().min(1).optional(),
    policyId: z.string().min(1).optional(),
    startYmd: ymdOrDate.optional(),
    endYmd: ymdOrDate.nullable().optional(),
    benefitIds: z.array(z.string()).nullable().optional(),
    relationshipIds: z.array(z.string()).nullable().optional(),
    enrollmentType: z.enum(ENROLLMENT_TYPES).nullable().optional(),
    data: z.unknown().optional(),
  })
  .superRefine((val, ctx) => {
    // Future start dates are allowed (see create schema note).
    if (val.endYmd && val.startYmd && val.endYmd <= val.startYmd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endYmd'], message: 'endYmd must be strictly after startYmd' });
    }
  });

export type CreateWorkerTrustElectionRequest = z.infer<typeof createWorkerTrustElectionRequestSchema>;
export type UpdateWorkerTrustElectionRequest = z.infer<typeof updateWorkerTrustElectionRequestSchema>;

/* ------------------------------------------------------------------ */
/* Open Enrollment windows                                            */
/* ------------------------------------------------------------------ */

/**
 * Admin-configured Open Enrollment windows. The Open Enrollment wizard is
 * only offered while today falls within one of these windows, and the
 * election it posts is forced to take effect on January 1 of the window's
 * plan year.
 *
 * Owned by the `trust.elections` component (see the component's
 * schemaManifest). One window per plan year (`plan_year` is unique).
 */
export const openEnrollmentWindows = pgTable("open_enrollment_windows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planYear: integer("plan_year").notNull().unique(),
  startYmd: date("start_ymd").notNull(),
  endYmd: date("end_ymd").notNull(),
  notes: varchar("notes"),
  data: jsonb("data"),
});

export const insertOpenEnrollmentWindowSchema = createInsertSchema(openEnrollmentWindows).omit({
  id: true,
});

export type OpenEnrollmentWindow = typeof openEnrollmentWindows.$inferSelect;
export type InsertOpenEnrollmentWindow = z.infer<typeof insertOpenEnrollmentWindowSchema>;

export const createOpenEnrollmentWindowRequestSchema = z
  .object({
    planYear: z.coerce.number().int().min(1990).max(2100),
    startYmd: ymdOrDate,
    endYmd: ymdOrDate,
    notes: z.string().trim().max(2000).nullable().optional(),
    data: z.unknown().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.endYmd < val.startYmd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endYmd"],
        message: "End date must be on or after the start date",
      });
    }
  });

export const updateOpenEnrollmentWindowRequestSchema = z
  .object({
    planYear: z.coerce.number().int().min(1990).max(2100).optional(),
    startYmd: ymdOrDate.optional(),
    endYmd: ymdOrDate.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    data: z.unknown().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.startYmd && val.endYmd && val.endYmd < val.startYmd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endYmd"],
        message: "End date must be on or after the start date",
      });
    }
  });

export type CreateOpenEnrollmentWindowRequest = z.infer<typeof createOpenEnrollmentWindowRequestSchema>;
export type UpdateOpenEnrollmentWindowRequest = z.infer<typeof updateOpenEnrollmentWindowRequestSchema>;
