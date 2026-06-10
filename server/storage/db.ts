import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "NEON_DATABASE_URL or DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: databaseUrl });

// Neon (and Postgres generally) will drop idle pooled connections — e.g. when
// the compute autosuspends or is restarted, the server sends "terminating
// connection due to administrator command". node-postgres surfaces that as an
// 'error' event on the Pool. If no listener is attached, Node treats an
// emitted 'error' as an uncaught exception and crashes the process, which
// shows up as intermittent "Internal Server Error" responses for whoever is
// using the app at that moment. Handling the event keeps the process alive;
// the dead client is discarded and the next query transparently gets a fresh
// connection from the pool.
pool.on("error", (err) => {
  console.error("PG Pool error (idle client terminated, recovering):", err.message);
});

export const db = drizzle({ client: pool, schema });
