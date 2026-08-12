import { sql } from "drizzle-orm";

function splitSearchTerms(searchText: string | undefined): string[] {
  return (searchText?.trim() ?? '').toLowerCase().split(/\s+/).filter(t => t.length > 0);
}

function andCombine(termConditions: ReturnType<typeof sql>[]): ReturnType<typeof sql> {
  let combined = termConditions[0];
  for (let i = 1; i < termConditions.length; i++) {
    combined = sql`${combined} AND ${termConditions[i]}`;
  }
  return sql`AND (${combined})`;
}

/**
 * Name/ID search: each whitespace-separated term must match (AND), and a term
 * may match any of: display/given/family name, sirius_id (cast to text), or an
 * enabled (show-on-lists) worker ID. Deliberately excludes contact columns —
 * see buildContactSearchCondition. Exported for the regression check that
 * guards the Name/ID vs Contact field separation.
 */
export function buildNameIdSearchCondition(searchText: string | undefined) {
  const terms = splitSearchTerms(searchText);
  if (terms.length === 0) return sql``;
  const termConditions = terms.map(term => {
    const pattern = `%${term}%`;
    return sql`(
      LOWER(c.display_name) LIKE ${pattern}
      OR LOWER(c.given) LIKE ${pattern}
      OR LOWER(c.family) LIKE ${pattern}
      OR CAST(w.sirius_id AS TEXT) LIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM worker_ids wid
        INNER JOIN options_worker_id_type widt ON wid.type_id = widt.id
        WHERE wid.worker_id = w.id
          AND (widt.data->>'showOnLists')::boolean = true
          AND LOWER(wid.value) LIKE ${pattern}
      )
    )`;
  });
  return andCombine(termConditions);
}

/**
 * Contact search: each term must match (AND), and a term may match any of:
 * email, active phone (raw or digit-normalized when the term has >=3 digits),
 * or active postal street/city/state/postal code. Deliberately excludes name
 * and ID columns — see buildNameIdSearchCondition.
 */
export function buildContactSearchCondition(searchText: string | undefined) {
  const terms = splitSearchTerms(searchText);
  if (terms.length === 0) return sql``;
  const termConditions = terms.map(term => {
    const pattern = `%${term}%`;
    const digitsOnly = term.replace(/\D/g, '');
    const phonePattern = digitsOnly.length >= 3 ? `%${digitsOnly}%` : null;
    return sql`(
      LOWER(c.email) LIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM contact_phone cp
        WHERE cp.contact_id = c.id
          AND cp.is_active = true
          AND (
            LOWER(cp.phone_number) LIKE ${pattern}
            ${phonePattern ? sql`OR REGEXP_REPLACE(cp.phone_number, '[^0-9]', '', 'g') LIKE ${phonePattern}` : sql``}
          )
      )
      OR EXISTS (
        SELECT 1 FROM contact_postal cpo
        WHERE cpo.contact_id = c.id
          AND cpo.is_active = true
          AND (
            LOWER(cpo.street) LIKE ${pattern}
            OR LOWER(cpo.city) LIKE ${pattern}
            OR LOWER(cpo.state) LIKE ${pattern}
            OR cpo.postal_code LIKE ${pattern}
          )
      )
    )`;
  });
  return andCombine(termConditions);
}
