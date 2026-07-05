import { getClient, runInTransaction } from './transaction-context';
import { type StorageLoggingConfig } from "./middleware/logging";
import {
  contracts,
  contractArticles,
  contractSections,
  type Contract,
  type InsertContract,
  type ContractArticle,
  type InsertContractArticle,
  type ContractSection,
  type InsertContractSection,
} from "@shared/schema/contract/schema";
import { and, asc, count, eq, ilike } from "drizzle-orm";

export type UpdateContractInput = Partial<Pick<Contract, "name" | "stubSections" | "data">>;
export type UpdateArticleInput = Partial<Pick<ContractArticle, "name" | "articleNumber" | "data">>;
export type UpdateSectionInput = Partial<
  Pick<ContractSection, "name" | "sectionNumber" | "body" | "isStub" | "data">
>;
export type MoveDirection = "up" | "down";

export interface ContractCounts {
  articleCount: number;
  sectionCount: number;
}

export interface ContractStorage {
  // ── Contracts ──
  list(search?: string): Promise<Contract[]>;
  getById(id: string): Promise<Contract | undefined>;
  getByName(name: string): Promise<Contract | undefined>;
  getCounts(contractId: string): Promise<ContractCounts>;
  createContract(contract: InsertContract): Promise<Contract>;
  update(id: string, input: UpdateContractInput): Promise<Contract | undefined>;
  delete(id: string): Promise<boolean>;
  deleteByName(name: string): Promise<number>;

  // ── Articles ──
  listArticles(contractId: string): Promise<ContractArticle[]>;
  getArticle(id: string): Promise<ContractArticle | undefined>;
  createArticle(article: InsertContractArticle): Promise<ContractArticle>;
  updateArticle(id: string, input: UpdateArticleInput): Promise<ContractArticle | undefined>;
  deleteArticle(id: string): Promise<boolean>;
  moveArticle(id: string, direction: MoveDirection): Promise<ContractArticle[]>;

  // ── Sections ──
  listSections(articleId: string): Promise<ContractSection[]>;
  getSection(id: string): Promise<ContractSection | undefined>;
  createSection(section: InsertContractSection): Promise<ContractSection>;
  updateSection(id: string, input: UpdateSectionInput): Promise<ContractSection | undefined>;
  deleteSection(id: string): Promise<boolean>;
  moveSection(id: string, direction: MoveDirection): Promise<ContractSection[]>;
}

export function createContractStorage(): ContractStorage {
  return {
    // ── Contracts ──
    async list(search?: string): Promise<Contract[]> {
      const client = getClient();
      const trimmed = search?.trim();
      const query = client.select().from(contracts);
      const rows = trimmed
        ? await query.where(ilike(contracts.name, `%${trimmed}%`)).orderBy(asc(contracts.name))
        : await query.orderBy(asc(contracts.name));
      return rows;
    },

    async getById(id: string): Promise<Contract | undefined> {
      const client = getClient();
      const [row] = await client.select().from(contracts).where(eq(contracts.id, id));
      return row || undefined;
    },

    async getByName(name: string): Promise<Contract | undefined> {
      const client = getClient();
      const [row] = await client.select().from(contracts).where(eq(contracts.name, name));
      return row || undefined;
    },

    async getCounts(contractId: string): Promise<ContractCounts> {
      const client = getClient();
      const [articleRow] = await client
        .select({ value: count() })
        .from(contractArticles)
        .where(eq(contractArticles.contractId, contractId));
      const [sectionRow] = await client
        .select({ value: count() })
        .from(contractSections)
        .innerJoin(contractArticles, eq(contractSections.articleId, contractArticles.id))
        .where(eq(contractArticles.contractId, contractId));
      return {
        articleCount: Number(articleRow?.value ?? 0),
        sectionCount: Number(sectionRow?.value ?? 0),
      };
    },

    async createContract(contract: InsertContract): Promise<Contract> {
      const client = getClient();
      const [created] = await client.insert(contracts).values(contract).returning();
      return created;
    },

    async update(id: string, input: UpdateContractInput): Promise<Contract | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(contracts)
        .set(input)
        .where(eq(contracts.id, id))
        .returning();
      return updated || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(contracts).where(eq(contracts.id, id)).returning();
      return result.length > 0;
    },

    async deleteByName(name: string): Promise<number> {
      const client = getClient();
      const result = await client.delete(contracts).where(eq(contracts.name, name)).returning();
      return result.length;
    },

    // ── Articles ──
    async listArticles(contractId: string): Promise<ContractArticle[]> {
      const client = getClient();
      return client
        .select()
        .from(contractArticles)
        .where(eq(contractArticles.contractId, contractId))
        .orderBy(asc(contractArticles.sequence), asc(contractArticles.id));
    },

    async getArticle(id: string): Promise<ContractArticle | undefined> {
      const client = getClient();
      const [row] = await client.select().from(contractArticles).where(eq(contractArticles.id, id));
      return row || undefined;
    },

    async createArticle(article: InsertContractArticle): Promise<ContractArticle> {
      const client = getClient();
      const [created] = await client.insert(contractArticles).values(article).returning();
      return created;
    },

    async updateArticle(id: string, input: UpdateArticleInput): Promise<ContractArticle | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(contractArticles)
        .set(input)
        .where(eq(contractArticles.id, id))
        .returning();
      return updated || undefined;
    },

    async deleteArticle(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(contractArticles)
        .where(eq(contractArticles.id, id))
        .returning();
      return result.length > 0;
    },

    async moveArticle(id: string, direction: MoveDirection): Promise<ContractArticle[]> {
      return runInTransaction(async () => {
        const client = getClient();
        const [target] = await client
          .select()
          .from(contractArticles)
          .where(eq(contractArticles.id, id));
        if (!target) return [];

        const siblings = await client
          .select()
          .from(contractArticles)
          .where(eq(contractArticles.contractId, target.contractId))
          .orderBy(asc(contractArticles.sequence), asc(contractArticles.id));

        const reordered = swapInOrder(siblings, id, direction);
        for (let i = 0; i < reordered.length; i++) {
          if (reordered[i].sequence !== i) {
            await client
              .update(contractArticles)
              .set({ sequence: i })
              .where(eq(contractArticles.id, reordered[i].id));
          }
        }
        return client
          .select()
          .from(contractArticles)
          .where(eq(contractArticles.contractId, target.contractId))
          .orderBy(asc(contractArticles.sequence), asc(contractArticles.id));
      });
    },

    // ── Sections ──
    async listSections(articleId: string): Promise<ContractSection[]> {
      const client = getClient();
      return client
        .select()
        .from(contractSections)
        .where(eq(contractSections.articleId, articleId))
        .orderBy(asc(contractSections.sequence), asc(contractSections.id));
    },

    async getSection(id: string): Promise<ContractSection | undefined> {
      const client = getClient();
      const [row] = await client.select().from(contractSections).where(eq(contractSections.id, id));
      return row || undefined;
    },

    async createSection(section: InsertContractSection): Promise<ContractSection> {
      const client = getClient();
      const [created] = await client.insert(contractSections).values(section).returning();
      return created;
    },

    async updateSection(id: string, input: UpdateSectionInput): Promise<ContractSection | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(contractSections)
        .set(input)
        .where(eq(contractSections.id, id))
        .returning();
      return updated || undefined;
    },

    async deleteSection(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(contractSections)
        .where(eq(contractSections.id, id))
        .returning();
      return result.length > 0;
    },

    async moveSection(id: string, direction: MoveDirection): Promise<ContractSection[]> {
      return runInTransaction(async () => {
        const client = getClient();
        const [target] = await client
          .select()
          .from(contractSections)
          .where(eq(contractSections.id, id));
        if (!target) return [];

        const siblings = await client
          .select()
          .from(contractSections)
          .where(eq(contractSections.articleId, target.articleId))
          .orderBy(asc(contractSections.sequence), asc(contractSections.id));

        const reordered = swapInOrder(siblings, id, direction);
        for (let i = 0; i < reordered.length; i++) {
          if (reordered[i].sequence !== i) {
            await client
              .update(contractSections)
              .set({ sequence: i })
              .where(eq(contractSections.id, reordered[i].id));
          }
        }
        return client
          .select()
          .from(contractSections)
          .where(eq(contractSections.articleId, target.articleId))
          .orderBy(asc(contractSections.sequence), asc(contractSections.id));
      });
    },
  };
}

/**
 * Reorder helper: swap the target with its adjacent neighbor in an already
 * (sequence, id)-ordered list. Returns the new ordering. Callers renumber the
 * `sequence` column to the array index so dense/all-equal sequences stay robust
 * (never relative ±1 math — see reorder-swap-vs-relative-sequence gotcha).
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

export const contractLoggingConfig: StorageLoggingConfig<ContractStorage> = {
  module: 'contracts',
  methods: {
    createContract: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new contract',
      getHostEntityId: (args, result) => result?.id,
      getDescription: async (args, result) =>
        `Created Contract "${result?.name || args[0]?.name || 'Unnamed'}"`,
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result) => `Updated Contract "${result?.name || 'Unknown'}"`,
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args) => `Deleted Contract ${args[0]}`,
    },
    createArticle: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new article',
      getHostEntityId: (args, result) => result?.contractId,
      getDescription: async (args, result) =>
        `Created Article "${result?.name || args[0]?.name || 'Unnamed'}"`,
    },
    updateArticle: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result) => result?.contractId,
      getDescription: async (args, result) => `Updated Article "${result?.name || 'Unknown'}"`,
    },
    deleteArticle: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args) => `Deleted Article ${args[0]}`,
    },
    createSection: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new section',
      getHostEntityId: (args, result) => result?.articleId,
      getDescription: async (args, result) =>
        `Created Section "${result?.name || args[0]?.name || 'Unnamed'}"`,
    },
    updateSection: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result) => result?.articleId,
      getDescription: async (args, result) => `Updated Section "${result?.name || 'Unknown'}"`,
    },
    deleteSection: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args) => `Deleted Section ${args[0]}`,
    },
  },
};
