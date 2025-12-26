#!/usr/bin/env npx tsx
import { pushComponentSchema, dropComponentSchema } from "../server/services/component-schema-push";
import { getComponentById, getSchemaManagingComponents } from "../shared/components";

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
Usage: npx tsx scripts/db-push-component.ts <command> [component-id]

Commands:
  push <component-id>   Push/sync a component's schema to the database
  drop <component-id>   Drop all tables for a component
  list                  List all components that manage schemas

Examples:
  npx tsx scripts/db-push-component.ts push sitespecific.btu
  npx tsx scripts/db-push-component.ts drop sitespecific.btu
  npx tsx scripts/db-push-component.ts list
`);
    process.exit(0);
  }

  const command = args[0];

  if (command === "list") {
    const components = getSchemaManagingComponents();
    console.log("\nComponents that manage schemas:\n");
    for (const comp of components) {
      console.log(`  ${comp.id}`);
      console.log(`    Name: ${comp.name}`);
      console.log(`    Schema: ${comp.schemaManifest?.schemaPath}`);
      console.log(`    Tables: ${comp.schemaManifest?.tables.join(", ")}`);
      console.log();
    }
    process.exit(0);
  }

  if (command === "push" || command === "drop") {
    const componentId = args[1];
    
    if (!componentId) {
      console.error("Error: component-id is required");
      process.exit(1);
    }

    const component = getComponentById(componentId);
    if (!component) {
      console.error(`Error: Component not found: ${componentId}`);
      process.exit(1);
    }

    if (!component.managesSchema || !component.schemaManifest) {
      console.error(`Error: Component ${componentId} does not manage a schema`);
      process.exit(1);
    }

    try {
      if (command === "push") {
        console.log(`Pushing schema for component: ${componentId}`);
        console.log(`Schema path: ${component.schemaManifest.schemaPath}`);
        console.log(`Tables: ${component.schemaManifest.tables.join(", ")}`);
        console.log();
        
        await pushComponentSchema(componentId);
        
        console.log("\nSchema push completed successfully!");
      } else {
        console.log(`Dropping schema for component: ${componentId}`);
        console.log(`Tables to drop: ${component.schemaManifest.tables.join(", ")}`);
        console.log();
        
        await dropComponentSchema(componentId);
        
        console.log("\nSchema drop completed successfully!");
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main();
