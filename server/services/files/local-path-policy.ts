import { lstatSync, realpathSync } from "node:fs";
import * as path from "node:path";

// Fixed policy, deliberately independent of FILESYSTEMS and env overrides.
const sensitiveTrees = ["/proc", "/sys", "/dev", "/etc", "/run", "/var/run"];

function assertNotSensitive(candidate: string): void {
  if (
    candidate === path.parse(candidate).root ||
    sensitiveTrees.some((tree) => candidate === tree || candidate.startsWith(tree + path.sep))
  ) {
    throw new Error(
      `Local filesystem path "${candidate}" is prohibited: / and the system trees ` +
        `/proc, /sys, /dev, /etc, /run (including /var/run aliases) cannot be used.`,
    );
  }
}

/**
 * Resolve a future path through its nearest existing ancestor. Never treat a
 * dangling symlink as an absent directory: mkdir/write would follow that link.
 * Only ENOENT permits walking upward; permissions, loops and ENOTDIR fail closed.
 */
export function resolveLocalPhysicalPath(absolutePath: string): string {
  let ancestor = absolutePath;
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync(ancestor), ...missing);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        lstatSync(ancestor);
      } catch (statError: unknown) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw error;
        missing.unshift(path.basename(ancestor));
        ancestor = parent;
        continue;
      }
      throw new Error(`Local filesystem path "${ancestor}" cannot be physically resolved (dangling symlink).`);
    }
  }
}

/** Validate both the configured spelling and physical location, without creating anything. */
export function assertLocalPathAllowed(input: string): string {
  if (!path.isAbsolute(input) || input.includes("\0")) {
    throw new Error("Local filesystem path must be absolute and contain no NUL bytes.");
  }
  const absolute = path.resolve(input);
  assertNotSensitive(absolute);
  const physical = resolveLocalPhysicalPath(absolute);
  assertNotSensitive(physical);
  return physical;
}
