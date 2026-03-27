import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import pgPkg from 'pg';
import ws from "ws";
import * as schema from "@shared/schema";

const { Pool: PgPool } = pgPkg;

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

const dbUrl = getDatabaseUrl();
const isLocalDb = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');

let pool: NeonPool | InstanceType<typeof PgPool>;
let db: ReturnType<typeof drizzleNeon> | ReturnType<typeof drizzlePg>;

if (isLocalDb) {
  const pgPool = new PgPool({ connectionString: dbUrl });
  pool = pgPool as any;
  db = drizzlePg({ client: pgPool, schema });
} else {
  const neonPool = new NeonPool({ connectionString: dbUrl });
  pool = neonPool;
  db = drizzleNeon({ client: neonPool, schema });
}

export { pool, db };
