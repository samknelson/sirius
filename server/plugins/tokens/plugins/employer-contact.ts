import { employerContacts } from "@shared/schema";
import { registerTokenPlugin } from "../registry";

/**
 * THE EMPLOYER-CONTACT LINK as a token entity kind.
 *
 * An employer contact is not a person and not an employer: it is the
 * ROW that says this person is that employer's contact, and of what
 * type. That distinction is the whole reason it is a kind of its own —
 * the contact type lives here and nowhere else, so
 * `{{employer_contact.options_employer_contact_type}}` has no other
 * home, while the person and the company are reached THROUGH the link
 * (`{{employer_contact.contact}}`, `{{employer_contact.employer}}`) by
 * relations the boot sweeps generate from its foreign keys.
 *
 * Deliberately NO default leaf. A bare `{{employer_contact}}` would
 * have to render one of the link's own fields, and every one of them is
 * an id: the row has no column that names it to a reader. The honest
 * answer is to reject the short form rather than pick a uuid or quietly
 * render the person's name under a root that is not the person.
 */
export const EMPLOYER_CONTACT_ENTITY_KIND = "employer_contact";

/**
 * Root NAME of the employer contact a message is being composed to.
 * Only surfaces that declare it have it — see the compose scopes.
 */
export const EMPLOYER_CONTACT_ROOT_NAME = "employer_contact";

/**
 * Entity descriptor: never matches as a segment (`inputTypes: []`), it
 * exists to say what the kind IS — its table, where its records live,
 * and how reading one is authorized — so the relation sweeps can point
 * at it and the studio can seed a render with one.
 */
registerTokenPlugin({
  metadata: {
    id: "token.employer_contact",
    name: "Employer contact",
    description: "Descriptor for the employer-contact link entity kind",
    segmentName: "__employer_contact",
    inputTypes: [],
    outputType: EMPLOYER_CONTACT_ENTITY_KIND,
    entityTable: employerContacts,
    hiddenFromCatalog: true,
    // The link has its own page — the employer-contact tabs.
    entityLocation: {
      tabEntity: "employer_contact",
      idField: "id",
      defaultTab: "view",
    },
    // Reading an employer contact is a read of that EMPLOYER's contact
    // list: `/api/employer-contacts/:id` gates on `employer.manage` for
    // the employer behind the link, so the gate subject is the employer
    // id the record yields, not the link's own id.
    previewEntity: {
      gate: { scope: "record", policy: "employer.manage" },
      async load(storage, id) {
        const row = await storage.employerContacts.get(id);
        if (!row) return null;
        return {
          entity: {
            kind: EMPLOYER_CONTACT_ENTITY_KIND,
            // The link's OWN columns. The nested contact and contact
            // type the storage read joins in are other kinds' records,
            // reached through this one's relations — merging them onto
            // the row would give the link fields it does not have.
            row: {
              id: row.id,
              employerId: row.employerId,
              contactId: row.contactId,
              contactTypeId: row.contactTypeId,
            },
            table: employerContacts,
          },
          label:
            (typeof row.contact?.displayName === "string" &&
              row.contact.displayName) ||
            `Employer contact ${id.slice(0, 8)}`,
          gateEntityId: row.employerId,
        };
      },
      // The link IS the addressee: a message composed to an employer
      // contact goes to the person behind it, so the recipient-side
      // roots resolve from them rather than from a sample persona.
      recipientContactIdOf(row) {
        return typeof row.contactId === "string" ? row.contactId : undefined;
      },
    },
  },
  async resolve() {
    // Never reached: the descriptor answers to no segment name a
    // template can write.
    return null;
  },
});
