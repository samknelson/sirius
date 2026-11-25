import type { RequestHandler, Response } from "express";

const privatePrefixes = new Set<string>();
const privateResponses = new WeakSet<Response>();

/** Components declare sensitive scopes before middleware installation. */
export function registerPrivateHttpScope(prefix: string): void {
  privatePrefixes.add(prefix.toLowerCase());
}

export function isHttpBodyPrivate(res: Response): boolean {
  return privateResponses.has(res);
}

/** Before parsers, so malformed JSON and authorization refusals are private too. */
export const captureHttpPrivacy: RequestHandler = (req, res, next) => {
  // Express literal routes are case-insensitive unless configured otherwise.
  const path = req.path.toLowerCase();
  if ([...privatePrefixes].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    privateResponses.add(res);
    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Cookie");
  }
  next();
};
