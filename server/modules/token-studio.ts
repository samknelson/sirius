import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
import type { TokenRootSeed } from "../plugins/tokens/types";
import type { TokenPreviewRoot } from "../plugins/tokens/preview-roots";
import type { DeliveryFieldSpec } from "@shared/delivery-fields";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

/**
 * Template Studio endpoints: the token catalog and THE ONE preview
 * route every tokenized field renders through.
 *
 * The preview request describes itself completely — the template text
 * to render, how each field is shaped at delivery time, and the context
 * to render it against. Nothing is registered anywhere and the server
 * never looks up "who is asking": adding a tokenized field somewhere
 * new takes no registration step of any kind.
 *
 * A preview renders against NAMED SAMPLE DATA by default. A caller with
 * a real record in hand may name it instead, by kind and id — and that
 * is a read of the record, so it is gated exactly like any other read
 * of it (see `server/plugins/tokens/preview-entities.ts`).
 */
/** `?roots=dispatch,event` — the named context roots the caller seeds. */
function parseRootNames(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const name of value.split(",")) {
      const trimmed = name.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

type ResolvedPreviewContext =
  | { seeds?: TokenRootSeed[]; sampleSetIds?: Record<string, string> }
  | { status: number; message: string };

/**
 * The one form a preview context comes in, named in every refusal so a
 * caller that gets the shape wrong is told what the shape is.
 */
const PREVIEW_CONTEXT_FORM = `{ seeds: [{ rootName, record: { kind, id } } | { rootName, sampleSetId }] }`;

/**
 * `seeds: [ … ]` — what each root renders as: one entry per root, and
 * each entry names EITHER a real record or a sample persona.
 *
 * One entry per root because a root renders as one thing. A named
 * record is resolved and gated INDIVIDUALLY — per kind, per record,
 * through the kind's own `previewEntity` declaration — so a preview can
 * mix real roots with sample ones and a kind that has declared nothing
 * about how it is gated cannot be named at all. A named persona is
 * checked against what its root's kind actually declares, because a
 * preview that silently rendered a different persona than the one asked
 * for would be describing somebody else's data.
 */
async function resolveSeeds(
  raw: unknown,
  available: TokenPreviewRoot[],
  ctx: { storage: IStorage; req: Request },
): Promise<ResolvedPreviewContext> {
  if (!Array.isArray(raw)) {
    return { status: 400, message: "Preview context seeds must be an array" };
  }
  if (raw.length === 0) return {};

  const [{ resolveTokenPreviewEntity }, { listSampleSetChoicesForKind }] =
    await Promise.all([
      import("../plugins/tokens/preview-entities"),
      import("../plugins/tokens/sample-sets"),
    ]);

  const seeds: TokenRootSeed[] = [];
  const sampleSetIds: Record<string, string> = {};
  const seen = new Set<string>();
  for (const rawSeed of raw) {
    if (!rawSeed || typeof rawSeed !== "object" || Array.isArray(rawSeed)) {
      return { status: 400, message: "Invalid preview context seed" };
    }
    const seed = rawSeed as Record<string, unknown>;
    const rootName = typeof seed.rootName === "string" ? seed.rootName : "";
    const root = available.find((r) => r.name === rootName);
    if (!root) {
      return {
        status: 400,
        message: `No preview root named "${rootName}"`,
      };
    }
    if (seen.has(root.name)) {
      return {
        status: 400,
        message: `Preview root "${root.name}" is seeded more than once`,
      };
    }
    seen.add(root.name);

    const hasRecord = seed.record !== undefined && seed.record !== null;
    const hasSample = seed.sampleSetId !== undefined && seed.sampleSetId !== null;
    if (hasRecord === hasSample) {
      return {
        status: 400,
        message:
          `Preview root "${root.name}" must name either a record or a ` +
          `sample persona, not ${hasRecord ? "both" : "neither"}`,
      };
    }

    if (hasSample) {
      const sampleSetId = seed.sampleSetId;
      if (typeof sampleSetId !== "string" || !sampleSetId) {
        return { status: 400, message: "A preview sample persona needs an id" };
      }
      const offered = listSampleSetChoicesForKind(root.kind);
      if (!offered.some((choice) => choice.id === sampleSetId)) {
        return {
          status: 400,
          message:
            `Preview root "${root.name}" has no sample persona ` +
            `"${sampleSetId}"`,
        };
      }
      sampleSetIds[root.name] = sampleSetId;
      continue;
    }

    const record = seed.record as Record<string, unknown>;
    if (typeof record !== "object" || Array.isArray(record)) {
      return { status: 400, message: "Invalid preview context record" };
    }
    const kind = typeof record.kind === "string" ? record.kind : "";
    const id = typeof record.id === "string" ? record.id : "";
    if (!kind || !id) {
      return {
        status: 400,
        message: "A preview context record needs a kind and an id",
      };
    }
    if (kind !== root.kind) {
      return {
        status: 400,
        message:
          `Preview root "${root.name}" takes a record of kind ` +
          `"${root.kind}", not "${kind}"`,
      };
    }

    const result = await resolveTokenPreviewEntity(kind, id, {
      storage: ctx.storage,
      req: ctx.req,
    });
    if (!result.ok) return { status: result.status, message: result.message };

    seeds.push({ name: root.name, entity: result.entity });
  }

  // A seeded contact is also the render's recipient, exactly as on
  // delivery; `renderTemplatePreview` derives that from the seed.
  return { seeds, sampleSetIds };
}

/**
 * Turn the request's `context` into render seeds.
 *
 * ONE form, because there is only one kind of thing a preview renders
 * against: REAL records. Seeding one is a read of it, so the kind's own
 * declaration decides whether this caller may read it, and an
 * undeclared kind is refused rather than assumed safe.
 *
 * A shape this route no longer has is REFUSED, not ignored. A caller
 * sending one is describing a render it will not get, and quietly
 * rendering something else would be the lie a preview must never tell.
 */
async function resolvePreviewContext(
  raw: unknown,
  ctx: { storage: IStorage; req: Request; rootNames: string[] },
): Promise<ResolvedPreviewContext> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { status: 400, message: "Invalid preview context" };
  }
  const context = raw as Record<string, unknown>;
  // PRESENCE, not truthiness: `{"entity": null}` is valid JSON, and a
  // key that is present but empty is still a caller describing a shape
  // this route no longer has. Own-property so an inherited key can't
  // masquerade as one the caller sent.
  const sent = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(context, key);

  // A single record used to be its own notation, identical to a
  // one-element list.
  if (sent("entity")) {
    return {
      status: 400,
      message:
        `A preview context has no single "entity" form — give ` +
        PREVIEW_CONTEXT_FORM,
    };
  }

  // Records used to be the only thing a context could name, with the
  // persona chosen once for the whole render. Now every root says what
  // it renders as, so records arrive as seeds alongside personas.
  if (sent("entities")) {
    return {
      status: 400,
      message:
        `A preview context no longer takes an "entities" list — say what ` +
        `each root renders as: ` +
        PREVIEW_CONTEXT_FORM,
    };
  }

  // Raw root VALUES used to be a second form, trusted differently
  // because they reached no record. Nothing ever sent them, so they are
  // gone — along with the guards that kept them from reaching one.
  if (sent("roots")) {
    return {
      status: 400,
      message:
        `A preview context no longer takes raw root values — name the ` +
        `records to render against: ` +
        PREVIEW_CONTEXT_FORM,
    };
  }

  // The discriminant existed only to choose between those two trust
  // levels. With one form there is nothing to discriminate.
  if (sent("source")) {
    return {
      status: 400,
      message:
        `A preview context has only one form and does not name it — ` +
        `give ` +
        PREVIEW_CONTEXT_FORM,
    };
  }

  const { listTokenPreviewRoots } = await import(
    "../plugins/tokens/preview-roots"
  );
  const available = listTokenPreviewRoots(ctx.rootNames);
  if (!sent("seeds")) {
    return {
      status: 400,
      message: `A preview context names what each root renders as: ` + PREVIEW_CONTEXT_FORM,
    };
  }
  return resolveSeeds(context.seeds, available, ctx);
}

export function registerTokenStudioRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage,
) {
  /**
   * Token catalog for the generic studio. `?roots=a,b` is REQUIRED and
   * names the complete list of roots the caller's templates may address
   * (`contact`, `dispatch`, `event`, …), in the order its author sees
   * them. Nothing is added implicitly: a caller that names no roots has
   * not said what its templates are about, and answering with "every
   * root there is" is how a surface ends up showing records it has
   * never heard of.
   *
   * Carries the studio's own context — what each root may be previewed
   * as — so the studio opens ready to preview, with no second request
   * and no search box. A generic caller has no particular records in
   * hand and this route supplies none on its behalf, so each root is
   * previewed as a sample persona. A container that does hold records
   * builds the context itself and passes them in.
   */
  app.get(
    "/api/token-studio/catalog",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const {
          buildSegmentSpecsForRoots,
          buildFieldCatalog,
          buildTokenCatalogForRoots,
        } = await import("../plugins/tokens");
        const { buildTokenStudioContext } = await import(
          "../plugins/tokens/studio-context"
        );
        const rootNames = parseRootNames(req.query.roots);
        if (rootNames.length === 0) {
          return res.status(400).json({
            message:
              "roots is required: name the roots these templates address, e.g. ?roots=contact,system",
          });
        }
        res.json({
          rootNames,
          segments: buildSegmentSpecsForRoots(rootNames),
          fields: buildFieldCatalog(),
          tokens: buildTokenCatalogForRoots(rootNames),
          // The roots the caller named, and only those: the seed panel
          // is the same list as the browser, so an author cannot preview
          // against a record their tokens can't address. No records are
          // supplied here — see above.
          studioContext: await buildTokenStudioContext(
            { storage, req },
            { rootNames },
          ),
        });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to load token catalog" });
      }
    },
  );

  /**
   * The token tree's ROOTS — one node per root the author may start a
   * chain at, exactly the ones `?roots=` names (required, same as the
   * catalog). The picker expands a node lazily through
   * `/api/token-studio/tree/type/:type`, so a deep relation graph costs
   * one small request per level instead of one giant catalog.
   */
  app.get(
    "/api/token-studio/tree/roots",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const { listTokenTreeRoots } = await import("../plugins/tokens");
        const rootNames = parseRootNames(req.query.roots);
        if (rootNames.length === 0) {
          return res.status(400).json({
            message:
              "roots is required: name the roots these templates address, e.g. ?roots=contact,system",
          });
        }
        res.json({ roots: listTokenTreeRoots(rootNames) });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to load token tree" });
      }
    },
  );

  /** One level of the token tree: what an entity type offers next. */
  app.get(
    "/api/token-studio/tree/type/:type",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const { expandTokenType } = await import("../plugins/tokens");
        res.json(expandTokenType(req.params.type));
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to expand token type" });
      }
    },
  );

  /**
   * Search the tree: `?roots=a,b&q=ssn`. Matches root,
   * relation and field names at any depth and returns each hit with the
   * complete token expression and its path, so the picker never has to
   * pull the whole graph down to offer search.
   */
  app.get(
    "/api/token-studio/tree/search",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const { searchTokenTree } = await import("../plugins/tokens");
        const q = typeof req.query.q === "string" ? req.query.q : "";
        const rootNames = parseRootNames(req.query.roots);
        if (rootNames.length === 0) {
          return res.status(400).json({
            message:
              "roots is required: name the roots these templates address, e.g. ?roots=contact,system",
          });
        }
        res.json({ hits: searchTokenTree(rootNames, q) });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to search tokens" });
      }
    },
  );

  /**
   * THE preview route. POST body (JSON):
   *   `fields` — the fields being previewed and how DELIVERY shapes
   *     each one, taken from the shared delivery declarations in
   *     `shared/delivery-fields.ts` (never hand-written): a field with
   *     no declared syntax has no defined cleaning or shaping, so its
   *     preview and its delivered output could silently disagree, and
   *     it is rejected here.
   *   `values` — { fieldKey: template } — FINISHED template strings.
   *     Any caller-specific composition (a notifier's default-vs-override
   *     merge, a rich-text body flattened to plain text) has already
   *     happened on the caller's side.
   *   `rootNames` — the named record roots those templates address
   *     (`dispatch`, `event`); ordinary roots are always available.
   *   `context` — what each root renders as, one entry per root:
   *     `{ seeds: [{ rootName, record: { kind, id } } |
   *                { rootName, sampleSetId }, …] }`.
   *     Naming a record is a read of it, so the kind's own
   *     `previewEntity` declaration gates each one before it is seeded,
   *     and a kind that has not declared how it is gated cannot be used
   *     at all. Roots left out keep sample data.
   *   Omit `context` to preview every root against sample data.
   */
  app.post(
    "/api/template-studio/preview",
    requireAuth,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const body = req.body ?? {};

        // Field declarations, validated exactly as the author-time
        // check validates the shared tables they come from.
        const { validateDeliveryFieldSpecs } = await import(
          "@shared/delivery-fields"
        );
        const problems = validateDeliveryFieldSpecs(body.fields);
        if (problems.length > 0) {
          return res
            .status(400)
            .json({ message: `Invalid preview fields: ${problems.join("; ")}` });
        }
        const fields = body.fields as DeliveryFieldSpec[];

        const templates: Record<string, string> = {};
        const rawValues =
          body.values && typeof body.values === "object" ? body.values : {};
        for (const [key, value] of Object.entries(rawValues)) {
          if (typeof value === "string") templates[key] = value;
        }

        const rootNames = parseRootNames(body.rootNames);

        // The persona used to be chosen once for the whole render.
        // It is now per root, inside the context — refused by PRESENCE
        // here for the same reason every retired shape is: a caller
        // sending it is describing a render it will not get.
        if (Object.prototype.hasOwnProperty.call(body, "sampleSetId")) {
          return res.status(400).json({
            message:
              `A preview no longer takes one sample persona for the whole ` +
              `render — each root names its own: ${PREVIEW_CONTEXT_FORM}`,
          });
        }

        const resolved = await resolvePreviewContext(body.context, {
          storage,
          req,
          rootNames,
        });
        if ("status" in resolved) {
          return res.status(resolved.status).json({ message: resolved.message });
        }

        const { renderTemplatePreview } = await import("./template-preview");
        const preview = await renderTemplatePreview({
          storage,
          fields,
          templates,
          rootNames,
          seeds: resolved.seeds,
          sampleSetIds: resolved.sampleSetIds,
        });
        res.json(preview);
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to render preview" });
      }
    },
  );
}
