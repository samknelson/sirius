/**
 * Shared JSON-Schema builder for a token-templated notifier's
 * `templates` config block. EVERY token-templated notifier builds its
 * block from here — there is one framework, one client component, and
 * one UX for message templates.
 *
 * The editing UI is attached at the MEDIUM level, not the field level:
 * each channel group (email / sms / inapp) carries the
 * `notifier-channel-templates` vendor key, so the config form renders
 * one compact card per medium with a single Edit (Template Studio) and
 * a single Revert. The per-field keys below are metadata the card and
 * the Studio read (label, editor mode, where the default lives).
 *
 * A field is only stored as an override when it diverges from the
 * default — blank/untouched fields fall back to the notifier's default
 * template at runtime (see `pick()` in token-templates.ts).
 */

type TemplateMode = "line" | "multiline" | "html";

/** The channels a token-templated notifier can carry message templates for. */
export type TemplateChannel = "email" | "sms" | "inapp";

/**
 * The template channels the SITE can actually deliver on right now.
 * In-app is always available; email/SMS depend on a configured provider
 * with the matching capability. Provider checks fail OPEN (channel
 * treated as available) so a transient resolution hiccup never hides an
 * editing surface — hiding is purely a UX nicety, delivery gating stays
 * in the send layer.
 */
export async function getSiteEnabledTemplateChannels(): Promise<Set<TemplateChannel>> {
  const enabled = new Set<TemplateChannel>(["inapp"]);
  const { serviceRegistry } = await import("../../services/service-registry");

  const providerSupports = async (
    category: "email" | "sms",
    supports: (provider: unknown) => boolean,
  ): Promise<boolean> => {
    try {
      const config = await serviceRegistry.getCategoryConfig(category);
      const registered = serviceRegistry.getRegisteredProviders(category);
      // No provider registered/selected at all: the channel is genuinely
      // switched off for this site.
      if (registered.length === 0 || !config.defaultProvider) return false;
      const provider = await serviceRegistry.resolve(category);
      return supports(provider);
    } catch {
      return true; // fail open — see doc comment
    }
  };

  if (
    await providerSupports("email", (p) =>
      (p as { supportsEmail?: () => boolean }).supportsEmail?.() ?? true,
    )
  ) {
    enabled.add("email");
  }
  if (
    await providerSupports("sms", (p) =>
      (p as { supportsSms?: () => boolean }).supportsSms?.() ?? true,
    )
  ) {
    enabled.add("sms");
  }
  return enabled;
}

/**
 * Return a copy of a notifier's `configSchema` in which every template
 * channel group the notifier cannot actually deliver to — because the
 * plugin doesn't declare the medium in `supportedMedia`, or the site has
 * the channel switched off — carries `x-token-hidden: true`.
 *
 * The group (and its fields) stays DECLARED in the schema on purpose:
 * RJSF strips any stored data whose field isn't in the schema, so
 * removing the group would silently wipe an existing override for a
 * hidden medium on the next save. The client field renders nothing for
 * hidden groups instead, which preserves the stored data untouched.
 *
 * Returns the input schema unchanged (same reference) when nothing needs
 * hiding, so schemas without template blocks pay no cost.
 */
export function hideUndeliverableTemplateChannels(
  configSchema: Record<string, unknown> | undefined,
  supportedMedia: readonly string[],
  siteEnabled: ReadonlySet<TemplateChannel>,
): Record<string, unknown> | undefined {
  if (!configSchema) return configSchema;
  const props = configSchema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  const templates = props?.templates;
  const groups = templates?.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!groups) return configSchema;

  const deliverable = (channel: string): boolean =>
    supportedMedia.includes(channel) &&
    siteEnabled.has(channel as TemplateChannel);

  const toHide = Object.entries(groups).filter(
    ([, group]) =>
      group["x-widget"] === "notifier-channel-templates" &&
      typeof group["x-token-channel"] === "string" &&
      !deliverable(group["x-token-channel"] as string),
  );
  if (toHide.length === 0) return configSchema;

  const newGroups = { ...groups };
  for (const [key, group] of toHide) {
    newGroups[key] = { ...group, "x-token-hidden": true };
  }
  return {
    ...configSchema,
    properties: {
      ...props,
      templates: { ...templates, properties: newGroups },
    },
  };
}

/**
 * Name the notifier every template card in `configSchema` belongs to, so
 * the card can fetch that notifier's token catalog.
 *
 * Called once per notifier at registration, from the id the notifier is
 * actually registered under. It is deliberately NOT something a plugin
 * passes in: the catalog endpoint looks the notifier up by this id, and
 * a hand-written copy that drifts from the real one 404s — leaving the
 * Template Studio with no tokens, no defaults and no preview roots, with
 * nothing anywhere saying why.
 */
export function stampNotifierTemplateIds(
  configSchema: Record<string, unknown> | undefined,
  pluginId: string,
): number {
  const props = configSchema?.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  const groups = props?.templates?.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!groups) return 0;
  let stamped = 0;
  for (const group of Object.values(groups)) {
    if (group["x-widget"] !== "notifier-channel-templates") continue;
    group["x-token-plugin-id"] = pluginId;
    group["x-token-catalog-url"] =
      `/api/event-notifier/token-catalog/${encodeURIComponent(pluginId)}`;
    stamped++;
  }
  return stamped;
}

/** One token-template field: metadata only; the medium owns the editor. */
function templateField(
  title: string,
  defaultPath: string,
  mode: TemplateMode = "line",
  opts?: { optional?: boolean },
): Record<string, unknown> {
  const field: Record<string, unknown> = {
    type: "string",
    title,
    "x-token-template-mode": mode,
    "x-token-default-path": defaultPath,
  };
  if (opts?.optional) {
    // Shown only when the notifier's defaults declare it (or the admin
    // has already customized it) — e.g. a notifier with no in-app link
    // shouldn't grow a link label.
    field["x-token-optional"] = true;
  }
  return field;
}

/**
 * One medium's group: the unit the client renders as a single card.
 *
 * The notifier it belongs to is NOT named here — `stampNotifierTemplateIds`
 * fills that in from the id the notifier actually registers under.
 */
function channelGroup(
  channel: string,
  title: string,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "object",
    title,
    "x-widget": "notifier-channel-templates",
    "x-token-channel": channel,
    properties,
  };
}

/**
 * The full `templates` object schema (email subject/body, SMS message,
 * in-app title/body/link) for one notifier. `exampleTokens` seeds the
 * block's description so authors see a couple of relevant tokens.
 */
export function templatesSchemaBlock(
  opts?: { exampleTokens?: string[] },
): Record<string, unknown> {
  const examples = opts?.exampleTokens ?? [];
  const block: Record<string, unknown> = {
    type: "object",
    title: "Message templates",
    properties: {
      email: channelGroup(
        "email",
        "Email",
        {
          subject: templateField("Subject", "email.subject"),
          bodyHtml: templateField("Body (HTML)", "email.bodyHtml", "html"),
        },
      ),
      sms: channelGroup(
        "sms",
        "SMS",
        {
          message: templateField("Message", "sms.message", "multiline"),
        },
      ),
      inapp: channelGroup(
        "inapp",
        "In-app",
        {
          title: templateField("Title", "inapp.title"),
          body: templateField("Body", "inapp.body", "multiline"),
          linkUrl: templateField("Link URL (relative)", "inapp.linkUrl"),
          // Declared so a Studio edit isn't stripped by the form
          // library on save; hidden unless the notifier declares one.
          linkLabel: templateField("Link label", "inapp.linkLabel", "line", {
            optional: true,
          }),
        },
      ),
    },
  };
  if (examples.length > 0) {
    block.description = `Leave a field untouched to keep the notifier's default. Example tokens: ${examples.join(
      " ",
    )}`;
  }
  return block;
}
