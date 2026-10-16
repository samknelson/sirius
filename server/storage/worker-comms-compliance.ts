import { sql } from "drizzle-orm";
import { getClient } from "./transaction-context";
import { buildWorkerPopulationCondition } from "./workers";
import { isComponentEnabledSync } from "../services/component-cache";
import type { ComplianceView, WorkerCommsCounts, WorkerCommsDefinition, WorkerCommsOptions, WorkerCommsReport } from "@shared/worker-comms-compliance";
import { resolveBenefitPeriod } from "@shared/worker-comms-compliance";

export function qualifyingCommPredicate(definition: WorkerCommsDefinition) {
  // All restrictions refer to ONE communication, not separate per-condition EXISTS.
  return sql`cm.contact_id = c.id
    AND EXISTS (SELECT 1 FROM comm_tags ct WHERE ct.comm_id = cm.id AND ct.comm_tag_id = ${definition.commTagId})
    AND cm.status IN (${sql.join(definition.statuses.map(status => sql`${status}`), sql`, `)})
    ${definition.medium ? sql`AND cm.medium = ${definition.medium}` : sql``}
    ${definition.sentFrom ? sql`AND cm.sent >= ${definition.sentFrom}::date` : sql``}
    ${definition.sentThrough ? sql`AND cm.sent < (${definition.sentThrough}::date + INTERVAL '1 day')` : sql``}`;
}

export function compliancePopulationCte(definition: WorkerCommsDefinition, referenceMonth = currentBenefitMonth()) {
  const p = definition.population;
  // Refuse a saved restriction whose component is now unavailable: never broaden.
  for (const [component, selected] of [
    ["trust.benefits", p.benefitIds.length > 0],
    ["bargainingunits", !!p.bargainingUnitId],
    ["sitespecific.btu.political", !!p.representativeId],
  ] as const) {
    if (selected && !isComponentEnabledSync(component)) {
      throw Object.assign(new Error(`This definition requires the ${component} component`), { status: 409 });
    }
  }
  const population = buildWorkerPopulationCondition(p, resolveBenefitPeriod(p, referenceMonth));
  return sql`WITH evidence AS (
    SELECT DISTINCT ON (cm.contact_id) cm.contact_id, cm.id, cm.status, cm.medium, cm.sent
    FROM comm cm INNER JOIN contacts c ON c.id = cm.contact_id
    WHERE ${qualifyingCommPredicate(definition)}
    ORDER BY cm.contact_id, cm.sent DESC NULLS LAST, cm.id
  ), population AS (
    SELECT w.id AS "workerId", w.contact_id AS "contactId", w.sirius_id AS "siriusId",
      c.display_name AS name, evidence.id AS "commId", evidence.status, evidence.medium, evidence.sent
    FROM workers w INNER JOIN contacts c ON c.id = w.contact_id
    LEFT JOIN evidence ON evidence.contact_id = c.id
    WHERE 1=1 ${population}
  )`;
}

export function complianceViewPredicate(view: ComplianceView) {
  return view === "with" ? sql`"commId" IS NOT NULL`
    : view === "without" ? sql`"commId" IS NULL` : sql`true`;
}

export function currentBenefitMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function createWorkerCommsComplianceStorage() {
  return {
    async options(): Promise<Omit<WorkerCommsOptions, "canManage" | "canBulk">> {
      const client = getClient();
      const benefitsEnabled = isComponentEnabledSync("trust.benefits");
      const bargainingUnitsEnabled = isComponentEnabledSync("bargainingunits");
      const politicalEnabled = isComponentEnabledSync("sitespecific.btu.political");
      async function lookup(query: ReturnType<typeof sql>) {
        return (await client.execute(query)).rows as { id: string; name: string }[];
      }
      const [tags, memberStatuses, benefits, employers, employerTypes, bargainingUnits, representatives] = await Promise.all([
        lookup(sql`SELECT id,name FROM options_comm_tags ORDER BY name,id`),
        lookup(sql`SELECT id,name FROM options_worker_ms ORDER BY name,id`),
        benefitsEnabled ? lookup(sql`SELECT id,name FROM trust_benefits ORDER BY name,id`) : [],
        lookup(sql`SELECT id,name FROM employers ORDER BY name,id`),
        lookup(sql`SELECT id,name FROM options_employer_type ORDER BY name,id`),
        bargainingUnitsEnabled ? lookup(sql`SELECT id,name FROM bargaining_units ORDER BY name,id`) : [],
        politicalEnabled ? lookup(sql`SELECT id,name FROM sitespecific_btu_political_officials ORDER BY name,id`) : [],
      ]);
      return { tags, memberStatuses, benefits, employers, employerTypes, bargainingUnits, representatives,
        benefitsEnabled, bargainingUnitsEnabled, politicalEnabled };
    },
    async report(definition: WorkerCommsDefinition, view: ComplianceView, page: number, pageSize: number, referenceMonth = currentBenefitMonth()): Promise<WorkerCommsReport> {
      const result = await getClient().execute(sql`${compliancePopulationCte(definition, referenceMonth)},
        filtered AS (SELECT * FROM population WHERE ${complianceViewPredicate(view)}),
        paged AS (SELECT * FROM filtered ORDER BY name,"workerId" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize})
        SELECT (SELECT count(*)::integer FROM population) AS population,
          (SELECT count(*)::integer FROM population WHERE "commId" IS NOT NULL) AS "with",
          (SELECT count(*)::integer FROM population WHERE "commId" IS NULL) AS "without",
          (SELECT count(*)::integer FROM filtered) AS total,
          COALESCE((SELECT json_agg(paged ORDER BY name,"workerId") FROM paged), '[]'::json) AS rows`);
      const record = result.rows[0] as unknown as WorkerCommsCounts & Pick<WorkerCommsReport, "rows" | "total">;
      return { definition, counts: { population: record.population, with: record.with, without: record.without },
        rows: record.rows, total: record.total, page, pageSize, benefitMonth: referenceMonth,
        benefitPeriod: resolveBenefitPeriod(definition.population, referenceMonth) };
    },
    async contacts(definition: WorkerCommsDefinition, view: ComplianceView, referenceMonth = currentBenefitMonth()): Promise<string[]> {
      const result = await getClient().execute(sql`${compliancePopulationCte(definition, referenceMonth)}
        SELECT DISTINCT "contactId" FROM population WHERE ${complianceViewPredicate(view)} ORDER BY "contactId"`);
      return result.rows.map(row => String(row.contactId));
    },
  };
}
export type WorkerCommsComplianceStorage = ReturnType<typeof createWorkerCommsComplianceStorage>;
