/**
 * Domestic Partner relation-type identification — PURE core, shared between
 * the server DP pricing module (billing + payment gate) and the `worker.dp`
 * access policy (shared policy files must not import server modules).
 *
 * `worker_relations` is strictly subscriber → dependent, so the only fact
 * recorded about a covered dependent that can tell the DP, the DP's
 * children and the member's own dependents apart is the relation TYPE the
 * dependent was enrolled under. These predicates are the ONE reading of
 * that type; change them here and nowhere else.
 */

/**
 * How a covered dependent on a DP election counts toward the coverage tier:
 *   - `dp`       — the domestic partner: never a counted life (the DP is what
 *                  the transition is being priced FOR)
 *   - `dp_child` — a child of the domestic partner, covered because the DP
 *                  was added (the rate sheet's "DP's child/children")
 *   - `own`      — one of the member's own dependents (their children, or any
 *                  other non-DP dependent)
 */
export type DpRelationKind = "dp" | "dp_child" | "own";

/**
 * Identification of the DP's children: BY RELATION TYPE.
 *
 * The Fund's relation-type catalogue (inherited from S1) has Step Child
 * (S1 code SC), and BAO now also supports an explicit DP Child type.
 * A member who is married cannot also have a DP, so on an election that
 * covers a DP a step child is the DP's child. A dedicated type that names
 * the partner's child (e.g. "Domestic Partner's Child", "DP Child") is
 * recognised too, so adding one to the catalogue needs no code change.
 *
 * This mapping follows the 2026 rate sheet's scenarios and the catalogue as
 * they stand; it awaits the Fund's confirmation of how staff record a DP's
 * children (a Step Child relation, or a dedicated type).
 */
export function isDpChildRelationTypeName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return (
    /step[\s-]*child/.test(n) ||
    (/partner/.test(n) && /child/.test(n)) ||
    /\bdp(?:'s)?[\s-]*child/.test(n)
  );
}

/**
 * Whether a relation-type name identifies a domestic-partner relation (the
 * partner themself — a type naming the partner's CHILD is not one).
 */
export function isDpRelationTypeName(name: string | null | undefined): boolean {
  return (
    !!name &&
    name.toLowerCase().includes("domestic partner") &&
    !isDpChildRelationTypeName(name)
  );
}

/** Classify a covered dependent by its relation-type name. */
export function classifyDpRelationTypeName(
  name: string | null | undefined,
): DpRelationKind {
  if (isDpChildRelationTypeName(name)) return "dp_child";
  if (isDpRelationTypeName(name)) return "dp";
  return "own";
}
