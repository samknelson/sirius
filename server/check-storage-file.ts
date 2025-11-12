import { objectStorageService } from "./services/objectStorage.js";

/**
 * Check if a file exists in object storage and get its metadata
 * 
 * Usage: npx tsx server/check-storage-file.ts <storage-path>
 */

async function checkFile() {
  const storagePath = process.argv[2];

  if (!storagePath) {
    console.error("Usage: npx tsx server/check-storage-file.ts <storage-path>");
    console.error("Example: npx tsx server/check-storage-file.ts wizards/cad12344-fb9a-49a8-b5d8-8123169d1942/1762951319887_substack_test.csv");
    process.exit(1);
  }

  console.log(`Checking file: ${storagePath}`);
  console.log(`Bucket ID: ${process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID}`);
  console.log("");
  
  try {
    const exists = await objectStorageService.fileExists(storagePath);
    console.log(`File exists: ${exists}`);
    
    if (exists) {
      const metadata = await objectStorageService.getFileMetadata(storagePath);
      console.log("\nFile metadata:");
      console.log(`  Name: ${metadata.fileName}`);
      console.log(`  Size: ${metadata.size} bytes`);
      console.log(`  MIME Type: ${metadata.mimeType || 'unknown'}`);
      console.log(`  Last Modified: ${metadata.lastModified?.toISOString() || 'unknown'}`);
      console.log("\nYou can delete this file with:");
      console.log(`  npx tsx server/cleanup-orphaned-storage.ts "${storagePath}"`);
    } else {
      console.log("\n❌ File does not exist at this path");
      console.log("\nPossible reasons:");
      console.log("  1. The file was already deleted");
      console.log("  2. The path shown in the UI includes the bucket name (which shouldn't be in the path)");
      console.log("  3. The App Storage UI is showing cached/stale data");
      console.log("\nTry refreshing the App Storage panel to see if the folder is still there.");
    }
  } catch (error) {
    console.error("\n❌ Error checking file:");
    console.error(error instanceof Error ? error.message : "Unknown error");
  }
}

checkFile();
