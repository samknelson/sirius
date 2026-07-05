import { getClient, runInTransaction } from "../transaction-context";
import {
  grievanceContracts,
  grievanceContractSections,
  contracts,
  contractArticles,
  contractSections,
} from "@shared/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";

/** The contract a grievance is linked to, with its display name. */
export interface GrievanceContractLink {
  contractId: string;
  contractName: string;
}

/** A linked contract section, flattened with its owning article's display info. */
export interface GrievanceLinkedSection {
  /** The `grievance_contract_sections` link row id (used for remove/reorder). */
  id: string;
  sectionId: string;
  sectionNumber: string | null;
  name: string;
  isStub: boolean;
  sequence: number;
  articleId: string;
  articleNumber: string | null;
  articleName: string;
}

/** A section within the picker catalog. */
export interface CatalogSection {
  id: string;
  sectionNumber: string | null;
  name: string;
  body: string | null;
  isStub: boolean;
  sequence: number;
}

/** An article (with its sections) within the picker catalog. */
export interface CatalogArticle {
  id: string;
  articleNumber: string | null;
  name: string;
  sequence: number;
  sections: CatalogSection[];
}

export type MoveDirection = "up" | "down";

export type SetContractResult =
  | { ok: true }
  | { error: "contract-not-found" | "has-sections" };

export type ClearContractResult = { ok: true } | { error: "has-sections" };

export type AddSectionsResult =
  | { ok: true; sections: GrievanceLinkedSection[] }
  | { error: "no-contract" | "invalid-section" };

/**
 * Storage for the grievance ↔ contract association. Owned by the
 * `grievance.contract` component. A grievance links to at most one contract
 * (`grievance_contracts`, unique per grievance) and an ordered set of that
 * contract's sections (`grievance_contract_sections`).
 *
 * Invariants enforced here (never in the route layer):
 *  - The contract cannot be changed or cleared while any sections are linked —
 *    the caller must remove the sections first (hard block).
 *  - Every linked section must belong to the grievance's chosen contract.
 *
 * Every method takes `grievanceId` as its first argument so writes are
 * attributed to the grievance as the host entity in the activity log.
 */
export interface GrievanceContractStorage {
  getLink(grievanceId: string): Promise<GrievanceContractLink | undefined>;
  getSections(grievanceId: string): Promise<GrievanceLinkedSection[]>;
  /**
   * The linked contract's full article/section outline for the section picker,
   * or `undefined` when no contract is linked yet.
   */
  getCatalog(grievanceId: string): Promise<CatalogArticle[] | undefined>;
  setContract(grievanceId: string, contractId: string): Promise<SetContractResult>;
  clearContract(grievanceId: string): Promise<ClearContractResult>;
  addSections(grievanceId: string, sectionIds: string[]): Promise<AddSectionsResult>;
  removeSection(grievanceId: string, linkId: string): Promise<boolean>;
  moveSection(
    grievanceId: string,
    linkId: string,
    direction: MoveDirection,
  ): Promise<GrievanceLinkedSection[]>;
}

export function createGrievanceContractStorage(): GrievanceContractStorage {
  async function listSections(grievanceId: string): Promise<GrievanceLinkedSection[]> {
    const client = getClient();
    return client
      .select({
        id: grievanceContractSections.id,
        sectionId: grievanceContractSections.sectionId,
        sectionNumber: contractSections.sectionNumber,
        name: contractSections.name,
        isStub: contractSections.isStub,
        sequence: grievanceContractSections.sequence,
        articleId: contractArticles.id,
        articleNumber: contractArticles.articleNumber,
        articleName: contractArticles.name,
      })
      .from(grievanceContractSections)
      .innerJoin(
        contractSections,
        eq(grievanceContractSections.sectionId, contractSections.id),
      )
      .innerJoin(contractArticles, eq(contractSections.articleId, contractArticles.id))
      .where(eq(grievanceContractSections.grievanceId, grievanceId))
      .orderBy(asc(grievanceContractSections.sequence), asc(grievanceContractSections.id));
  }

  return {
    async getLink(grievanceId: string): Promise<GrievanceContractLink | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          contractId: grievanceContracts.contractId,
          contractName: contracts.name,
        })
        .from(grievanceContracts)
        .innerJoin(contracts, eq(grievanceContracts.contractId, contracts.id))
        .where(eq(grievanceContracts.grievanceId, grievanceId));
      return row || undefined;
    },

    getSections: listSections,

    async getCatalog(grievanceId: string): Promise<CatalogArticle[] | undefined> {
      const client = getClient();
      const [link] = await client
        .select({ contractId: grievanceContracts.contractId })
        .from(grievanceContracts)
        .where(eq(grievanceContracts.grievanceId, grievanceId));
      if (!link) return undefined;

      const articles = await client
        .select({
          id: contractArticles.id,
          articleNumber: contractArticles.articleNumber,
          name: contractArticles.name,
          sequence: contractArticles.sequence,
        })
        .from(contractArticles)
        .where(eq(contractArticles.contractId, link.contractId))
        .orderBy(asc(contractArticles.sequence), asc(contractArticles.id));

      if (articles.length === 0) return [];

      const sections = await client
        .select({
          id: contractSections.id,
          articleId: contractSections.articleId,
          sectionNumber: contractSections.sectionNumber,
          name: contractSections.name,
          body: contractSections.body,
          isStub: contractSections.isStub,
          sequence: contractSections.sequence,
        })
        .from(contractSections)
        .innerJoin(contractArticles, eq(contractSections.articleId, contractArticles.id))
        .where(eq(contractArticles.contractId, link.contractId))
        .orderBy(asc(contractSections.sequence), asc(contractSections.id));

      const byArticle = new Map<string, CatalogSection[]>();
      for (const s of sections) {
        const arr = byArticle.get(s.articleId) ?? [];
        arr.push({
          id: s.id,
          sectionNumber: s.sectionNumber,
          name: s.name,
          body: s.body,
          isStub: s.isStub,
          sequence: s.sequence,
        });
        byArticle.set(s.articleId, arr);
      }

      return articles.map((a) => ({
        id: a.id,
        articleNumber: a.articleNumber,
        name: a.name,
        sequence: a.sequence,
        sections: byArticle.get(a.id) ?? [],
      }));
    },

    async setContract(
      grievanceId: string,
      contractId: string,
    ): Promise<SetContractResult> {
      return runInTransaction(async () => {
        const client = getClient();

        const [contract] = await client
          .select({ id: contracts.id })
          .from(contracts)
          .where(eq(contracts.id, contractId));
        if (!contract) return { error: "contract-not-found" as const };

        const [existing] = await client
          .select({ contractId: grievanceContracts.contractId })
          .from(grievanceContracts)
          .where(eq(grievanceContracts.grievanceId, grievanceId));

        // Same contract already linked: nothing to do.
        if (existing && existing.contractId === contractId) {
          return { ok: true as const };
        }

        // Changing the contract is a hard block while sections are still linked;
        // the operator must clear the sections manually first.
        if (existing && existing.contractId !== contractId) {
          const [section] = await client
            .select({ id: grievanceContractSections.id })
            .from(grievanceContractSections)
            .where(eq(grievanceContractSections.grievanceId, grievanceId))
            .limit(1);
          if (section) return { error: "has-sections" as const };

          await client
            .update(grievanceContracts)
            .set({ contractId })
            .where(eq(grievanceContracts.grievanceId, grievanceId));
          return { ok: true as const };
        }

        await client.insert(grievanceContracts).values({ grievanceId, contractId });
        return { ok: true as const };
      });
    },

    async clearContract(grievanceId: string): Promise<ClearContractResult> {
      return runInTransaction(async () => {
        const client = getClient();
        const [section] = await client
          .select({ id: grievanceContractSections.id })
          .from(grievanceContractSections)
          .where(eq(grievanceContractSections.grievanceId, grievanceId))
          .limit(1);
        if (section) return { error: "has-sections" as const };

        await client
          .delete(grievanceContracts)
          .where(eq(grievanceContracts.grievanceId, grievanceId));
        return { ok: true as const };
      });
    },

    async addSections(
      grievanceId: string,
      sectionIds: string[],
    ): Promise<AddSectionsResult> {
      return runInTransaction(async () => {
        const client = getClient();

        const [link] = await client
          .select({ contractId: grievanceContracts.contractId })
          .from(grievanceContracts)
          .where(eq(grievanceContracts.grievanceId, grievanceId));
        if (!link) return { error: "no-contract" as const };

        const distinctIds = Array.from(new Set(sectionIds));
        if (distinctIds.length === 0) {
          return { ok: true as const, sections: await listSections(grievanceId) };
        }

        // Every requested section must belong to the grievance's chosen contract.
        const valid = await client
          .select({ id: contractSections.id })
          .from(contractSections)
          .innerJoin(contractArticles, eq(contractSections.articleId, contractArticles.id))
          .where(
            and(
              eq(contractArticles.contractId, link.contractId),
              inArray(contractSections.id, distinctIds),
            ),
          );
        if (valid.length !== distinctIds.length) {
          return { error: "invalid-section" as const };
        }

        // Skip sections already linked; append the rest after the current max.
        const already = await client
          .select({ sectionId: grievanceContractSections.sectionId })
          .from(grievanceContractSections)
          .where(eq(grievanceContractSections.grievanceId, grievanceId));
        const alreadySet = new Set(already.map((r) => r.sectionId));

        const existingSections = await listSections(grievanceId);
        let nextSequence =
          existingSections.length === 0
            ? 0
            : Math.max(...existingSections.map((s) => s.sequence)) + 1;

        const toInsert = distinctIds
          .filter((id) => !alreadySet.has(id))
          .map((sectionId) => ({ grievanceId, sectionId, sequence: nextSequence++ }));

        if (toInsert.length > 0) {
          await client.insert(grievanceContractSections).values(toInsert);
        }

        return { ok: true as const, sections: await listSections(grievanceId) };
      });
    },

    async removeSection(grievanceId: string, linkId: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(grievanceContractSections)
        .where(
          and(
            eq(grievanceContractSections.id, linkId),
            eq(grievanceContractSections.grievanceId, grievanceId),
          ),
        )
        .returning();
      return result.length > 0;
    },

    async moveSection(
      grievanceId: string,
      linkId: string,
      direction: MoveDirection,
    ): Promise<GrievanceLinkedSection[]> {
      return runInTransaction(async () => {
        const client = getClient();
        const ordered = await listSections(grievanceId);
        const reordered = swapInOrder(ordered, linkId, direction);
        for (let i = 0; i < reordered.length; i++) {
          if (reordered[i].sequence !== i) {
            await client
              .update(grievanceContractSections)
              .set({ sequence: i })
              .where(eq(grievanceContractSections.id, reordered[i].id));
          }
        }
        return listSections(grievanceId);
      });
    },
  };
}

/**
 * Reorder helper: swap the target with its adjacent neighbour in an already
 * (sequence, id)-ordered list. Callers renumber `sequence` to the array index
 * so dense/all-equal sequences stay robust (never relative ±1 math — see the
 * reorder-swap-vs-relative-sequence gotcha).
 */
function swapInOrder<T extends { id: string; sequence: number }>(
  ordered: T[],
  id: string,
  direction: MoveDirection,
): T[] {
  const index = ordered.findIndex((row) => row.id === id);
  if (index === -1) return ordered;
  const neighbor = direction === "up" ? index - 1 : index + 1;
  if (neighbor < 0 || neighbor >= ordered.length) return ordered;
  const next = [...ordered];
  [next[index], next[neighbor]] = [next[neighbor], next[index]];
  return next;
}

export const grievanceContractLoggingConfig: StorageLoggingConfig<GrievanceContractStorage> = {
  module: "grievanceContracts",
  methods: {
    setContract: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Set grievance contract`,
    },
    clearContract: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Cleared grievance contract`,
    },
    addSections: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Linked contract sections to grievance`,
    },
    removeSection: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Unlinked a contract section from grievance`,
    },
    moveSection: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async () => `Reordered grievance contract sections`,
    },
  },
};
