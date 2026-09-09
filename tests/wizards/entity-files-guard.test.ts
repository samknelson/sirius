import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const WIZARDS_ROOT = join(process.cwd(), "server/plugins/wizards");

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : entry.isFile() && path.endsWith(".ts") ? [path] : [];
  }));
  return nested.flat();
}

describe("wizard Entity Files boundary", () => {
  it("keeps provider access and private filesystem literals in the attachment helper", async () => {
    const files = await sourceFiles(WIZARDS_ROOT);
    const offenders: string[] = [];
    for (const file of files) {
      // The helper is the intentional configured-filesystem boundary; it
      // never selects a literal private filesystem itself.
      if (file.endsWith("/attachments.ts")) continue;
      const source = await readFile(file, "utf8");
      if (
        /\bobjectStorageService\b/.test(source) ||
        /fileSystemId\s*:\s*["']private["']/.test(source) ||
        /fileSystemService\.(?:upload|download)\s*\(/.test(source) ||
        /storage\.files\.(?:create|delete|list)\s*\(/.test(source)
      ) offenders.push(file.replace(`${process.cwd()}/`, ""));
    }
    expect(offenders).toEqual([]);
  });

  it("routes generic wizard uploads through the locked attachment helper", async () => {
    const routeSource = await readFile(
      join(process.cwd(), "server/modules/entity-files.ts"), "utf8",
    );
    expect(routeSource).toContain('if (context.id === "wizard")');
    expect(routeSource).toContain("createWizardAttachmentRecord({");
  });

  it("keeps deleting status terminal at the storage boundary", async () => {
    const storageSource = await readFile(
      join(process.cwd(), "server/storage/wizards.ts"), "utf8",
    );
    expect(storageSource).toContain('updates.status === "deleting"');
    expect(storageSource).toContain('ne(wizards.status, "deleting")');
  });
});