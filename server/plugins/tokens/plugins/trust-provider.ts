import { trustProviders, trustProviderContacts } from "@shared/schema";
import { registerTokenPlugin } from "../registry";

/**
 * TRUST PROVIDERS and their contacts as token entity kinds.
 *
 * Two kinds, mirroring the employer side:
 *
 *  - `provider` — the provider organisation itself. Named for what it
 *    is called everywhere a user meets it (the pages say "provider",
 *    the tab registry entity is `provider`); the `trust_providers`
 *    table name is storage's business, not the template author's.
 *  - `provider_contact` — the ROW linking a person to a provider, and
 *    the only place that link's contact type lives.
 *
 * The provider is reached THROUGH the link
 * (`{{provider_contact.provider}}`) by a generated relation, the same
 * way `{{employer_contact.employer}}` works: a provider root of its own
 * would offer a picker of arbitrary providers a message being composed
 * to one person has never heard of.
 *
 * Both are behind the `trust.providers` component: its tables can be
 * absent from the database entirely, so an unguarded read errors
 * instead of refusing.
 */
const TRUST_PROVIDERS_COMPONENT = "trust.providers";

export const PROVIDER_ENTITY_KIND = "provider";
export const PROVIDER_CONTACT_ENTITY_KIND = "provider_contact";

/**
 * Root NAME of the provider contact a message is being composed to.
 * Only surfaces that declare it have it — see the compose scopes.
 */
export const PROVIDER_CONTACT_ROOT_NAME = "provider_contact";

/**
 * Named sample providers, one per shared persona id. Obviously
 * fictional: a preview must never be mistaken for a real provider.
 */
const PROVIDER_SAMPLE_SETS = [
  { id: "martian", label: "Martian", values: { name: "Olympus Mons Health Plan" } },
  { id: "historical", label: "Historical", values: { name: "Babbage Mutual Assurance" } },
  { id: "mythological", label: "Mythological", values: { name: "Aegis Benefit Trust" } },
];

/**
 * Provider descriptor. Matches no segment of its own; the generated
 * relation off `trust_provider_contacts.provider_id` is what makes
 * `{{provider_contact.provider}}` resolve, and it loads through the
 * `load` declared here so a relation and a seeded record can never
 * disagree about what a provider is.
 */
registerTokenPlugin({
  metadata: {
    id: "token.provider",
    name: "Provider",
    description: "Descriptor for the trust provider entity kind",
    segmentName: "__provider",
    inputTypes: [],
    outputType: PROVIDER_ENTITY_KIND,
    entityTable: trustProviders,
    // `{{…provider}}` on its own means the provider's name — the only
    // field of the row that names it to a reader.
    defaultLeaf: "name",
    hiddenFromCatalog: true,
    requiredComponent: TRUST_PROVIDERS_COMPONENT,
    sampleSets: PROVIDER_SAMPLE_SETS,
    // A provider has its own page.
    entityLocation: {
      tabEntity: "provider",
      idField: "id",
      defaultTab: "view",
    },
    // `/api/trust/provider/:id` is a staff read of the provider list —
    // a page gate, not a per-provider one, so it is asked once.
    previewEntity: {
      gate: { scope: "route", policy: "staff" },
      async load(storage, id) {
        const row = await storage.trustProviders.getTrustProvider(id);
        if (!row) return null;
        return {
          entity: { kind: PROVIDER_ENTITY_KIND, row, table: trustProviders },
          label:
            (typeof row.name === "string" && row.name) ||
            `Provider ${id.slice(0, 8)}`,
        };
      },
    },
  },
  async resolve() {
    // Never reached: the descriptor answers to no segment name a
    // template can write.
    return null;
  },
});

/**
 * Provider-contact link descriptor.
 *
 * Deliberately NO default leaf, for the same reason the employer side
 * has none: every column of the link is an id, so a bare
 * `{{provider_contact}}` could only render a uuid or lie about being
 * the person.
 */
registerTokenPlugin({
  metadata: {
    id: "token.provider_contact",
    name: "Provider contact",
    description: "Descriptor for the provider-contact link entity kind",
    segmentName: "__provider_contact",
    inputTypes: [],
    outputType: PROVIDER_CONTACT_ENTITY_KIND,
    entityTable: trustProviderContacts,
    hiddenFromCatalog: true,
    requiredComponent: TRUST_PROVIDERS_COMPONENT,
    entityLocation: {
      tabEntity: "provider_contact",
      idField: "id",
      defaultTab: "view",
    },
    // `/api/trust-provider-contacts/:id` is a staff read: the same page
    // gate, asked once rather than per record.
    previewEntity: {
      gate: { scope: "route", policy: "staff" },
      async load(storage, id) {
        const row = await storage.trustProviderContacts.get(id);
        if (!row) return null;
        return {
          entity: {
            kind: PROVIDER_CONTACT_ENTITY_KIND,
            // The link's OWN columns — see the employer-contact
            // descriptor for why the joined records stay out.
            row: {
              id: row.id,
              providerId: row.providerId,
              contactId: row.contactId,
              contactTypeId: row.contactTypeId,
            },
            table: trustProviderContacts,
          },
          label:
            (typeof row.contact?.displayName === "string" &&
              row.contact.displayName) ||
            `Provider contact ${id.slice(0, 8)}`,
        };
      },
      // The link IS the addressee — see the employer-contact descriptor.
      recipientContactIdOf(row) {
        return typeof row.contactId === "string" ? row.contactId : undefined;
      },
    },
  },
  async resolve() {
    return null;
  },
});
