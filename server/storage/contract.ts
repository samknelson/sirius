import { getClient } from './transaction-context';
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
import { eq } from "drizzle-orm";

export interface ContractStorage {
  getByName(name: string): Promise<Contract | undefined>;
  createContract(contract: InsertContract): Promise<Contract>;
  createArticle(article: InsertContractArticle): Promise<ContractArticle>;
  createSection(section: InsertContractSection): Promise<ContractSection>;
  deleteByName(name: string): Promise<number>;
}

export function createContractStorage(): ContractStorage {
  return {
    async getByName(name: string): Promise<Contract | undefined> {
      const client = getClient();
      const [row] = await client.select().from(contracts).where(eq(contracts.name, name));
      return row || undefined;
    },

    async createContract(contract: InsertContract): Promise<Contract> {
      const client = getClient();
      const [created] = await client.insert(contracts).values(contract).returning();
      return created;
    },

    async createArticle(article: InsertContractArticle): Promise<ContractArticle> {
      const client = getClient();
      const [created] = await client.insert(contractArticles).values(article).returning();
      return created;
    },

    async createSection(section: InsertContractSection): Promise<ContractSection> {
      const client = getClient();
      const [created] = await client.insert(contractSections).values(section).returning();
      return created;
    },

    async deleteByName(name: string): Promise<number> {
      const client = getClient();
      const result = await client.delete(contracts).where(eq(contracts.name, name)).returning();
      return result.length;
    },
  };
}
