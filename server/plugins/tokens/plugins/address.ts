import { contactPostal } from "@shared/schema";
import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEntity } from "../types";

/**
 * {{contact.address(primary="true").field(name=…)}} — the recipient's
 * postal address. primary="true" (default) requires the primary active
 * address; primary="false" accepts any active address.
 *
 * All real columns of contact_postal are addressable by their schema
 * name (snake_case or camelCase). Derived extras:
 *   zip  — alias for postal_code
 *   full — one-line composed address (street, city, state, postal_code)
 */

/**
 * Named sample addresses, one per shared persona id. Values are obviously
 * fictional: a preview must never be mistaken for a real member's address.
 */
const ADDRESS_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      street: "1 Red Crater Way",
      city: "Olympus Mons",
      state: "MA",
      postal_code: "00000",
      zip: "00000",
      full: "1 Red Crater Way, Olympus Mons, MA 00000",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      street: "17 St James's Square",
      city: "London",
      state: "ENG",
      postal_code: "SW1Y 4JU",
      zip: "SW1Y 4JU",
      full: "17 St James's Square, London, ENG SW1Y 4JU",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      street: "1 Harbor Rd",
      city: "Ithaca",
      state: "NY",
      postal_code: "14850",
      zip: "14850",
      full: "1 Harbor Rd, Ithaca, NY 14850",
    },
  },
];

registerTokenPlugin({
  metadata: {
    id: "token.address",
    name: "Postal address",
    description: "The contact's active postal address",
    segmentName: "address",
    inputTypes: ["contact", "worker"],
    outputType: "address",
    entityTable: contactPostal,
    entityFields: ["zip", "full"],
    // `{{contact.address}}` on its own means the one-line composed
    // address — what a human means by "their address".
    defaultLeaf: "full",
    args: {
      primary: {
        default: "true",
        description:
          'When "true", only the primary active address; otherwise any active address',
      },
    },
    sampleSets: ADDRESS_SAMPLE_SETS,
  },
  async resolve(entity, args, ctx) {
    const e = tokenEntityOf(entity, "contact") ?? tokenEntityOf(entity, "worker");
    if (!e) return null;
    const contactId =
      e.kind === "contact" ? e.row.id : e.row.contactId;
    if (typeof contactId !== "string") return null;
    const addresses = await memo(ctx, `addresses:${contactId}`, () =>
      ctx.storage.contacts.addresses.getContactPostalByContact(contactId),
    );
    const primaryOnly = args.primary !== "false";
    const primary = addresses.find((a) => a.isPrimary && a.isActive);
    const addr = primaryOnly ? primary : primary || addresses.find((a) => a.isActive);
    if (!addr) return null;
    const full =
      [addr.street, addr.city, addr.state, addr.postalCode]
        .filter(Boolean)
        .join(", ") || null;
    const out: TokenEntity = {
      kind: "address",
      row: { ...addr, zip: addr.postalCode, full },
      table: contactPostal,
    };
    return out;
  },
});
