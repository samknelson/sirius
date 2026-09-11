import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StudioField, StudioFieldMode } from "./TemplateStudio";
import { TokenRequestError } from "./TokenTreeBrowser";
import { TokenStudio } from "./TokenStudio";
import { MEDIUM_FIELDS, authoredFieldValue } from "@shared/delivery-fields";

// ─────────────────────────────────────────────────────────────────────────────
// Channel field spec: one template field as derived from the JSON Schema.
// Consumed by both this Studio host and the channel-templates RJSF field.
// ─────────────────────────────────────────────────────────────────────────────

/** One template field as declared in the server schema (templatesSchemaBlock). */
export interface ChannelFieldSpec {
  key: string;
  label: string;
  mode: StudioFieldMode;
  /** True for x-token-optional fields (e.g. linkLabel): only shown when the
   *  notifier declares a default for the field or the admin has already set one. */
  optional: boolean;
}

const CHANNEL_TITLES: Record<string, string> = {
  email: "Email templates",
  sms: "SMS template",
  inapp: "In-app notification templates",
};

/**
 * A notifier's default templates, per medium: the text delivery falls
 * back to for a field the admin has not overridden. Answered for the
 * config as it stands on screen, because a default can depend on the
 * notifier's other settings.
 */
export type NotifierDefaultTemplates = Record<string, Record<string, string>>;

export interface NotifierTemplateStudioProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "email" | "sms" | "inapp" — the channel group being edited. */
  channel: string;
  /** Fields for this channel, derived from the server JSON Schema (templatesSchemaBlock).
   *  Drives which editors appear and in what order — single source of truth shared with
   *  the config form's channel-templates RJSF field. */
  schemaRows: ChannelFieldSpec[];
  /**
   * Where this notifier's default templates come from, for the config on
   * screen — the same request the card behind this studio makes, so
   * asking it here is a cache read rather than a second round trip.
   *
   * Asked HERE rather than handed over as data because the merge below
   * is the whole of what this host does, and a merge against defaults
   * that never arrived produces blank text that looks authored. Owning
   * the request is what lets this say so.
   */
  defaultsUrl: string;
  /**
   * Where this notifier's preview records come from — the records its
   * recent events were about, for the config on screen. Passed through
   * to the studio, which owns the request.
   */
  seedsUrl: string;
  /**
   * This notifier's token context — the roots its templates may be
   * written about. Stamped into the config schema at registration and
   * read here from the shared `token-contexts` catalog, so the roots the
   * editor offers are the ones the server validates a save against.
   */
  contextId: string;
  /** The full live config data (for preview + reading current templates). */
  configData: Record<string, unknown>;
  /** Writes one template field back into the host form's config data. */
  updateConfigData: (path: string, value: unknown) => void;
  disabled?: boolean;
}

/**
 * Event-notifier host for the Template Studio: edits one channel group
 * of `data.templates` and previews through the shared preview route.
 *
 * The default-vs-override merge that delivery performs happens HERE:
 * the studio posts the finished template strings, so the preview route
 * does no notifier-specific work and cannot compose them differently
 * from the way this editor shows them.
 */
export function NotifierTemplateStudio({
  open,
  onOpenChange,
  channel,
  schemaRows,
  defaultsUrl,
  seedsUrl,
  contextId,
  configData,
  updateConfigData,
  disabled,
}: NotifierTemplateStudioProps) {
  // ── This notifier's defaults ──────────────────────────────────────────────
  const {
    data: defaultTemplates,
    isLoading: defaultsLoading,
    error: defaultsError,
    refetch: refetchDefaults,
  } = useQuery<NotifierDefaultTemplates>({
    queryKey: [defaultsUrl],
    enabled: open,
  });
  const defaults = defaultTemplates?.[channel] ?? {};

  // ── Fields & values (channel group of data.templates) ─────────────────────
  const templates =
    (configData.templates as Record<string, Record<string, unknown>> | undefined) ?? {};
  /** The stored override for a field ("" when the default applies). */
  const overrideOf = (key: string): string => {
    const v = templates[channel]?.[key];
    return typeof v === "string" ? v : "";
  };

  const fields: StudioField[] = useMemo(() => {
    // Derive editable fields from the server schema (schemaRows), not a local constant.
    // Optional fields (x-token-optional) only appear when the notifier's defaults
    // declare them or the admin has already customized them — mirrors the same
    // filter applied by NotifierChannelTemplatesField for its visible rows.
    return schemaRows
      .filter((f) => !f.optional || f.key in defaults || overrideOf(f.key).trim() !== "")
      .map((f) => ({
        key: f.key,
        label: f.label,
        mode: f.mode,
        // Only the customized state earns a line under the editor: it is the
        // one the author can act on (empty the field to go back to the
        // notifier's default). Sitting on the default needs no narration.
        hint:
          defaults[f.key] !== undefined && overrideOf(f.key).trim() !== ""
            ? "Customized — this text overrides the notifier's default template."
            : undefined,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaRows, defaults, JSON.stringify(templates[channel] ?? {})]);

  // Editors show the literal, editable effective text: the stored override
  // when one exists, otherwise the resolved default. `edited` tracks the
  // in-studio text so a field the user is clearing doesn't snap back to the
  // default mid-edit; the component remounts on each open, so seeding is
  // fresh every time (and picks up late-arriving defaults until the user
  // touches a field).
  const [edited, setEdited] = useState<Record<string, string>>({});
  const channelValues: Record<string, string> = {};
  for (const f of fields) {
    const override = overrideOf(f.key);
    channelValues[f.key] =
      edited[f.key] ?? (override.trim() !== "" ? override : (defaults[f.key] ?? ""));
  }

  // Store blank (no override — keeps tracking the default) when the text
  // equals the resolved default or is emptied out; otherwise store the text
  // as an override.
  const handleValueChange = (key: string, value: string) => {
    setEdited((prev) => ({ ...prev, [key]: value }));
    const normalized =
      value === (defaults[key] ?? "") || value.trim() === "" ? "" : value;
    updateConfigData(`templates.${channel}.${key}`, normalized);
  };

  // The effective template delivery would use, for EVERY field of the
  // channel — not just the rows on screen. An optional field the editor
  // hides still ships when the notifier declares a default for it, and
  // a required one that is blank is what makes the message
  // undeliverable, so both have to be in the preview request.
  const deliveryFields = MEDIUM_FIELDS[channel as keyof typeof MEDIUM_FIELDS] ?? [];
  const templateValues: Record<string, string> = {};
  for (const spec of deliveryFields) {
    const override = overrideOf(spec.key);
    // An optional field nobody has written a template for is left OUT
    // of the request, exactly as delivery leaves it out of the message;
    // a required one with nothing behind it is sent as the blank it is,
    // which is what makes the preview say "undeliverable".
    const authored = authoredFieldValue(
      spec,
      edited[spec.key] ??
        (override.trim() !== "" ? override : defaults[spec.key]),
    );
    if (authored !== undefined) templateValues[spec.key] = authored;
  }

  if (disabled) return null;

  return (
    <TokenStudio
      open={open}
      onOpenChange={onOpenChange}
      title={CHANNEL_TITLES[channel] ?? `${channel} templates`}
      description="Edit the channel's tokenized templates with a live preview. Changes apply to the config form; save the config to persist them."
      channel={channel === "email" || channel === "sms" || channel === "inapp" ? channel : "generic"}
      // Every editor below shows "the override, or the notifier's
      // default", and the preview is composed the same way. Without the
      // defaults that reads as a field nobody has written — so the one
      // thing this host fetches reports itself here.
      hostNotice={
        defaultsError ? (
          <TokenRequestError
            what="This notifier's default text"
            error={defaultsError}
            onRetry={() => {
              void refetchDefaults();
            }}
            testId="text-studio-defaults-error"
          />
        ) : defaultsLoading ? (
          <span
            className="text-xs text-muted-foreground"
            data-testid="text-studio-defaults-loading"
          >
            Loading this notifier's default text — fields it would fill
            are blank until it arrives.
          </span>
        ) : undefined
      }
      fields={fields}
      values={channelValues}
      onValueChange={handleValueChange}
      // Delivery's own field shaping for this channel, and the merged
      // text delivery would send — composed above, not on the server.
      fieldSpecs={deliveryFields}
      templateValues={templateValues}
      // What may be WRITTEN here is not this host's to answer: the
      // studio reads it from this notifier's token context — its own
      // record roots, the event envelope and the ordinary roots
      // (contact, system…) — which is the list the save is validated
      // against. What may be PREVIEWED against is this notifier's own,
      // so its endpoint is handed over.
      contextId={contextId}
      seedsUrl={seedsUrl}
    />
  );
}
