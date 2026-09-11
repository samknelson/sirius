import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FieldProps } from "@rjsf/utils";
import { Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  NotifierTemplateStudio,
  type NotifierDefaultTemplates,
  type ChannelFieldSpec,
} from "@/components/template-studio/NotifierTemplateStudio";
import { TokenText } from "@/components/template-studio/TokenText";

/**
 * RJSF field for ONE medium of a notifier's message templates (email,
 * SMS, in-app). Triggered by the vendor key
 * `x-widget: "notifier-channel-templates"` on the channel object (see
 * SchemaForm's uiSchema mapping and the shared `templatesSchemaBlock`).
 *
 * The medium is the unit of interaction, because the Template Studio
 * always edits a whole channel group: one compact card per medium with
 * one "Edit" button and one "Revert" button, and a one-line summary per
 * field whose tokens render as labelled chips.
 *
 * Effective text = the stored override when non-blank, otherwise the
 * notifier's own default, which this card fetches. Revert writes blanks,
 * which the server treats as "no override" so the config keeps tracking
 * future default changes.
 */

function readRows(schema: Record<string, unknown>): ChannelFieldSpec[] {
  const props = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
  return Object.entries(props).map(([key, sub]) => ({
    key,
    label: (sub.title as string) || key,
    mode: (sub["x-token-template-mode"] as ChannelFieldSpec["mode"]) ?? "line",
    optional: sub["x-token-optional"] === true,
  }));
}

export function NotifierChannelTemplatesField(props: FieldProps) {
  const { schema, formData, onChange, disabled, readonly, registry, fieldPathId } =
    props;
  const schemaAny = schema as Record<string, unknown>;

  const channel = (schemaAny["x-token-channel"] as string) ?? "";
  // Both stamped into this group at registration, from the id the
  // notifier is actually registered under: the notifier whose defaults
  // this card fetches (and whose preview records the studio fetches),
  // and the token context whose roots its Template Studio writes about.
  // Neither is hand-written, so neither can drift from the notifier they
  // name.
  const pluginId = (schemaAny["x-token-plugin-id"] as string) ?? "";
  const contextId = (schemaAny["x-token-context-id"] as string) ?? "";
  const defaultsUrl = pluginId
    ? `/api/event-notifier/default-templates/${encodeURIComponent(pluginId)}`
    : "";
  const seedsUrl = pluginId
    ? `/api/event-notifier/preview-seeds/${encodeURIComponent(pluginId)}`
    : "";
  const title = (schemaAny.title as string) || channel;
  // Marked by the server when this notifier can't actually deliver on
  // this channel (not in its supportedMedia, or the site has the channel
  // off). Rendered as nothing — but the group stays declared in the
  // schema, so an existing stored override is preserved on save, not
  // wiped. Checked after the hooks below to keep the hook order stable.
  const hidden = schemaAny["x-token-hidden"] === true;
  const rows = useMemo(() => readRows(schemaAny), [schemaAny]);
  const isDisabled = Boolean(disabled || readonly);

  const formContext = registry?.formContext as
    | {
        configData?: Record<string, unknown>;
        updateConfigData?: (path: string, value: unknown) => void;
      }
    | undefined;
  const configData = formContext?.configData ?? {};
  const updateConfigData = formContext?.updateConfigData;

  // Both of this notifier's answers — the defaults asked for here, the
  // preview records the studio asks for — are about THIS config as it
  // stands on screen: a link target that varies with the recipient kind,
  // the events that would have triggered it. Which settings they read is
  // the notifier's business — a list of "the fields that matter"
  // maintained out here goes stale the moment one of them reads another
  // field, and a stale list shows an author defaults and recipients that
  // are not the ones their config would produce. So the whole config
  // goes, minus the templates being edited: those are the answer this
  // request is about, never an input to it.
  const configQuery = useMemo(() => {
    const { templates: _templates, ...settings } = configData;
    return Object.keys(settings).length > 0 ? JSON.stringify(settings) : "";
  }, [configData]);
  // Settled, not live: a keystroke in any config field would otherwise
  // re-ask for the defaults — and, in the open studio, replay this
  // notifier's recent events behind its seed records — once per
  // character.
  const [settledConfig, setSettledConfig] = useState(configQuery);
  useEffect(() => {
    if (settledConfig === configQuery) return;
    const timer = setTimeout(() => setSettledConfig(configQuery), 400);
    return () => clearTimeout(timer);
  }, [configQuery, settledConfig]);
  const depQuery = settledConfig
    ? `?config=${encodeURIComponent(settledConfig)}`
    : "";

  const {
    data: defaultTemplates,
    error: defaultsError,
  } = useQuery<NotifierDefaultTemplates>({
    queryKey: [defaultsUrl + depQuery],
    enabled: !!defaultsUrl && !hidden,
  });
  const defaults = defaultTemplates?.[channel] ?? {};

  const stored = (formData as Record<string, unknown> | undefined) ?? {};
  /** The stored override for a field ("" when the default applies). */
  const overrideOf = (key: string): string => {
    const v = stored[key];
    return typeof v === "string" ? v : "";
  };

  // Optional fields (e.g. an in-app link label) only appear when this
  // notifier declares a default for them or the admin already set one.
  const visibleRows = rows.filter(
    (r) => !r.optional || r.key in defaults || overrideOf(r.key).trim() !== "",
  );
  const hasOverride = rows.some((r) => overrideOf(r.key).trim() !== "");

  const [studioOpen, setStudioOpen] = useState(false);
  /**
   * Why this medium cannot be edited, when the reason is a WIRING fault
   * rather than a read-only form.
   *
   * Both ids are stamped into the group at registration, so an absent
   * one means the schema this card was handed is not a token-templated
   * notifier's — and the author has to be told that. Hiding Edit on its
   * own would leave a card that looks ordinary, offers no way in and
   * says nothing, which is the same screen a notifier with nothing to
   * customize would produce.
   */
  const wiringFault = !pluginId
    ? "This medium's config schema does not name the notifier its templates belong to, so its defaults and preview records can't be loaded."
    : !contextId
      ? "This medium's config schema does not name a token context, so there is nothing to say what these templates are written about."
      : undefined;
  // `wiringFault` covers both ids, and the catalog URL is built from one
  // of them, so it is the whole of "this card is wired up".
  const canEdit =
    !!channel && !wiringFault && !!updateConfigData && !isDisabled;

  /** Clear every field in this medium — back to the notifier defaults. */
  const revert = () => {
    const cleared: Record<string, string> = {};
    for (const r of rows) cleared[r.key] = "";
    onChange(cleared, fieldPathId.path);
  };

  if (hidden) return null;

  return (
    <div
      className="rounded-md border bg-muted/20"
      data-testid={`channel-templates-${channel}`}
    >
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-sm font-medium">{title}</span>
        <span
          className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
          data-testid={`badge-state-${channel}`}
        >
          {hasOverride ? "Customized" : "Default"}
        </span>
        <span className="flex-1" />
        {!isDisabled && (
          // Always present (one Edit + one Revert per medium), disabled
          // while the medium is untouched and there is nothing to undo.
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!hasOverride}
            className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            data-testid={`button-revert-${channel}`}
            onClick={revert}
            title={
              hasOverride
                ? "Revert this medium to the notifier's default templates"
                : "Already using the notifier's default templates"
            }
          >
            <RotateCcw className="h-3 w-3" />
            Revert
          </Button>
        )}
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs"
            data-testid={`button-edit-${channel}`}
            onClick={() => setStudioOpen(true)}
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Button>
        )}
        {wiringFault && !isDisabled && (
          <span
            className="max-w-[28rem] text-xs text-destructive"
            data-testid={`editor-unavailable-${channel}`}
          >
            Can't open the Template Studio. {wiringFault}
          </span>
        )}
        {/* Every summary below is "the override, or the default" — so
            without the defaults, a row showing "Not set" or the
            Default/Customized badge may simply be wrong. Say so, and
            leave Edit open: the studio is still usable, and its own
            revert-to-default is what actually needs them. */}
        {!wiringFault && defaultsError && (
          <span
            className="max-w-[28rem] text-xs text-destructive"
            data-testid={`defaults-unavailable-${channel}`}
          >
            Couldn't load this notifier's default text, so rows below show
            only what's been customized.
          </span>
        )}
      </div>

      <div className="divide-y">
        {visibleRows.map((r) => {
          const override = overrideOf(r.key);
          const effective = override.trim() !== "" ? override : (defaults[r.key] ?? "");
          return (
            <div
              key={r.key}
              className="flex items-baseline gap-3 px-3 py-1"
              data-testid={`template-row-${channel}-${r.key}`}
            >
              <span className="w-24 shrink-0 truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                {r.label}
              </span>
              {effective ? (
                <TokenText
                  text={effective}
                  html={r.mode === "html"}
                  className="min-w-0 flex-1 truncate text-xs leading-6"
                  data-testid={`template-summary-${channel}-${r.key}`}
                />
              ) : (
                <span
                  className="min-w-0 flex-1 truncate text-xs italic leading-6 text-muted-foreground"
                  data-testid={`template-summary-${channel}-${r.key}`}
                >
                  Not set
                </span>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && studioOpen && (
        <NotifierTemplateStudio
          open={studioOpen}
          onOpenChange={setStudioOpen}
          channel={channel}
          schemaRows={rows}
          // Both asked for the same config this card asked about: the
          // defaults (the same request as this card's, so the studio
          // reads them from cache) and this notifier's preview records.
          defaultsUrl={defaultsUrl + depQuery}
          seedsUrl={seedsUrl + depQuery}
          contextId={contextId}
          configData={configData}
          updateConfigData={updateConfigData!}
        />
      )}
    </div>
  );
}
