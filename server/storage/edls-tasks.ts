import { db } from "../db";
import { optionsEdlsTasks, type EdlsTask, type InsertEdlsTask, optionsDepartment } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface EdlsTaskWithDepartment extends EdlsTask {
  department?: {
    id: string;
    name: string;
  };
}

export interface EdlsTaskStorage {
  getAll(): Promise<EdlsTaskWithDepartment[]>;
  get(id: string): Promise<EdlsTask | undefined>;
  create(task: InsertEdlsTask): Promise<EdlsTask>;
  update(id: string, task: Partial<InsertEdlsTask>): Promise<EdlsTask | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createEdlsTaskStorage(): EdlsTaskStorage {
  return {
    async getAll(): Promise<EdlsTaskWithDepartment[]> {
      const results = await db
        .select({
          id: optionsEdlsTasks.id,
          name: optionsEdlsTasks.name,
          siriusId: optionsEdlsTasks.siriusId,
          departmentId: optionsEdlsTasks.departmentId,
          data: optionsEdlsTasks.data,
          department: {
            id: optionsDepartment.id,
            name: optionsDepartment.name,
          },
        })
        .from(optionsEdlsTasks)
        .leftJoin(optionsDepartment, eq(optionsEdlsTasks.departmentId, optionsDepartment.id))
        .orderBy(optionsEdlsTasks.name);
      
      return results.map(r => ({
        id: r.id,
        name: r.name,
        siriusId: r.siriusId,
        departmentId: r.departmentId,
        data: r.data,
        department: r.department || undefined,
      }));
    },

    async get(id: string): Promise<EdlsTask | undefined> {
      const [task] = await db.select().from(optionsEdlsTasks).where(eq(optionsEdlsTasks.id, id));
      return task || undefined;
    },

    async create(insertTask: InsertEdlsTask): Promise<EdlsTask> {
      const [task] = await db
        .insert(optionsEdlsTasks)
        .values(insertTask)
        .returning();
      return task;
    },

    async update(id: string, taskUpdate: Partial<InsertEdlsTask>): Promise<EdlsTask | undefined> {
      const [task] = await db
        .update(optionsEdlsTasks)
        .set(taskUpdate)
        .where(eq(optionsEdlsTasks.id, id))
        .returning();
      return task || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(optionsEdlsTasks).where(eq(optionsEdlsTasks.id, id)).returning();
      return result.length > 0;
    }
  };
}
