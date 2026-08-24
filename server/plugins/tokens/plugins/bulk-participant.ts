import { contacts } from "@shared/schema";
import { registerTokenPlugin } from "../registry";
import { tokenEntityOf, type TokenEntity } from "../types";
import { loadContactEntity } from "./contact";

/**
 * THE SEND ITSELF.
 *
 * A bulk message is not delivered to a list of contacts; it is
 * delivered one PARTICIPANT at a time — a row pairing a recipient with
 * the medium this particular send goes out by. That is the thing a bulk
 * template is really rendered against, so it is a token entity kind of
 * its own, and the recipient hangs off it (`{{bulk_participant.contact}}`)
 * rather than the other way round.
 *
 * The kind is offered ONLY where a surface seeds it (`contextRoot`, see
 * `context-roots.ts`): the bulk editor declares the root and hands the
 * studio the message's own participants. Nothing else in the app knows
 * this root, and token land never goes looking for participants.
 */
export const BULK_PARTICIPANT_ENTITY_KIND = "bulk_participant";

/** Root NAME as written in templates: `{{bulk_participant…}}`. */
export const BULK_PARTICIPANT_ROOT_NAME = "bulk_participant";

/**
 * The fields the kind ADVERTISES, and therefore the only ones an author
 * may write.
 *
 * The table has more columns than this, and that is the point: a column
 * is not a reason to offer a token. `status` is always "pending" while
 * the message is being rendered, so a template quoting it would say the
 * same word to everyone and something else in a preview; `message`
 * holds our own delivery-error text; `data`, `comm_id`, `message_id`
 * and `id` are plumbing an author has no use for and a member should
 * never read. What is left — how this person is being written to — is
 * the one thing about a send worth putting in the message it sends.
 */
export const BULK_PARTICIPANT_FIELDS = ["medium"];

/** What `composeBulkParticipantEntity` needs; a participant row satisfies it. */
export interface BulkParticipantEntitySource {
  id?: string;
  contactId: string;
  medium: string;
}

/**
 * Build the entity BOTH the preview and delivery seed the participant
 * root with, so what an author previews is what the recipient receives.
 *
 * The row carries exactly the advertised fields plus what the chain
 * needs to travel: `contactId` for the hop to the recipient, and `id`
 * so the studio can report which participant it rendered. Neither is
 * advertised, so neither is writable as a token.
 */
export function composeBulkParticipantEntity(
  participant: BulkParticipantEntitySource,
): TokenEntity {
  return {
    kind: BULK_PARTICIPANT_ENTITY_KIND,
    row: {
      ...(participant.id ? { id: participant.id } : {}),
      contactId: participant.contactId,
      medium: participant.medium,
    },
  };
}

/**
 * Named sample sends, one per shared persona id (see the contact
 * plugin, which declares the same three). A medium is not personal
 * data, but a persona still needs one: a preview that fell back to a
 * real participant's medium would be reading a record the author did
 * not pick.
 */
const BULK_PARTICIPANT_SAMPLE_SETS = [
  { id: "martian", label: "Martian", values: { medium: "email" } },
  { id: "historical", label: "Historical", values: { medium: "postal" } },
  { id: "mythological", label: "Mythological", values: { medium: "sms" } },
];

/**
 * Descriptor for the participant entity kind: it owns the field
 * catalog, the default leaf, the personas and the preview gate. It is
 * not a root and not a relation (`inputTypes: []`) — the bulk editor's
 * declared context root produces the kind, and this says what the kind
 * IS.
 *
 * No `entityTable`: the catalog is the advertised list above, not the
 * table's columns.
 */
registerTokenPlugin({
  metadata: {
    id: "token.bulk_participant",
    name: "Bulk participant",
    description: "Descriptor for the bulk participant entity kind",
    segmentName: "__bulk_participant",
    inputTypes: [],
    outputType: BULK_PARTICIPANT_ENTITY_KIND,
    entityFields: BULK_PARTICIPANT_FIELDS,
    // `{{bulk_participant}}` on its own means the medium — the only
    // thing the send itself says.
    defaultLeaf: "medium",
    hiddenFromCatalog: true,
    sampleSets: BULK_PARTICIPANT_SAMPLE_SETS,
    /**
     * Reading a participant is reading the person it is addressed to:
     * everything the record leads to — their name, their contact
     * details, their worker record — is theirs, and the participant row
     * itself says only how we are writing to them. So the gate is the
     * recipient's own `contact.view`, evaluated against the contact
     * (`gateEntityId`), exactly as seeding that contact directly would
     * be. Being allowed to edit this bulk message is not, by itself,
     * permission to render a template against one of its recipients.
     */
    previewEntity: {
      gate: { scope: "record", policy: "contact.view" },
      // A participant IS a send to this person, so previewing against
      // one renders `{{contact…}}` and `{{worker…}}` for them, the way
      // delivery does — not for a sample stranger standing beside a
      // real send.
      recipientContactIdOf: (row) =>
        typeof row.contactId === "string" ? row.contactId : undefined,
      async load(storage, id) {
        const row = await storage.bulkParticipants.getById(id);
        if (!row) return null;
        const contact = await storage.bulkTokens.getContactRow(row.contactId);
        const name =
          (typeof contact?.displayName === "string" && contact.displayName) ||
          `Contact ${row.contactId.slice(0, 8)}`;
        return {
          entity: composeBulkParticipantEntity(row),
          label: `${name} · ${row.medium}`,
          gateEntityId: row.contactId,
        };
      },
    },
  },
  async resolve() {
    // Never reached: the descriptor answers to no segment name that a
    // chain can contain (`__bulk_participant` is not writable).
    return null;
  },
});

/**
 * `{{bulk_participant.contact…}}` — the recipient this send is
 * addressed to. Hidden from the flat picker: the bulk editor already
 * offers the recipient as a root of its own, so listing every contact
 * field twice would only double the picker. The tree still walks it,
 * and it is a valid chain everywhere.
 */
registerTokenPlugin({
  metadata: {
    id: "token.bulk_participant.contact",
    name: "Recipient",
    description: "The contact this send is addressed to",
    segmentName: "contact",
    inputTypes: [BULK_PARTICIPANT_ENTITY_KIND],
    outputType: "contact",
    entityTable: contacts,
    hiddenFromCatalog: true,
    defaultLeaf: "display_name",
  },
  async resolve(entity, _args, ctx) {
    const p = tokenEntityOf(entity, BULK_PARTICIPANT_ENTITY_KIND);
    const contactId = p?.row.contactId;
    if (typeof contactId !== "string") return null;
    return loadContactEntity(ctx, contactId);
  },
});
