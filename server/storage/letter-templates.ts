import { asc, eq } from "drizzle-orm";
import {
  letterTemplates,
  type InsertLetterTemplate,
  type LetterTemplate,
} from "@shared/schema";
import { getClient } from "./transaction-context";
import { defineLoggingConfig } from "./middleware/logging";

export interface LetterTemplateStorage {
  getAll(): Promise<LetterTemplate[]>;
  get(id: string): Promise<LetterTemplate | undefined>;
  create(input: InsertLetterTemplate): Promise<LetterTemplate>;
  update(
    id: string,
    input: Partial<InsertLetterTemplate>,
  ): Promise<LetterTemplate | undefined>;
}

export function createLetterTemplateStorage(): LetterTemplateStorage {
  return {
    async getAll() {
      return getClient()
        .select()
        .from(letterTemplates)
        .orderBy(asc(letterTemplates.name), asc(letterTemplates.id));
    },

    async get(id) {
      const [row] = await getClient()
        .select()
        .from(letterTemplates)
        .where(eq(letterTemplates.id, id));
      return row;
    },

    async create(input) {
      const [row] = await getClient()
        .insert(letterTemplates)
        .values(input)
        .returning();
      return row;
    },

    async update(id, input) {
      const [row] = await getClient()
        .update(letterTemplates)
        .set(input)
        .where(eq(letterTemplates.id, id))
        .returning();
      return row;
    },
  };
}

export const letterTemplateLoggingConfig =
  defineLoggingConfig<LetterTemplateStorage>({
    module: "letter-templates",
    table: "letter_templates",
    getter: "get",
    methods: {
      create: {
        describe: { label: "letter template", name: "name", id: "id" },
      },
      update: {
        describe: { label: "letter template", name: "name", id: "id" },
      },
    },
  });