import type { Request } from "express";
import type { IStorage } from "../../storage";
import { tokenPluginRegistry } from "./registry";
import type {
  TokenEntity,
  TokenEntityType,
  TokenPreviewEntitySource,
  TokenPreviewGate,
  TokenPreviewNamedRecordRef,
  TokenPreviewRecordRef,
} from "./types";

/**
 * Which token entity kinds may stand behind a preview context, and how
 * reading one of their records is gated.
 *
 * Previewing a template against a real record is a READ of that record.
 * It is therefore gated exactly like any other read of it: the kind's
 * owning token plugin declares how a read is authorized, and BOTH the
 * records a container puts forward as seeds and the load-by-id run that
 * same gate on the same subject id the record yields — so the check can
 * never end up guarding a different record than the one seeded.
 *
 * No kind can produce records of its own. Records reach a preview from
 * the container that opened the studio and from nowhere else; a kind
 * only says how one is authorized and how to load one by id.
 *
 * FAIL CLOSED: a kind with no declaration cannot be used as a preview
 * context at all. Adding a token entity kind therefore does not quietly
 * add a new way to read its records — that takes a deliberate
 * declaration saying how it is gated.
 *
 * Declarations live in `previewEntity` on the token plugin that owns
 * the kind; this module projects the registry into a per-kind map,
 * rebuilt on demand so lazily registered plugins are picked up without
 * a restart.
 */
interface RegisteredPreviewEntity {
  pluginId: string;
  source: TokenPreviewEntitySource;
  /**
   * Component gate: the source's own `requiredComponent`, falling back
   * to the declaring plugin's. A component-owned kind is therefore
   * gated by default — its tables can be absent from the database
   * entirely, so an unguarded load errors rather than refusing.
   */
  requiredComponent?: string;
}

function collectPreviewEntities(): Map<TokenEntityType, RegisteredPreviewEntity> {
  const map = new Map<TokenEntityType, RegisteredPreviewEntity>();
  // list() (not listEnabledSync) — component state gates ACCESS, below;
  // a disabled component's kind still has exactly one declaration.
  for (const plugin of tokenPluginRegistry.list()) {
    const source = plugin.metadata.previewEntity;
    if (!source) continue;
    const kind = plugin.metadata.outputType;
    if (map.has(kind)) {
      throw new Error(
        `Two token plugins declare a preview entity source for kind "${kind}" ` +
          `(${plugin.metadata.id} is the second) — declare it once, on the ` +
          `plugin that owns the kind.`,
      );
    }
    map.set(kind, {
      pluginId: plugin.metadata.id,
      source,
      requiredComponent:
        source.requiredComponent ?? plugin.metadata.requiredComponent,
    });
  }
  return map;
}

/**
 * Build the projection once at boot so a duplicate declaration fails
 * loudly at startup instead of at the first preview request.
 */
export function validateTokenPreviewEntities(): number {
  return collectPreviewEntities().size;
}

/**
 * Whom a seeded record is addressed to, when its kind says (see
 * `recipientContactIdOf`). The kind's owner declares it once, beside
 * the gate, so a preview seeded with a send resolves the recipient
 * roots from the same person delivery would.
 */
export function recipientContactIdForEntity(
  entity: TokenEntity,
): string | undefined {
  const of = collectPreviewEntities().get(entity.kind)?.source
    .recipientContactIdOf;
  const id = of?.(entity.row);
  return typeof id === "string" && id ? id : undefined;
}

/** Kinds that currently declare how they are gated, for diagnostics. */
export function listTokenPreviewEntityKinds(): TokenEntityType[] {
  return [...collectPreviewEntities().keys()].sort();
}

/** What a kind declares, for the author-time gating check. */
export function describeTokenPreviewEntities(): Array<{
  kind: TokenEntityType;
  pluginId: string;
  gate: TokenPreviewGate;
  requiredComponent?: string;
  hasLoad: boolean;
}> {
  return [...collectPreviewEntities().entries()]
    .map(([kind, entry]) => ({
      kind,
      pluginId: entry.pluginId,
      gate: entry.source.gate,
      requiredComponent: entry.requiredComponent,
      hasLoad: typeof entry.source.load === "function",
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

/**
 * The per-record read check.
 *
 * Injectable so the enforcement itself can be tested against a caller
 * whose permissions are known, without standing up a user and a policy
 * registry. Production always uses `checkAccessInline`, which is the
 * very evaluator every other read of these records goes through.
 */
export type TokenPreviewAccessCheck = (
  policy: string,
  entityId?: string,
) => Promise<{ granted: boolean; reason?: string }>;

export interface TokenPreviewContext {
  storage: IStorage;
  req: Request;
  /** Test seam — see {@link TokenPreviewAccessCheck}. */
  checkAccess?: TokenPreviewAccessCheck;
}

function accessChecker(ctx: TokenPreviewContext): TokenPreviewAccessCheck {
  if (ctx.checkAccess) return ctx.checkAccess;
  return async (policy, entityId) => {
    const { checkAccessInline } = await import(
      "../../services/access-policy-evaluator"
    );
    return checkAccessInline(ctx.req, policy, entityId);
  };
}

/** Component state — the same gate that hides a switched-off kind today. */
async function componentAllows(
  entry: RegisteredPreviewEntity,
): Promise<boolean> {
  if (!entry.requiredComponent) return true;
  const { isComponentEnabled } = await import("../../modules/components");
  return isComponentEnabled(entry.requiredComponent);
}

/**
 * Run a kind's gate for one record.
 *
 * A `route` gate carries no id — it is the broad page gate — so it is
 * asked once and the answer applies to every record of the kind. A
 * `record` gate is asked per record, on the subject id that record
 * yields.
 */
async function gateAllows(
  gate: TokenPreviewGate,
  check: TokenPreviewAccessCheck,
  subjectId: string | undefined,
  routeAnswer?: { granted: boolean; reason?: string },
): Promise<{ granted: boolean; reason?: string }> {
  if (gate.scope === "route") {
    return routeAnswer ?? check(gate.policy);
  }
  // A record-scoped policy with nothing to evaluate against would fall
  // back to the policy's id-less behaviour, which for these policies is
  // "load nothing, grant nothing sensible" — refuse instead of guessing.
  if (!subjectId) {
    return { granted: false, reason: "Record has nothing to authorize against" };
  }
  return check(gate.policy, subjectId);
}

/** What the gate left of the records a container supplied. */
export type TokenPreviewFilterResult =
  | {
      ok: true;
      records: TokenPreviewNamedRecordRef[];
      /**
       * How many of the container's candidates REACHED the gate. It is
       * the difference between "the container had none" and "it had
       * some and you may not read them" — two answers a studio has to
       * tell apart to say why a root has no records.
       *
       * Zero when the container supplied nothing, and equally zero when
       * a switched-off component means its records are not visible at
       * all: neither is a refusal aimed at this caller, so both read to
       * the author as "there was nothing here".
       */
      considered: number;
      /**
       * How many candidates named an id whose record is no longer there
       * — only ever nonzero for the unlabelled refs the kind is asked
       * to name. It is the third answer: not "none were supplied" and
       * not "you may not read them", but "what these pointed at is
       * gone".
       */
      missing: number;
    }
  | { ok: false; status: number; message: string };

/**
 * Keep only the records this caller may actually read, naming any the
 * container left unnamed.
 *
 * The candidates are always a container's own (a bulk message's
 * recipients, say): no seed reaches an author that they could not open
 * elsewhere in the app. Deciding who may see a record stays here, so a
 * container cannot hand-roll its own idea of authorization by supplying
 * its own list.
 *
 * A candidate with no label is one the container could only point at:
 * the kind's own load then supplies both its name and the subject its
 * gate is asked about, and a candidate whose record has since gone is
 * dropped. That load is the same one the render performs, so the picker
 * offers exactly what a render would accept.
 */
export async function filterTokenPreviewRecords(
  kind: TokenEntityType,
  candidates: TokenPreviewRecordRef[],
  limit: number,
  ctx: TokenPreviewContext,
): Promise<TokenPreviewFilterResult> {
  const entry = collectPreviewEntities().get(kind);
  if (!entry) {
    return {
      ok: false,
      status: 400,
      message: `Records of kind "${kind}" cannot be used as a preview context`,
    };
  }
  if (!(await componentAllows(entry))) {
    // Same answer a switched-off component gives everywhere else: none
    // of its data is visible, so nothing survives. Nothing was
    // considered either — a switched-off component is not a refusal
    // aimed at this caller.
    return { ok: true, records: [], considered: 0, missing: 0 };
  }

  const check = accessChecker(ctx);
  const gate = entry.source.gate;

  // A route gate carries no subject, so it is answered before anything
  // is read — including before an unnamed candidate is loaded to be
  // named. A refusal here is about the kind, not about which records
  // happen to still exist.
  if (gate.scope === "route") {
    const answer = await check(gate.policy);
    if (!answer.granted) {
      return { ok: true, records: [], considered: candidates.length, missing: 0 };
    }
  }

  const named = await nameCandidates(entry, candidates, ctx);
  const missing = candidates.length - named.length;

  if (gate.scope === "route") {
    return {
      ok: true,
      records: named.slice(0, limit),
      considered: named.length,
      missing,
    };
  }

  const verdicts = await Promise.all(
    named.map((record) =>
      gateAllows(gate, check, record.gateEntityId ?? record.id).then(
        (r) => r.granted,
      ),
    ),
  );
  const records = named.filter((_, i) => verdicts[i]).slice(0, limit);
  return { ok: true, records, considered: named.length, missing };
}

/**
 * Give every candidate a name, asking the kind about the ones the
 * container could only point at.
 *
 * Dropping a candidate whose record no longer loads is the point: an
 * id can outlive its row (a replayed event names the record it fired
 * for, which may since have been deleted), and offering a picker row
 * that renders nothing would be a worse answer than leaving it out and
 * saying so. A load that throws is treated the same way — one broken
 * candidate must not cost the author the whole editor — and is logged,
 * because a load that throws is a bug in that kind.
 */
async function nameCandidates(
  entry: RegisteredPreviewEntity,
  candidates: TokenPreviewRecordRef[],
  ctx: TokenPreviewContext,
): Promise<TokenPreviewNamedRecordRef[]> {
  const resolved = await Promise.all(
    candidates.map(async (record) => {
      if (record.label !== undefined) {
        return record as TokenPreviewNamedRecordRef;
      }
      try {
        const loaded = await entry.source.load(ctx.storage, record.id);
        if (!loaded) return null;
        return {
          ...record,
          label: loaded.label,
          gateEntityId: record.gateEntityId ?? loaded.gateEntityId,
        };
      } catch (error) {
        const { logger } = await import("../../logger");
        logger.warn("Token preview candidate failed to load", {
          service: "token-preview",
          pluginId: entry.pluginId,
          recordId: record.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }),
  );
  return resolved.filter((r): r is TokenPreviewNamedRecordRef => r !== null);
}

export type TokenPreviewEntityResult =
  | { ok: true; entity: TokenEntity; label: string }
  | { ok: false; status: number; message: string };

/**
 * Resolve one named record into the entity a preview can be seeded
 * with, refusing at the first thing that isn't allowed.
 *
 * The record is loaded before the record-scoped gate runs, because the
 * subject the gate asks about lives ON the record (a status entry is
 * read as a read of its grievance). Nothing loaded is ever handed back
 * until the gate says yes.
 *
 * Returns a result rather than throwing so the calling route decides
 * the HTTP shape; every refusal is a refusal, never a silent fallback
 * to sample data, because "your record didn't load so here's a fake
 * one" is exactly the confusion a preview must not create.
 */
export async function resolveTokenPreviewEntity(
  kind: TokenEntityType,
  id: string,
  ctx: TokenPreviewContext,
): Promise<TokenPreviewEntityResult> {
  const entry = collectPreviewEntities().get(kind);
  if (!entry) {
    return {
      ok: false,
      status: 400,
      message: `Records of kind "${kind}" cannot be used as a preview context`,
    };
  }
  if (!(await componentAllows(entry))) {
    return {
      ok: false,
      status: 400,
      message: `Records of kind "${kind}" cannot be used as a preview context`,
    };
  }

  const check = accessChecker(ctx);
  const gate = entry.source.gate;

  // A route gate has no subject, so it can be answered before anything
  // is read at all.
  if (gate.scope === "route") {
    const answer = await check(gate.policy);
    if (!answer.granted) {
      return {
        ok: false,
        status: 403,
        message: answer.reason || "You may not preview against that record",
      };
    }
  }

  const loaded = await entry.source.load(ctx.storage, id);
  if (!loaded) {
    return { ok: false, status: 404, message: "Record not found" };
  }

  if (gate.scope === "record") {
    const answer = await gateAllows(
      gate,
      check,
      loaded.gateEntityId ?? id,
    );
    if (!answer.granted) {
      return {
        ok: false,
        status: 403,
        message: answer.reason || "You may not preview against that record",
      };
    }
  }

  return { ok: true, entity: loaded.entity, label: loaded.label };
}

/**
 * Kinds a caller may currently pick a record for: declared, and their
 * component switched on. What the caller may READ is decided per record
 * by the gate — this only says which kinds have a picker at all.
 */
export async function listPickableTokenPreviewKinds(): Promise<Set<TokenEntityType>> {
  const out = new Set<TokenEntityType>();
  for (const [kind, entry] of collectPreviewEntities()) {
    if (await componentAllows(entry)) out.add(kind);
  }
  return out;
}
