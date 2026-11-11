import { pgTable, varchar, jsonb, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, policies, employers } from "../../schema";
import { toYmd } from "../../utils/date";

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
  // Legacy/audit only: the policy in effect is DERIVED from the election's
  // employer's policy history as of the relevant date (see
  // server/services/policy-resolution.ts). New elections no longer store a
  // policy; the column is kept nullable for audit/rollback.
  policyId: varchar("policy_id").references(() => policies.id, { onDelete: 'restrict' }),
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
  /** Policy effective for this election's employer as of its start date. */
  effectivePolicyId: string | null;
  employerName: string | null;
  benefits: { id: string; name: string }[];
  relationships: { id: string; label: string; coveredWorkerId: string | null }[];
}

const ymdOrDate = z
  .union([z.string(), z.coerce.date()])
  .transform((v) => toYmd(v) ?? String(v));

export const createWorkerTrustElectionRequestSchema = z
  .object({
    employerId: z.string().min(1),
    /** Legacy/audit only — accepted but no longer required; the effective
     * policy is derived from the employer's policy history. */
    policyId: z.string().min(1).nullable().optional(),
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
    policyId: z.string().min(1).nullable().optional(),
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
