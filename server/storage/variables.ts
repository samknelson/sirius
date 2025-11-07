import { db } from "../db";
import { variables, type Variable, type InsertVariable } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface VariableStorage {
  getAllVariables(): Promise<Variable[]>;
  getVariable(id: string): Promise<Variable | undefined>;
  getVariableByName(name: string): Promise<Variable | undefined>;
  createVariable(variable: InsertVariable): Promise<Variable>;
  updateVariable(id: string, variable: Partial<InsertVariable>): Promise<Variable | undefined>;
  deleteVariable(id: string): Promise<boolean>;
}

export function createVariableStorage(): VariableStorage {
  return {
    async getAllVariables(): Promise<Variable[]> {
      const allVariables = await db.select().from(variables);
      return allVariables.sort((a, b) => a.name.localeCompare(b.name));
    },

    async getVariable(id: string): Promise<Variable | undefined> {
      const [variable] = await db.select().from(variables).where(eq(variables.id, id));
      return variable || undefined;
    },

    async getVariableByName(name: string): Promise<Variable | undefined> {
      const [variable] = await db.select().from(variables).where(eq(variables.name, name));
      return variable || undefined;
    },

    async createVariable(insertVariable: InsertVariable): Promise<Variable> {
      const [variable] = await db
        .insert(variables)
        .values(insertVariable)
        .returning();
      return variable;
    },

    async updateVariable(id: string, variableUpdate: Partial<InsertVariable>): Promise<Variable | undefined> {
      const [variable] = await db
        .update(variables)
        .set(variableUpdate)
        .where(eq(variables.id, id))
        .returning();
      
      return variable || undefined;
    },

    async deleteVariable(id: string): Promise<boolean> {
      const result = await db.delete(variables).where(eq(variables.id, id)).returning();
      return result.length > 0;
    }
  };
}
