import type { ComponentType } from "react";
import { componentBrowserContributions } from "../../generated/component-contributions";

export interface SnapshotRendererProps {
  /** Decoded snapshot payload as returned by the snapshot GET endpoint. */
  decoded: unknown;
}

/**
 * Client-side snapshot renderer registry, keyed by entity type. Each
 * renderer receives the decoded snapshot (already in the live GET endpoint
 * shape for its entity type) and renders it read-only. Unregistered types
 * fall back to a raw JSON view in the browser.
 */
export function getSnapshotRenderer(entityType: string): ComponentType<SnapshotRendererProps> | undefined {
  const matches = componentBrowserContributions.flatMap(c => c.snapshotRenderers ?? [])
    .filter(r => r.entityType === entityType);
  if (matches.length > 1) throw new Error(`Duplicate snapshot renderer '${entityType}'`);
  return matches[0]?.renderer;
}
