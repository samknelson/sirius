import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_DEV || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  return url;
}

export const pool = new Pool({ connectionString: getDatabaseUrl() });
export const db = drizzle({ client: pool, schema });
