import { sql, type SQL } from "drizzle-orm";
import { alterHooks } from "@shared/alter";

export interface EdlsWorkerQueryPlan {
  available: boolean;
  refusal?: string;
  join: SQL;
  value: SQL;
  conditions: readonly SQL[];
  orderBy: SQL;
  handled: boolean;
}
export interface EdlsWorkerQueryContext {
  readonly surface: "available" | "directory";
  readonly ratingId?: string;
  readonly ratingValue?: number;
  readonly industryId?: string | null;
}
export const edlsWorkerQueryPlanHook = alterHooks.declare<
  EdlsWorkerQueryPlan, EdlsWorkerQueryContext, Record<string, never>
>({
  id: "edls.workers.query-plan",
  description: "Contribute optional worker selection and display values",
  semantics: "Return SQL fragments only. Preserve host population, bounds and caller transaction. No queries or writes. Explicit unhandled requests are refused.",
});
export class EdlsWorkerQueryUnavailableError extends Error {}
export async function workerQueryPlan(context: EdlsWorkerQueryContext, orderBy: SQL) {
  const plan = await alterHooks.run(edlsWorkerQueryPlanHook, {
    join: sql``, value: sql`NULL::integer`, conditions: [], orderBy, handled: false, available: false,
  }, context);
  if (plan.refusal) throw new EdlsWorkerQueryUnavailableError(plan.refusal);
  if ((context.ratingId || context.ratingValue !== undefined) && !plan.handled) {
    throw new EdlsWorkerQueryUnavailableError("Requested worker rating selection is unavailable");
  }
  return plan;
}
