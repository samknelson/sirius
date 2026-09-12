/**
 * Failures on the way to a provider, rather than failures reported by one.
 *
 * They live in the kind (not in the calling module) because the framework
 * wrapping happens at plugin registration, so the refusal is raised here and
 * has to be nameable here. The calling module re-exports them so a route
 * catches one name.
 */

/**
 * Something stopped the request before the provider answered, carrying the
 * HTTP status the route should return. Routes catch the base, so a new reason
 * for not reaching the vendor does not need a new catch clause.
 */
export class WcVendorError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WcVendorError";
  }
}

/**
 * The plugin resolved, but the operation did not happen: the plugin does not
 * declare it, or the web client framework declined to make the call.
 */
export class WcVendorRequestError extends WcVendorError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "WcVendorRequestError";
  }
}
