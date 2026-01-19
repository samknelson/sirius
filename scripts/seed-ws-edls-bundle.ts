/**
 * Seed script for EDLS Web Service bundle and test client
 * 
 * This creates the EDLS bundle and a test client with credentials for development.
 * 
 * Usage: npx tsx scripts/seed-ws-edls-bundle.ts
 */

import { storage } from "../server/storage";
import { runInTransaction } from "../server/storage/transaction-context";

async function seed() {
  console.log("Seeding EDLS Web Service bundle...\n");

  await runInTransaction(async () => {
    // Check if bundle already exists
    let bundle = await storage.wsBundles.getByCode("edls");
    
    if (bundle) {
      console.log(`EDLS bundle already exists: ${bundle.id}`);
    } else {
      bundle = await storage.wsBundles.create({
        code: "edls",
        name: "EDLS Server Service",
        description: "Day labor scheduling API - query sheets by status and date",
        version: "1.0.0",
        status: "active",
      });
      console.log(`Created EDLS bundle: ${bundle.id}`);
    }

    // Check if test client already exists
    const existingClients = await storage.wsClients.getByBundle(bundle.id);
    const testClient = existingClients.find(c => c.name === "Test Client");

    let client;
    if (testClient) {
      console.log(`Test client already exists: ${testClient.id}`);
      client = testClient;
    } else {
      client = await storage.wsClients.create({
        name: "Test Client",
        description: "Development/testing client for EDLS API",
        bundleId: bundle.id,
        status: "active",
        ipAllowlistEnabled: false,
      });
      console.log(`Created test client: ${client.id}`);
    }

    // Check if test client has any credentials
    const existingCredentials = await storage.wsClientCredentials.getByClient(client.id);
    
    if (existingCredentials.length > 0) {
      console.log(`Test client already has ${existingCredentials.length} credential(s)`);
      console.log("\nExisting credentials:");
      for (const cred of existingCredentials) {
        console.log(`  - ${cred.clientKey} (${cred.isActive ? 'active' : 'inactive'}, label: ${cred.label || 'none'})`);
      }
    } else {
      // Create new credentials
      const result = await storage.wsClientCredentials.create(
        client.id,
        "Development credentials",
        undefined // No expiration
      );
      
      console.log(`\nCreated test credentials:`);
      console.log(`  Client Key:    ${result.clientKey}`);
      console.log(`  Client Secret: ${result.clientSecret}`);
      console.log(`\n  IMPORTANT: Store the Client Secret securely - it cannot be retrieved again!`);
    }

    console.log("\n=== Testing the EDLS Web Service ===\n");
    console.log("To test the EDLS web service, use the following curl command:\n");
    
    if (existingCredentials.length > 0) {
      console.log(`curl -X GET "http://localhost:5000/api/ws/edls/sheets" \\
  -H "X-WS-Client-Key: <your-client-key>" \\
  -H "X-WS-Client-Secret: <your-client-secret>"`);
    } else {
      console.log(`(After running this script, you'll see the credentials above)`);
    }
    
    console.log("\nOr with query parameters:\n");
    console.log(`curl -X GET "http://localhost:5000/api/ws/edls/sheets?status=active&dateFrom=2025-01-01" \\
  -H "X-WS-Client-Key: <your-client-key>" \\
  -H "X-WS-Client-Secret: <your-client-secret>"`);
  });

  console.log("\nDone!");
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
