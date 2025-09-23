// Database storage implementation based on blueprint:javascript_database
import { users, workers, type User, type InsertUser, type Worker, type InsertWorker } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Worker CRUD operations
  getAllWorkers(): Promise<Worker[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  createWorker(worker: InsertWorker): Promise<Worker>;
  updateWorker(id: string, worker: Partial<InsertWorker>): Promise<Worker | undefined>;
  deleteWorker(id: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getAllWorkers(): Promise<Worker[]> {
    const allWorkers = await db.select().from(workers);
    return allWorkers.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getWorker(id: string): Promise<Worker | undefined> {
    const [worker] = await db.select().from(workers).where(eq(workers.id, id));
    return worker || undefined;
  }

  async createWorker(insertWorker: InsertWorker): Promise<Worker> {
    const [worker] = await db
      .insert(workers)
      .values(insertWorker)
      .returning();
    return worker;
  }

  async updateWorker(id: string, workerUpdate: Partial<InsertWorker>): Promise<Worker | undefined> {
    const [worker] = await db
      .update(workers)
      .set(workerUpdate)
      .where(eq(workers.id, id))
      .returning();
    return worker || undefined;
  }

  async deleteWorker(id: string): Promise<boolean> {
    const result = await db.delete(workers).where(eq(workers.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();
