import type { IStorage } from "../../storage";
import type { TokenEntityType, TokenPreviewRecordRef } from "./types";
import { listTokenPreviewRoots } from "./preview-roots";
import {
  listSampleSetChoicesForKind,
  type TokenSampleSetChoice,
} from "./sample-sets";
import {
  filterTokenPreviewRecords,
  type TokenPreviewContext,
  type TokenPreviewFilterResult,
} from "./preview-entities";

/**
 * What the Template Studio can preview against, built when the studio
 * OPENS: every root a template's tokens hang off, and per root the
 * sample personas plus the real records that may seed it.
 *
 * THE CONTAINER STATES BOTH LISTS. The roots it names, and the records
 * it has in hand for them, are the whole of what the studio shows.
 * Token land never goes looking: a root the container supplied nothing
 * for has no real records, and the author previews it as a sample
 * persona, which is exactly what personas are for. A studio that
 * answered "no records supplied" by listing the first twenty records of
 * that kind would be previewing a template against records the message
 * it belongs to has never heard of.
 *
 * The list is UX, not the authorization boundary. Every record here
 * has passed its kind's own read gate for this caller, and the render
 * route runs that same gate again on whatever is finally named — so a
 * generous container can never create a read the caller was not
 * entitled to, and a stale list can never become a refusal at render
 * time that the studio failed to predict.
 */

/** One real record the author may seed a root with. */
export interface TokenStudioSeedRecord {
  id: string;
  label: string;
  hint?: string;
  /**
   * Which of the container's occurrences this record came out of — see
   * {@link TokenPreviewRecordRef.occurrenceIds}. Records across roots
   * that share one were true together, so picking one picks them all.
   */
  occurrenceIds?: string[];
}

/** Why a root has no real records to pick from. */
export type TokenStudioNoRecordsReason =
  /**
   * Nothing reached the gate: the container supplied no records for
   * this root, or the kind's component is switched off so its records
   * are not visible anywhere.
   */
  | "none-supplied"
  /** The container supplied records; this caller may read none of them. */
  | "unreadable"
  /**
   * The container pointed at records by id and those records are gone
   * — the events it replayed named rows that have since been deleted.
   */
  | "records-gone"
  /** The kind cannot be previewed against at all — it declares no read. */
  | "not-previewable";

/** One root, with everything the author may render it as. */
export interface TokenStudioContextRoot {
  /** Root NAME — the segment a chain starts with (`dispatch`, `worker`). */
  name: string;
  kind: TokenEntityType;
  label: string;
  /** Named personas for this root's kind; never empty. */
  samples: TokenSampleSetChoice[];
  /**
   * Real records that may seed this root, already gated for this
   * caller. Empty means personas only — and {@link noRecords} says
   * which of the several reasons for that this one is.
   */
  records: TokenStudioSeedRecord[];
  /** Why `records` is empty; absent whenever there are records. */
  noRecords?: {
    reason: TokenStudioNoRecordsReason;
    /** The container's own words for an empty list it supplied. */
    note?: string;
    /** The kind's refusal, when it cannot be previewed at all. */
    detail?: string;
  };
}

export interface TokenStudioContext {
  roots: TokenStudioContextRoot[];
}

/** How many of a container's records one root shows. */
export const STUDIO_CONTEXT_RECORD_LIMIT = 20;

export interface BuildTokenStudioContextOptions {
  /**
   * The COMPLETE ordered list of roots this container states, by root
   * NAME. It is the panel the author sees, top to bottom, so
   * lead with the record the templates are really about. Nothing is
   * added implicitly — a container whose templates are about the
   * recipient asks for the recipient-side roots by name, the same way
   * one with records of its own asks for those.
   */
  rootNames?: string[];
  /**
   * Records the container has in hand, keyed by ROOT NAME — the ONLY
   * real records the studio will show. They are gated per record
   * before the author sees them.
   *
   * A root left out of this map (a notifier config is about events that
   * have not happened, so it holds no record) is previewed as a sample
   * persona and nothing else.
   */
  recordsByRoot?: Record<string, TokenPreviewRecordRef[]>;
  /**
   * The container's own words for why it supplied no records for a
   * root ("this message has no recipients yet"), keyed by root name.
   * Only the container knows that reason, and it is the honest thing to
   * show where the picker would be — but it is narration, not
   * behaviour: the rule above is the same with or without it.
   */
  emptyRecordsNotes?: Record<string, string>;
  limit?: number;
}

export async function buildTokenStudioContext(
  ctx: TokenPreviewContext & { storage: IStorage },
  options: BuildTokenStudioContextOptions = {},
): Promise<TokenStudioContext> {
  const limit = options.limit ?? STUDIO_CONTEXT_RECORD_LIMIT;
  const supplied = options.recordsByRoot ?? {};
  // A container that names no roots has said nothing to preview
  // against, which is never what it meant: the list is the panel. Since
  // nothing is added implicitly any more, say so loudly here rather than
  // shipping an empty "Preview With" to the author.
  if (!options.rootNames?.length) {
    throw new Error(
      "buildTokenStudioContext needs the complete list of roots this container states, by root name",
    );
  }

  const notes = options.emptyRecordsNotes ?? {};

  const roots = await Promise.all(
    listTokenPreviewRoots(options.rootNames ?? []).map(
      async (root): Promise<TokenStudioContextRoot> => {
        const own = supplied[root.name] ?? [];
        const gated = await filterTokenPreviewRecords(
          root.kind,
          own,
          limit,
          ctx,
        );
        // Only what the author picks from: `gateEntityId` is how the
        // gate found its subject, not something a client needs.
        const records = gated.ok
          ? gated.records.map((r) => ({
              id: r.id,
              label: r.label,
              ...(r.hint ? { hint: r.hint } : {}),
              ...(r.occurrenceIds?.length
                ? { occurrenceIds: r.occurrenceIds }
                : {}),
            }))
          : [];
        return {
          name: root.name,
          kind: root.kind,
          label: root.label,
          samples: listSampleSetChoicesForKind(root.kind),
          records,
          ...(records.length === 0
            ? { noRecords: describeNoRecords(gated, notes[root.name]) }
            : {}),
        };
      },
    ),
  );

  return { roots };
}

/**
 * Why a root ended up with no records. "The container had none", "it
 * had some and you may not read them", "what it pointed at is gone" and
 * "this kind cannot be previewed at all" are four different answers,
 * and a studio that showed one message for all four would be guessing
 * on the author's behalf.
 *
 * The container's note only fits the first: it is that container
 * explaining its own empty hands ("this message has no recipients
 * yet"). When the records it named have since been deleted, the note it
 * wrote for an empty list would be a false explanation, so the reason
 * speaks for itself instead.
 */
function describeNoRecords(
  gated: TokenPreviewFilterResult,
  note: string | undefined,
): NonNullable<TokenStudioContextRoot["noRecords"]> {
  if (!gated.ok) {
    return { reason: "not-previewable", detail: gated.message };
  }
  if (gated.considered > 0) return { reason: "unreadable" };
  if (gated.missing > 0) return { reason: "records-gone" };
  return { reason: "none-supplied", ...(note ? { note } : {}) };
}
