import { objectStorageService } from "./services/objectStorage.js";

/**
 * One-time cleanup script for orphaned object storage files
 * 
 * Usage: npx tsx server/cleanup-orphaned-storage.ts <storage-path>
 * Example: npx tsx server/cleanup-orphaned-storage.ts wizards/cad12344-fb9a-49a8-b5d8-8123169d1942/1234567890_file.csv
 * 
 * For folders, delete all files in the folder individually first.
 */

async function cleanup() {
  const storagePath = process.argv[2];

  if (!storagePath) {
    console.error("Usage: npx tsx server/cleanup-orphaned-storage.ts <storage-path>");
    console.error("Example: npx tsx server/cleanup-orphaned-storage.ts wizards/cad12344-fb9a-49a8-b5d8-8123169d1942/1234567890_file.csv");
    process.exit(1);
  }

  console.log(`Attempting to delete: ${storagePath}`);
  
  try {
    await objectStorageService.deleteFile(storagePath);
    console.log(`✓ Successfully deleted: ${storagePath}`);
  } catch (error) {
    console.error(`✗ Failed to delete: ${storagePath}`);
    console.error(error instanceof Error ? error.message : "Unknown error");
    process.exit(1);
  }
}

cleanup();
