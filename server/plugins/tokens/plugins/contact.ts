import { contacts } from "@shared/schema";
import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEntity, type TokenEvalContext } from "../types";

export async function loadContactEntity(
  ctx: TokenEvalContext,
  contactId: string,
): Promise<TokenEntity | null> {
  const row = await memo(ctx, `contact-row:${contactId}`, async () => {
    return (await ctx.storage.bulkTokens.getContactRow(contactId)) ?? null;
  });
  if (!row) return null;
  return { kind: "contact", row, table: contacts };
}

/**
 * Named sample people. Every value is obviously fictional on purpose: a
 * preview must never be mistaken for — or leak — a real member's data.
 * The ids are the shared persona vocabulary (see `TokenSampleSet`), so
 * the worker and employer plugins declare the same three.
 */
const CONTACT_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      display_name: "Zorb Quixnar",
      given: "Zorb",
      middle: "Vel",
      family: "Quixnar",
      title: "Cmdr.",
      generational: "IV",
      credentials: "P.Eng.",
      email: "zorb.quixnar@example.invalid",
      birth_date: "04/17/2151",
      gender: "Nonbinary",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      display_name: "Ada Lovelace",
      given: "Ada",
      middle: "Augusta",
      family: "Lovelace",
      title: "Ms.",
      generational: "Jr.",
      credentials: "F.R.S.",
      email: "ada.lovelace@example.invalid",
      birth_date: "12/10/1815",
      gender: "Female",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      display_name: "Odysseus Ithaka",
      given: "Odysseus",
      middle: "Laertiades",
      family: "Ithaka",
      title: "Capt.",
      generational: "Sr.",
      credentials: "H.M.",
      email: "odysseus.ithaka@example.invalid",
      birth_date: "03/02/1184",
      gender: "Male",
    },
  },
];

/**
 * Root NAME of the recipient's contact. A surface that offers "who is
 * this going to" as a preview seed names this root, and the roots that
 * follow the recipient (worker, employer) resolve from whatever it is
 * seeded with.
 */
export const CONTACT_ROOT_NAME = "contact";

/** Root: {{contact...}} — the recipient's full contact record. */
registerTokenPlugin({
  metadata: {
    id: "token.contact",
    name: "Contact",
    description: "The recipient's contact record",
    segmentName: CONTACT_ROOT_NAME,
    inputTypes: ["root"],
    outputType: "contact",
    entityTable: contacts,
    defaultLeaf: "display_name",
    recipientRooted: true,
    sampleSets: CONTACT_SAMPLE_SETS,
    // Previewing against a real person is a read of that person's
    // contact record, so it runs the contact's own entity view policy —
    // per record, exactly as opening the contact elsewhere does.
    previewEntity: {
      gate: { scope: "record", policy: "contact.view" },
      async load(storage, id) {
        const row = await storage.bulkTokens.getContactRow(id);
        if (!row) return null;
        return {
          entity: { kind: "contact", row, table: contacts },
          label:
            (typeof row.displayName === "string" && row.displayName) ||
            `Contact ${id.slice(0, 8)}`,
        };
      },
    },
  },
  async resolve(_entity, _args, ctx) {
    // A seeded contact wins; otherwise the root means "the recipient".
    const seeded = ctx.roots.contact;
    if (seeded) return seeded;
    if (!ctx.contactId) return null;
    return loadContactEntity(ctx, ctx.contactId);
  },
});

/** {{worker.contact...}} — hop from a worker to its contact record. */
registerTokenPlugin({
  metadata: {
    id: "token.worker.contact",
    name: "Worker contact",
    description: "The contact record behind a worker",
    segmentName: "contact",
    inputTypes: ["worker"],
    outputType: "contact",
    entityTable: contacts,
    hiddenFromCatalog: true,
    defaultLeaf: "display_name",
  },
  async resolve(entity, _args, ctx) {
    const w = tokenEntityOf(entity, "worker");
    const contactId = w?.row.contactId;
    if (typeof contactId !== "string") return null;
    return loadContactEntity(ctx, contactId);
  },
});
