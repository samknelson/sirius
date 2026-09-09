import { CONTACT_ROOT_NAME } from "../../plugins/tokens/plugins/contact";
import { WORKER_ROOT_NAME } from "../../plugins/tokens/plugins/worker";
import { SYSTEM_ROOT_NAME } from "../../plugins/tokens/plugins/system";
import { EMPLOYER_ROOT_NAME } from "../../plugins/tokens/plugins/employer";
import {
  BULK_PARTICIPANT_ENTITY_KIND,
  BULK_PARTICIPANT_ROOT_NAME,
} from "../../plugins/tokens/plugins/bulk-participant";
import { registerTokenContextRoot } from "../../plugins/tokens/context-roots";
import { registerTokenContext } from "../../plugins/tokens/contexts";
import { BULK_MESSAGE_TOKEN_CONTEXT } from "@shared/token-contexts";
import { MEDIUM_NAMES } from "@shared/delivery-fields";

/**
 * Bulk messaging's OWN token root: the send this render is for.
 *
 * Declared here, at module scope, because every reader of the lists
 * below — the catalog route, the tree, the coverage check, delivery —
 * needs the root to exist by the time it reads them, and they all reach
 * it through this file.
 *
 * A named record root is offered only where a surface declares it, so
 * `{{bulk_participant…}}` is an unknown token everywhere else.
 */
registerTokenContextRoot({
  name: BULK_PARTICIPANT_ROOT_NAME,
  kind: BULK_PARTICIPANT_ENTITY_KIND,
  label: "Bulk participant",
  description: "The send this message is being rendered for",
});

/**
 * The recipient-side roots: the same person, reached three ways.
 *
 * - `contact` — the recipient.
 * - `worker` — the recipient's worker record, for the recipients that
 *   have one. Delivery resolves it from the recipient, so it is a
 *   second way of saying "the person receiving this", not a second
 *   subject.
 * - `system` — dates and site values, seedless and identical for every
 *   recipient.
 *
 * `employer` is deliberately NOT here. The employer root is only ever
 * resolved from the recipient's worker, so as a root of its own it
 * offered a picker of arbitrary employers this message has never heard
 * of. An author who wants the recipient's employer writes it the way
 * delivery reads it — `{{worker.home_employer}}` — which says whose
 * employer it is.
 */
const BULK_RECIPIENT_ROOT_NAMES = [
  CONTACT_ROOT_NAME,
  WORKER_ROOT_NAME,
  SYSTEM_ROOT_NAME,
];

/**
 * BULK MESSAGING'S TOKEN CONTEXT — what a bulk message is about.
 *
 * The roots are stated here once, as the surface's context, so the
 * editor, the catalog route, the browsable tree, the static validation
 * and the coverage check all read the same list and cannot drift apart.
 * The client reads it too, from the `token-contexts` catalog, which is
 * why the message page no longer carries a root list of its own.
 *
 * A bulk message is delivered one PARTICIPANT at a time — a recipient
 * and the medium they are being written to by — so the participant
 * leads: it is the record the render is really about, and the recipient
 * hangs off it (`{{bulk_participant.contact}}`,
 * `{{bulk_participant.contact.worker}}`). The recipient-side roots stay
 * on beside it, both because every existing template is written in
 * terms of them and because "the person this is going to" is the
 * shorter, plainer way to say the same thing.
 *
 * Registered at module scope, beside the participant root above,
 * because every reader below reaches it through this file.
 */
registerTokenContext({
  id: BULK_MESSAGE_TOKEN_CONTEXT,
  name: "Bulk message",
  description:
    "One message written once and delivered to many recipients, a send at a time.",
  rootNames: [BULK_PARTICIPANT_ROOT_NAME, ...BULK_RECIPIENT_ROOT_NAMES],
  // Bulk authors a template per medium, all four of them; which ones a
  // given message uses is that message's own configured state.
  media: [...MEDIUM_NAMES],
  // The gate on the bulk message screens themselves, so the shared
  // token-graph route answers this context for exactly the people who
  // can open the editor it is drawn in.
  access: "bulk.edit",
});

/**
 * The roots behind the merge variables a postal send hands to Lob.
 *
 * Lob templates are authored in Lob, not here, so this list is a
 * contract with a system we cannot read: a key we stop supplying is a
 * hole in somebody's letter, discovered on delivery. It therefore keeps
 * `employer` — those keys resolve from the recipient's worker exactly as
 * they always did — even though bulk no longer OFFERS an employer root
 * to authors writing here. Restricting what an author may write is an
 * editor decision; withdrawing a key from a live template is not, and
 * that is a separate, deliberate change to make with Lob's templates in
 * front of you.
 *
 * For the same reason it is spelled out rather than derived from the
 * editor's list: the participant root is a new thing to write HERE, and
 * a Lob template cannot reference a key it has never been told about.
 * Handing the vendor new keys is a change to make on purpose, with
 * those templates open, not a side effect of the editor gaining a root.
 */
export const BULK_POSTAL_MERGE_ROOT_NAMES = [
  ...BULK_RECIPIENT_ROOT_NAMES,
  EMPLOYER_ROOT_NAME,
];
