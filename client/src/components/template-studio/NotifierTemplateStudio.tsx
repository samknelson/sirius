import { useMemo, useState } from "react";
import {
  TemplateStudio,
  type StudioContext,
  type StudioField,
  type StudioFieldMode,
  type StudioSourceState,
} from "./TemplateStudio";
import { NOTIFIER_CHANNEL_FIELDS } from "@shared/delivery-fields";
import type {
  TokenCatalogEntry,
  TokenFieldCatalog,
  TokenSegmentSpec,
} from "@shared/tokens";

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
  postal: "Postal letter template",
};

export interface NotifierTokenCatalog {
  /** Named record roots this notifier's templates may address. */
  rootNames: string[];
  segments: TokenSegmentSpec[];
  fields?: TokenFieldCatalog;
  defaults?: Record<string, Record<string, string>>;
  tokens?: TokenCatalogEntry[];
  /** What each of those roots may be previewed as. */
  studioContext?: StudioContext;
}
export interface NotifierTemplateStudioProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "email" | "sms" | "inapp" — the channel group being edited. */
  channel: string;
  /** Fields for this channel, derived from the server JSON Schema (templatesSchemaBlock).
   *  Drives which editors appear and in what order — single source of truth shared with
   *  the config form's channel-templates RJSF field. */
  schemaRows: ChannelFieldSpec[];
  catalog: NotifierTokenCatalog | undefined;
  /**
   * How the catalog request above went. The parent field owns that
   * query, so it is the only one that can tell the studio whether an
   * absent catalog is still loading or failed.
   */
  catalogState?: StudioSourceState;
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
  catalog,
  catalogState,
  configData,
  updateConfigData,
  disabled,
}: NotifierTemplateStudioProps) {
  // ── Fields & values (channel group of data.templates) ─────────────────────
  const defaults = catalog?.defaults?.[channel] ?? {};

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
  // fresh every time (and picks up late-arriving catalog defaults until the
  // user touches a field).
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
  const deliveryFields = NOTIFIER_CHANNEL_FIELDS[channel] ?? [];
  const templateValues: Record<string, string> = {};
  for (const spec of deliveryFields) {
    const override = overrideOf(spec.key);
    templateValues[spec.key] =
      edited[spec.key] ??
      (override.trim() !== "" ? override : (defaults[spec.key] ?? ""));
  }

  if (disabled) return null;

  return (
    <TemplateStudio
      open={open}
      onOpenChange={onOpenChange}
      title={CHANNEL_TITLES[channel] ?? `${channel} templates`}
      description="Edit the channel's tokenized templates with a live preview. Changes apply to the config form; save the config to persist them."
       channel={channel === "email" || channel === "sms" || channel === "inapp" || channel === "postal" ? channel : "generic"}
      fields={fields}
      values={channelValues}
      onValueChange={handleValueChange}
      // Delivery's own field shaping for this channel, and the merged
      // text delivery would send — composed above, not on the server.
      fieldSpecs={deliveryFields}
      templateValues={templateValues}
      tokens={catalog?.tokens ?? []}
      segments={catalog?.segments}
      fieldCatalog={catalog?.fields}
      // The notifier's own records first; the event envelope and the
      // ordinary roots (contact, system…) after them.
      rootNames={catalog?.rootNames ?? []}
      studioContext={catalog?.studioContext}
      catalogState={catalogState}
    />
  );
}
