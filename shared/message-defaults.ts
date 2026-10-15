import { z } from "zod";

// These are fixed, site-wide content, not another token authoring surface.
const fixedHtml = z.string().max(50_000).refine(
  (value) => !/\{\{|\}\}/.test(value),
  "Site-wide defaults cannot contain recipient-specific tokens.",
);
export const emailMessageDefaultsSchema = z.object({
  letterheadHtml: fixedHtml.default(""),
}).strict();
export const postalMessageDefaultsSchema = z.object({
  letterheadHtml: fixedHtml.default(""),
  footerHtml: fixedHtml.default(""),
  showPageCount: z.boolean().default(false),
}).strict();
export type EmailMessageDefaults = z.infer<typeof emailMessageDefaultsSchema>;
export type PostalMessageDefaults = z.infer<typeof postalMessageDefaultsSchema>;
