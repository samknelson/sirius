import { sql } from "drizzle-orm";
import { alterHooks } from "../../../../shared/alter";
import { edlsWorkerQueryPlanHook } from "../../../../server/storage/edls/worker-query-plan";

export function registerEdlsRatingQueryPlan() {
  alterHooks.register(edlsWorkerQueryPlanHook, {
    id: "worker.ratings.edls-query-plan", component: "worker.ratings", priority: 10,
    description: "Apply rating selection without changing the host's population or pagination",
    metadata: {},
    alter(previous, context) {
      previous = { ...previous, available: true };
      const { ratingId, ratingValue, industryId, surface } = context;
      if (!ratingId) {
        if (ratingValue !== undefined) return { ...previous, refusal: "A rating type is required" };
        return previous;
      }
      if (surface === "directory") return {
        ...previous, handled: true,
        join: sql`${previous.join} LEFT JOIN worker_ratings selected_rating
          ON selected_rating.worker_id = w.id AND selected_rating.rating_id = ${ratingId}`,
        value: sql`selected_rating.value`,
        conditions: ratingValue === undefined ? previous.conditions :
          [...previous.conditions, sql`selected_rating.value >= ${ratingValue}`],
      };
      return {
        ...previous, handled: true,
        join: sql`${previous.join} INNER JOIN worker_ratings wr ON wr.worker_id = w.id AND wr.rating_id = ${ratingId}`,
        value: sql`wr.value`,
        orderBy: industryId
          ? sql`ORDER BY COALESCE(aw."memberStatusSequence", 999999), aw."ratingValue" DESC, aw.family, aw.given`
          : sql`ORDER BY aw."ratingValue" DESC, aw.family, aw.given`,
      };
    },
  });
}
