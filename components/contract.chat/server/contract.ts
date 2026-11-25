import { z } from "zod";
import type { JsonSchema } from "../../../shared/json-schema-form";
import { WcVendorError } from "../../../server/plugins/wc-vendors/errors";
import type { ContractChatArgs } from "../shared/types";

const text = z.string().min(1).refine((s) => Boolean(s.trim()), "Text must not be blank");
const query = text.refine((s) => s.length <= 4000, "Maximum 4,000 characters");
export const askArgs = z.object({
  contractId: text,
  role: z.enum(["staff", "steward", "member"]),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: text,
  }).strict()).min(1).max(20),
  userRef: text.optional(),
  sessionRef: text.optional(),
  mode: z.enum(["whole", "pages"]).optional(),
}).strict().superRefine((args, ctx) => {
  args.messages.forEach((m, i) => {
    const expected = i % 2 === 0 ? "user" : "assistant";
    if (m.role !== expected || (i === args.messages.length - 1 && m.role !== "user")) {
      ctx.addIssue({ code: "custom", path: ["messages", i, "role"],
        message: "Messages must alternate, beginning and ending with user" });
    }
    if (m.content.length > (m.role === "user" ? 4000 : 20000)) {
      ctx.addIssue({ code: "custom", path: ["messages", i, "content"],
        message: `Maximum ${m.role === "user" ? 4000 : 20000} characters for ${m.role}` });
    }
  });
});
export const searchArgs = z.object({
  query,
  contractIds: z.array(text).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict();
export const routeArgs = z.object({ question: query }).strict();
export const feedbackArgs = z.object({
  requestId: text,
  rating: z.enum(["up", "down"]),
  comment: z.string().max(4000).optional(),
}).strict();

/** Never relay validation input or a transcript in error messages. */
export function parseArgs<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new WcVendorError(400, `Invalid contract chat arguments: ${parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}

const nonblank: JsonSchema = { type: "string", minLength: 1, pattern: "\\S" };
const shortText: JsonSchema = { ...nonblank, maxLength: 4000 };
const message: JsonSchema = {
  type: "object", additionalProperties: false, required: ["role", "content"],
  properties: { role: { type: "string", enum: ["user", "assistant"] }, content: { ...nonblank, maxLength: 20000 } },
};
// The handler enforces alternating roles and role-specific limits too, including
// typed server callers which do not go through the manual-run form.
export const manualSchemas: Record<"empty" | "ask" | "search" | "route" | "feedback", JsonSchema> = {
  empty: { type: "object", properties: {}, additionalProperties: false },
  ask: {
    type: "object", additionalProperties: false,
    required: ["contractId", "role", "messages"],
    properties: {
      contractId: { ...nonblank, title: "Provider contract ID (not Sirius ID)" },
      role: { type: "string", enum: ["staff", "steward", "member"] },
      messages: { type: "array", minItems: 1, maxItems: 20, items: message },
      userRef: { ...nonblank, title: "Opaque trusted user reference" },
      sessionRef: nonblank,
      mode: { type: "string", enum: ["whole", "pages"] },
    },
  },
  search: {
    type: "object", additionalProperties: false, required: ["query"],
    properties: { query: shortText, contractIds: { type: "array", items: nonblank },
      limit: { type: "integer", minimum: 1, maximum: 50 } },
  },
  route: { type: "object", additionalProperties: false, required: ["question"], properties: { question: shortText } },
  feedback: {
    type: "object", additionalProperties: false, required: ["requestId", "rating"],
    properties: { requestId: nonblank, rating: { type: "string", enum: ["up", "down"] },
      comment: { type: "string", maxLength: 4000 } },
  },
};

export function validateAsk(value: unknown): ContractChatArgs {
  return parseArgs(askArgs, value);
}
