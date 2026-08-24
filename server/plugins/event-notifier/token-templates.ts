import { logger } from "../../logger";
import type {
  EventNotifierPlugin,
  NotificationMedium,
  NotifierChannelTemplates,
  NotifierMessageContent,
  NotifierRecipient,
} from "./types";
import type { TokenRootSeed } from "../tokens/types";
import {
  NOTIFIER_CHANNEL_FIELDS,
  applyFieldEligibility,
  shapeRenderedValue,
  tokenCleanerFor,
  type TokenValueCleaner,
} from "../../delivery/shape";

const SERVICE = "event-notifier-token-templates";

/**
 * Read the admin's custom per-channel templates off a config's `data`
 * payload (`data.templates`). Unknown/malformed values degrade to "no
 * override" — the default template applies.
 */
function customTemplatesOf(configData: unknown): Record<string, Record<string, unknown>> {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const t = data.templates;
  if (!t || typeof t !== "object") return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [channel, val] of Object.entries(t as Record<string, unknown>)) {
    if (val && typeof val === "object") out[channel] = val as Record<string, unknown>;
  }
  return out;
}

export { isSafeRelativePath } from "../../delivery/shape";

/** A custom field wins only when it is a non-blank string. */
function pick(custom: unknown, fallback: string | undefined): string {
  return typeof custom === "string" && custom.trim() !== "" ? custom : (fallback ?? "");
}

/**
 * Effective per-channel templates for one config: the plugin's defaults
 * (computed with the config's data) overridden field-by-field by the
 * admin's custom templates. Blank custom fields keep the default.
 */
export function resolveTemplates(
  plugin: EventNotifierPlugin,
  configData: unknown,
): NotifierChannelTemplates {
  const defaults = plugin.tokenTemplates!.defaultTemplates(configData);
  const custom = customTemplatesOf(configData);
  return {
    email: defaults.email && {
      subject: pick(custom.email?.subject, defaults.email.subject),
      bodyHtml: pick(custom.email?.bodyHtml, defaults.email.bodyHtml),
    },
    sms: defaults.sms && {
      message: pick(custom.sms?.message, defaults.sms.message),
    },
    inapp: defaults.inapp && {
      title: pick(custom.inapp?.title, defaults.inapp.title),
      body: pick(custom.inapp?.body, defaults.inapp.body),
      linkUrl: pick(custom.inapp?.linkUrl, defaults.inapp.linkUrl),
      linkLabel: pick(custom.inapp?.linkLabel, defaults.inapp.linkLabel),
    },
  };
}

/**
 * Compose the message for one (recipient, medium) pair by rendering the
 * effective templates. Rendering is strict: invalid tokens surface as a
 * visible "[unknown token: …]" marker (author-time validation should
 * have caught them) and are logged. The render context carries the
 * recipient (recipient roots) and the notifier's seeded record roots
 * plus the event envelope.
 */
export async function composeFromTemplates(
  plugin: EventNotifierPlugin,
  medium: NotificationMedium,
  recipient: NotifierRecipient,
  seeds: TokenRootSeed[],
  templates: NotifierChannelTemplates,
  cache: Map<string, unknown>,
): Promise<NotifierMessageContent | null> {
  const { storage } = await import("../../storage");
  const { renderTokens, createTokenEvalContext } = await import("../tokens");

  const render = async (template: string, clean: TokenValueCleaner | null) => {
    if (!template) return "";
    // A fresh context per rendered string is cheap; the shared cache
    // carries memoized lookups across strings, recipients and media.
    const ctx = createTokenEvalContext(storage, recipient.contactId, {
      cache,
      seeds,
    });
    const result = await renderTokens(template, ctx, {
      strictUnknown: true,
      clean: clean ?? undefined,
    });
    if (result.unknownTokens.length > 0) {
      logger.warn("Event-notifier template contained invalid tokens", {
        service: SERVICE,
        pluginId: plugin.id,
        medium,
        unknownTokens: result.unknownTokens,
      });
    }
    return result.output;
  };

  const channelTemplates = templates[medium as keyof NotifierChannelTemplates] as
    | Record<string, string | undefined>
    | undefined;
  const specs = NOTIFIER_CHANNEL_FIELDS[medium];
  // Media the templates don't cover (e.g. postal) are skipped.
  if (!channelTemplates || !specs) return null;

  // Render every field with the cleaning its destination declares,
  // then shape it exactly as the template studio previews it: trimming,
  // HTML sanitizing (AFTER token rendering, so a substituted value used
  // as a whole href faces the allowlist too), relative-link enforcement
  // and companion-field suppression all live in the shared shaping step.
  const shaped: Record<string, string> = {};
  for (const spec of specs) {
    const template = channelTemplates[spec.key];
    const rendered = typeof template === "string"
      ? await render(template, tokenCleanerFor(spec))
      : "";
    shaped[spec.key] = shapeRenderedValue(spec, rendered);
    if (spec.safety === "relative-url" && rendered.trim() && !shaped[spec.key]) {
      // Alert UIs hand non-relative links to window.open, so a rendered
      // "javascript:" or absolute URL would be a stored script-execution
      // / open-redirect vector. Save-time validation checks the raw
      // template; a token could still render something unsafe.
      logger.warn("Event-notifier in-app link was not a safe relative path; dropped", {
        service: SERVICE,
        pluginId: plugin.id,
        linkUrl: rendered.trim(),
      });
    }
  }
  const { values, deliverable } = applyFieldEligibility(specs, shaped);
  if (!deliverable) return null;

  if (medium === "email") {
    // bodyText derives from the sanitized HTML so both parts agree.
    const { htmlToPlainText } = await import("../../../shared/utils/html/to-text");
    return {
      subject: values.subject,
      bodyHtml: values.bodyHtml,
      bodyText: htmlToPlainText(values.bodyHtml),
    };
  }

  if (medium === "sms") return { message: values.message };

  if (medium === "inapp") {
    return {
      title: values.title,
      body: values.body,
      linkUrl: values.linkUrl || undefined,
      linkLabel: values.linkLabel || undefined,
    };
  }

  return null;
}
