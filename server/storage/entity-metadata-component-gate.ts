// Kept import-free: metadata is also used by storage initialization and tools.
let enabled: (component: string) => boolean = () => false;
export function setMetadataComponentGate(source: (component: string) => boolean): void {
  enabled = source;
}
export function metadataComponentEnabled(component: string): boolean {
  return enabled(component);
}
