import type { RequestHandler } from "express";
import { componentDocumentPolicies } from "../generated/component-document-policies";

/** Serializable build-time declarations also work in database-free static services. */
export const componentDocumentPolicy: RequestHandler = (req, res, next) => {
  const policy = componentDocumentPolicies.find(policy => policy.path.toLowerCase() === req.path.toLowerCase());
  if (policy) {
    // A header is required: a script-created meta tag is too late for the
    // browser's speculative preloader, even when that script is first.
    res.setHeader("Referrer-Policy", policy.referrerPolicy);
    res.setHeader("Cache-Control", policy.cacheControl);
  }
  next();
};
