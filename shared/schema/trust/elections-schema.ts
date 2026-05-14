import { pgTable, varchar, jsonb, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, policies } from "../../schema";

export const workerTrustElections = pgTable("worker_trust_elections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  benefitIds: varchar("benefit_ids").array(),
  policyId: varchar("policy_id").notNull().references(() => policies.id, { onDelete: 'restrict' }),
  startYmd: date("start_ymd").notNull(),
  endYmd: date("end_ymd"),
  relationshipIds: varchar("relationship_ids").array(),
  data: jsonb("data"),
});

export const insertWorkerTrustElectionSchema = createInsertSchema(workerTrustElections).omit({
  id: true,
});

export type WorkerTrustElection = typeof workerTrustElections.$inferSelect;
export type InsertWorkerTrustElection = z.infer<typeof insertWorkerTrustElectionSchema>;

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
    policyId: z.string().min(1),
    startYmd: ymdOrDate,
    endYmd: ymdOrDate.nullable().optional(),
    benefitIds: z.array(z.string()).nullable().optional(),
    relationshipIds: z.array(z.string()).nullable().optional(),
    data: z.unknown().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.startYmd > todayYmdLocal()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startYmd'], message: 'startYmd cannot be in the future' });
    }
    if (val.endYmd && val.endYmd <= val.startYmd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endYmd'], message: 'endYmd must be strictly after startYmd' });
    }
  });

export const updateWorkerTrustElectionRequestSchema = z
  .object({
    policyId: z.string().min(1).optional(),
    startYmd: ymdOrDate.optional(),
    endYmd: ymdOrDate.nullable().optional(),
    benefitIds: z.array(z.string()).nullable().optional(),
    relationshipIds: z.array(z.string()).nullable().optional(),
    data: z.unknown().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.startYmd && val.startYmd > todayYmdLocal()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startYmd'], message: 'startYmd cannot be in the future' });
    }
    if (val.endYmd && val.startYmd && val.endYmd <= val.startYmd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endYmd'], message: 'endYmd must be strictly after startYmd' });
    }
  });

export type CreateWorkerTrustElectionRequest = z.infer<typeof createWorkerTrustElectionRequestSchema>;
export type UpdateWorkerTrustElectionRequest = z.infer<typeof updateWorkerTrustElectionRequestSchema>;
