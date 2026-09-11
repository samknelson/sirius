import type { Express } from "express";
import {
  COMPOSE_CHANNELS,
  isComposeChannel,
  isComposeScopeName,
  type ComposeRenderResponse,
  type ComposeScopeName,
} from "@shared/comm-compose";
import { composeTokenContextId } from "@shared/token-contexts";
import { MEDIUM_FIELDS } from "@shared/delivery-fields";
import { storage } from "../storage";
import {
  registerTokenContext,
  registerTokenContextRoot,
  resolveTokenPreviewEntity,
  tokenContextRootNames,
  type TokenEntity,
  type TokenEntityType,
} from "../plugins/tokens";
import { buildPreviewSeeds } from "../plugins/tokens/preview-seeds";
import { CONTACT_ROOT_NAME } from "../plugins/tokens/plugins/contact";
import { SYSTEM_ROOT_NAME } from "../plugins/tokens/plugins/system";
import { WORKER_ROOT_NAME } from "../plugins/tokens/plugins/worker";
import {
  EMPLOYER_CONTACT_ENTITY_KIND,
  EMPLOYER_CONTACT_ROOT_NAME,
} from "../plugins/tokens/plugins/employer-contact";
import {
  PROVIDER_CONTACT_ENTITY_KIND,
  PROVIDER_CONTACT_ROOT_NAME,
} from "../plugins/tokens/plugins/trust-provider";
import { renderTemplatePreview } from "./template-preview";

/**
 * COMPOSING A ONE-OFF MESSAGE FROM A TEMPLATE.
 *
 * The Communications tabs let an admin write one message to one person.
 * This module gives those screens the Template Studio: the author
 * writes tokenized text against the record the page is about, and on
 * apply the text is RENDERED FOR REAL here and the finished string goes
 * into the form field.
 *
 * The send paths are untouched, and that is the point. Delivery still
 * receives plain text it puts on the wire verbatim — no sender and no
 * `deliver()` learns to evaluate a token, so there is exactly one place
 * a token can turn into text for a manually composed message, and it is
 * this render, in front of an author who sees the result before they
 * press send.
 *
 * ONE SURFACE, THREE SCOPES. The field specs, the render, the gating
 * and the refusal rules are identical for a worker, an employer contact
 * and a provider contact; the only thing that varies is which roots the
 * author may write against, which is a property of the record the page
 * is about.
 */

/**
 * The employer-contact and provider-contact roots exist only where a
 * surface declares them, so `{{employer_contact…}}` stays an unknown
 * token in bulk messaging and in every notifier.
 *
 * Declared at module scope because every reader below — the seeds, the
 * render — needs them to exist by the time it runs, and they all reach
 * them through this file.
 */
registerTokenContextRoot({
  name: EMPLOYER_CONTACT_ROOT_NAME,
  kind: EMPLOYER_CONTACT_ENTITY_KIND,
  label: "Employer contact",
  description: "The employer contact this message is being written to",
});

registerTokenContextRoot({
  name: PROVIDER_CONTACT_ROOT_NAME,
  kind: PROVIDER_CONTACT_ENTITY_KIND,
  label: "Provider contact",
  description: "The provider contact this message is being written to",
  requiredComponent: "trust.providers",
});

/**
 * WHO MAY COMPOSE — the gate on every route in this file, and the one
 * each scope's token context carries so the shared token-graph route
 * answers for the same people.
 *
 * A compose screen lives on a record's Communications tab, which is
 * staff territory; there is no narrower thing to be allowed to do here.
 */
const COMPOSE_ACCESS_POLICY = "staff";

/**
 * WHAT A COMPOSE SCREEN IS ABOUT, per scope.
 *
 * Each scope names a CLOSED, ordered root list, led by the record the
 * message is really about and followed by the recipient-side roots
 * every message has. Nothing is implicit and nothing is derived from
 * the registry: a root that is not written here does not exist for
 * these templates, which is what keeps the picker, the tree, the
 * author-time validation and the render from drifting apart.
 *
 * `employer` and `provider` are deliberately NOT roots. Each is reached
 * through the link that names it — `{{employer_contact.employer}}`,
 * `{{provider_contact.provider}}` — the same way `{{worker.home_employer}}`
 * says WHOSE employer it means. As roots of their own they would offer
 * a picker of arbitrary organisations this message has never heard of.
 */
interface ComposeScope {
  name: ComposeScopeName;
  /** Token entity kind of the record the client names. */
  kind: TokenEntityType;
  /** Root the named record seeds. */
  rootName: string;
  /** Whom the message is addressed to, from the named record's row. */
  contactIdOf(row: Record<string, unknown>): string | undefined;
}

/**
 * The COMPLETE ordered root list for one scope — read from the scope's
 * token context, which is where it is declared (see the registrations
 * below). Every reader here goes through this: the seeds, the render
 * and the studio the author is looking at — including the shared token
 * graph and tree routes, which read the same context by id — are then
 * all reading one list.
 */
function scopeRootNames(scope: ComposeScope): string[] {
  return tokenContextRootNames(composeTokenContextId(scope.name));
}

/** Every row these scopes name carries the addressee as `contact_id`. */
function contactIdColumn(row: Record<string, unknown>): string | undefined {
  const id = row.contactId;
  return typeof id === "string" && id ? id : undefined;
}

const COMPOSE_SCOPES: Record<ComposeScopeName, ComposeScope> = {
  // The page is about the WORKER, so the worker is the record the
  // client names and the contact is derived from it. Naming the contact
  // instead would leave `{{worker…}}` resolving through the recipient
  // by luck rather than by statement.
  worker: {
    name: "worker",
    kind: "worker",
    rootName: WORKER_ROOT_NAME,
    contactIdOf: contactIdColumn,
  },
  employer_contact: {
    name: "employer_contact",
    kind: EMPLOYER_CONTACT_ENTITY_KIND,
    rootName: EMPLOYER_CONTACT_ROOT_NAME,
    contactIdOf: contactIdColumn,
  },
  provider_contact: {
    name: "provider_contact",
    kind: PROVIDER_CONTACT_ENTITY_KIND,
    rootName: PROVIDER_CONTACT_ROOT_NAME,
    contactIdOf: contactIdColumn,
  },
};

/**
 * ONE CONTEXT PER SCOPE — the root lists themselves.
 *
 * Registered at module scope alongside the roots above, because every
 * reader below reaches them through this file, and published to the
 * screens through the `token-contexts` catalog: the compose screen
 * names its scope's context and takes the roots from there, so the
 * editor cannot offer a root this render would refuse.
 *
 * Each list is led by the record the message is really about and
 * followed by the recipient-side roots every message has.
 */
registerTokenContext({
  id: composeTokenContextId("worker"),
  name: "Compose to a worker",
  description:
    "A one-off message written on a worker's Communications tab, about that worker.",
  rootNames: [WORKER_ROOT_NAME, CONTACT_ROOT_NAME, SYSTEM_ROOT_NAME],
  media: [...COMPOSE_CHANNELS],
  access: COMPOSE_ACCESS_POLICY,
});

registerTokenContext({
  id: composeTokenContextId("employer_contact"),
  name: "Compose to an employer contact",
  description:
    "A one-off message written on an employer contact's Communications tab, " +
    "about that employer link.",
  rootNames: [EMPLOYER_CONTACT_ROOT_NAME, CONTACT_ROOT_NAME, SYSTEM_ROOT_NAME],
  media: [...COMPOSE_CHANNELS],
  access: COMPOSE_ACCESS_POLICY,
});

registerTokenContext({
  id: composeTokenContextId("provider_contact"),
  name: "Compose to a provider contact",
  description:
    "A one-off message written on a trust provider contact's Communications " +
    "tab, about that provider link.",
  rootNames: [PROVIDER_CONTACT_ROOT_NAME, CONTACT_ROOT_NAME, SYSTEM_ROOT_NAME],
  media: [...COMPOSE_CHANNELS],
  access: COMPOSE_ACCESS_POLICY,
  // Same gate as the provider-contact root itself: with the component
  // off there is no such screen and no such context.
  component: "trust.providers",
});

/** The scope's record and the person it is addressed to, both gated. */
type ResolvedTarget =
  | {
      ok: true;
      scope: ComposeScope;
      entity: TokenEntity;
      label: string;
      contactId: string;
      contactEntity: TokenEntity;
      contactLabel: string;
    }
  | { ok: false; status: number; message: string };

/**
 * Resolve what the client named into the records a render may be seeded
 * with — refusing at the first thing this caller may not read.
 *
 * The client names ONE record and the scope it belongs to. Everything
 * else is derived here: a client that could also name the contact could
 * name somebody else's, and a screen about one person would compose a
 * message addressed to another.
 *
 * BOTH records are loaded through their own kind's declared read, so
 * each runs the gate that guards it everywhere else in the app — the
 * worker's `worker.view`, the employer link's `employer.manage`, the
 * contact's `contact.view`. Being allowed to open the compose screen is
 * not by itself permission to render the person's data into text.
 */
async function resolveTarget(
  req: any,
  scopeName: unknown,
  recordId: unknown,
): Promise<ResolvedTarget> {
  if (!isComposeScopeName(scopeName)) {
    return { ok: false, status: 400, message: "Unknown compose scope" };
  }
  if (typeof recordId !== "string" || !recordId) {
    return { ok: false, status: 400, message: "No record named" };
  }
  const scope = COMPOSE_SCOPES[scopeName];
  const ctx = { storage, req };

  const record = await resolveTokenPreviewEntity(scope.kind, recordId, ctx);
  if (!record.ok) return record;

  const contactId = scope.contactIdOf(record.entity.row);
  if (!contactId) {
    // Every record these scopes name has an addressee by construction
    // (the column is NOT NULL). Reaching here means the row is not the
    // shape this scope was written for, and rendering it would produce
    // a message with sample people in it.
    return {
      ok: false,
      status: 500,
      message: "That record does not name anybody to write to",
    };
  }

  const contact = await resolveTokenPreviewEntity("contact", contactId, ctx);
  if (!contact.ok) return contact;

  return {
    ok: true,
    scope,
    entity: record.entity,
    label: record.label,
    contactId,
    contactEntity: contact.entity,
    contactLabel: contact.label,
  };
}

export function registerCommComposeRoutes(
  app: Express,
  requireAuth: any,
  requireAccess: any,
) {
  /**
   * WHAT THIS COMPOSE SCREEN MAY BE PREVIEWED AGAINST: the single real
   * record behind each seedable root of the scope.
   *
   * There is no picker to fill — a compose screen is about one person,
   * so it supplies one record per root and the author previews against
   * the message they are actually writing.
   *
   * What may be WRITTEN is not this screen's to answer: the token graph
   * for the scope's roots is the same graph every other surface gets,
   * and the studio reads it from /api/token-studio/graph for the
   * scope's token context.
   */
  app.get(
    "/api/comm-compose/preview-seeds",
    requireAuth,
    requireAccess(COMPOSE_ACCESS_POLICY),
    async (req: any, res) => {
      try {
        const target = await resolveTarget(
          req,
          req.query.scope,
          req.query.recordId,
        );
        if (!target.ok) {
          res.status(target.status).json({ message: target.message });
          return;
        }
        const { scope } = target;
        const rootNames = scopeRootNames(scope);

        // No root list here: the studio reads the scope's roots from
        // the `token-contexts` catalog, so this endpoint answers only
        // for what it alone knows — the one real record each seedable
        // root is previewed against.
        res.json(
          await buildPreviewSeeds(
            { storage, req },
            {
              rootNames,
              recordsByRoot: {
                [scope.rootName]: [
                  { id: rowId(target.entity), label: target.label },
                ],
                [CONTACT_ROOT_NAME]: [
                  { id: target.contactId, label: target.contactLabel },
                ],
              },
            },
          ),
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Failed to load preview seeds";
        res.status(500).json({ message });
      }
    },
  );

  // The browsable token tree is NOT served here. It is the same tree
  // for every surface, so it is one route family scoped and gated by
  // the token context named in the request
  // (`/api/token-studio/tree/*?context=…`), which reads each scope's
  // roots from that scope's own context exactly as this copy used to.

  /**
   * THE RENDER — tokenized text in, the finished message out.
   *
   * This is not a preview and does not behave like one. Every root this
   * scope declares is seeded with the real record, and sample fallback
   * is OFF: a token that resolves to nothing renders as nothing and is
   * reported, where a persona's name in text somebody is about to mail
   * would be indistinguishable from real content.
   *
   * Unknown tokens are reported per field and NOT hidden. The client
   * refuses to apply a render that carries any, because the finished
   * string would contain the evaluator's "[unknown token: …]" marker.
   */
  app.post(
    "/api/comm-compose/render",
    requireAuth,
    requireAccess(COMPOSE_ACCESS_POLICY),
    async (req: any, res) => {
      try {
        const { scope: scopeName, recordId, channel, values } = req.body ?? {};

        if (!isComposeChannel(channel)) {
          res.status(400).json({ message: "Unknown compose channel" });
          return;
        }
        if (!values || typeof values !== "object" || Array.isArray(values)) {
          res.status(400).json({ message: "No field values supplied" });
          return;
        }

        const target = await resolveTarget(req, scopeName, recordId);
        if (!target.ok) {
          res.status(target.status).json({ message: target.message });
          return;
        }
        const { scope } = target;

        // The medium's field specs are the server's, from the ONE
        // shared declaration — never the client's. A caller that could
        // post its own specs could post `syntax: "text"` for an HTML
        // body and have token values land unescaped. A compose screen
        // authors a subset of its medium's fields; the ones it sends no
        // value for are simply not rendered.
        const specs = MEDIUM_FIELDS[channel];
        const templates: Record<string, string> = {};
        for (const spec of specs) {
          const value = (values as Record<string, unknown>)[spec.key];
          if (typeof value === "string") templates[spec.key] = value;
        }
        if (Object.keys(templates).length === 0) {
          res.status(400).json({ message: "No field values supplied" });
          return;
        }

        const preview = await renderTemplatePreview({
          storage,
          fields: specs,
          templates,
          rootNames: scopeRootNames(scope),
          contactId: target.contactId,
          seeds: [
            { name: scope.rootName, entity: target.entity },
            { name: CONTACT_ROOT_NAME, entity: target.contactEntity },
          ],
          // A real render: nothing falls back to a sample persona.
          sample: false,
        });

        const fields: ComposeRenderResponse["fields"] = {};
        for (const [key, field] of Object.entries(preview.fields)) {
          fields[key] = {
            rendered: field.rendered,
            unknownTokens: field.unknownTokens,
            emptyValues: field.emptyValues,
          };
        }

        const response: ComposeRenderResponse = {
          fields,
          recordLabel: target.label,
        };
        res.json(response);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Failed to render the message";
        res.status(500).json({ message });
      }
    },
  );
}

/** The seeded record's own id, as the studio will name it back. */
function rowId(entity: TokenEntity): string {
  const id = entity.row.id;
  return typeof id === "string" ? id : "";
}
