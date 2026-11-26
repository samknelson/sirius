import { sql } from "drizzle-orm";
import { getClient } from "../../../../server/storage/transaction-context";
import type { OrganizingSteward } from "../../../../server/storage/cardchecks";
export async function getOrganizingStewards(): Promise<OrganizingSteward[]> {
  const result = await getClient().execute(sql`
    SELECT wsa.employer_id as "employerId", wsa.worker_id as "workerId",
      wsa.bargaining_unit_id as "bargainingUnitId", c.display_name as "displayName",
      c.email, bu.name as "bargainingUnitName",
      (SELECT cp.phone_number FROM contact_phone cp
        WHERE cp.contact_id = c.id AND cp.is_active = true
        ORDER BY cp.is_primary DESC NULLS LAST LIMIT 1) as "phone"
    FROM worker_steward_assignments wsa
    INNER JOIN workers w ON w.id = wsa.worker_id
    INNER JOIN contacts c ON c.id = w.contact_id
    LEFT JOIN bargaining_units bu ON bu.id = wsa.bargaining_unit_id
    ORDER BY c.display_name
  `);
  return result.rows as unknown as OrganizingSteward[];
}
