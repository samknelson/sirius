export function initializeServiceProviders(): void {
  // Kept as a compatibility export for older boot scripts. SMS transports are
  // wc-vendor plugins and are not registered in the legacy service registry.
}

initializeServiceProviders();
