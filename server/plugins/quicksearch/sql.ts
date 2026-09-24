import { sql } from "drizzle-orm";
import type { Column, SQL } from "drizzle-orm";
import type { storage } from "../../storage";

/** The client a searcher is handed inside `storage.readOnly.query`. */
export type QuicksearchDb = Parameters<Parameters<typeof storage.readOnly.query>[0]>[0];

/**
 * A reference to a column of the row being selected, for use inside a
 * correlated subquery.
 *
 * Interpolating the column itself (`${grievances.id}`) is NOT safe here.
 * Drizzle renders a column qualified (`"grievances"."id"`) in a WHERE clause
 * but UNQUALIFIED (`"id"`) in the select list of a single-table select — so
 * the same fragment used to filter and to report what a row matched on means
 * two different things, and the select-list copy is ambiguous against
 * whatever the subquery joins. Postgres then refuses the whole statement,
 * which surfaces as the searcher failing rather than as a wrong result.
 *
 * This always renders table-qualified, in either position.
 */
export function correlated(column: Column): SQL {
  return sql`${column.table}.${sql.identifier(column.name)}`;
}
