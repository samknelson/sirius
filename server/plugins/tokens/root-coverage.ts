import { getFieldCatalog } from "./evaluate";
import {
  ENTITY_PATH_FIELD,
  entityDeclaresLocation,
  resolveEntityPath,
} from "./entity-location";
import { resolveRowKey } from "./row-key";
import { normalizeFieldName } from "@shared/tokens";
import type { TokenEntity } from "./types";

/**
 * COVERAGE: does a seeded record actually carry every field the editor
 * offers for its kind?
 *
 * The field catalog for an entity kind is derived from the kind's table
 * columns plus whatever extras a plugin declares — it describes what a
 * template author is ALLOWED to write. A surface that seeds a record
 * hand-built from an event payload can easily satisfy the validator and
 * still be missing most of those keys at delivery time: the offered
 * token passes save-time validation, renders a real value in a preview
 * (previews seed real rows), and comes out BLANK in the sent message.
 *
 * This is the check that catches that gap: give it the record a surface
 * actually seeded and it names the advertised fields the record cannot
 * supply. An open catalog (no closed field list) is not checkable and
 * reports nothing.
 */
export function missingCatalogFields(entity: TokenEntity): string[] {
  const entry = getFieldCatalog()[entity.kind];
  if (!entry || entry.open) return [];
  return entry.names.filter((name) => {
    // A DERIVED field has no key on the row at all, so the row is the
    // wrong thing to ask: `path` is built from the record's id and the
    // route registry. Ask the builder whether it can produce one, which
    // is exactly the question delivery will ask.
    if (
      normalizeFieldName(name) === ENTITY_PATH_FIELD &&
      entityDeclaresLocation(entity.kind)
    ) {
      return resolveEntityPath(entity) === null;
    }
    const key = resolveRowKey(entity, name);
    // `resolveRowKey` also maps a DB column name to its TS property via the
    // declared table, so a name it resolves is NOT necessarily a key the row
    // carries — a hand-built row satisfies it for every column of its table
    // while holding none of them. Delivery reads `row[key]`, so the row is
    // what has to have the key: a value of null/undefined is the record's
    // own truth, an ABSENT key is the advertised-but-blank bug.
    return key === null || !Object.hasOwn(entity.row, key);
  });
}
