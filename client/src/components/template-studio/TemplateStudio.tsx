import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  SimpleHtmlEditor,
  type SimpleHtmlEditorApi,
} from "@/components/ui/simple-html-editor";
import {
  TokenRequestError,
  TokenTreeBrowser,
  useTokenTreeRoots,
  type TokenTreeRootsState,
} from "./TokenTreeBrowser";
import { SlashTokenField } from "./SlashTokenField";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/queryClient";
import { AlertTriangle, Bell, ChevronDown, Loader2 } from "lucide-react";
import {
  analyzeTemplateTokens,
  type TokenCatalogEntry,
  type TokenFieldCatalog,
  type TokenSegmentSpec,
} from "@shared/tokens";
import type { DeliveryFieldSpec } from "@shared/delivery-fields";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModalSeed } from "@/hooks/use-modal-seed";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type StudioFieldMode = "line" | "multiline" | "html";

export interface StudioField {
  /** Key into values / preview results (e.g. "subject", "bodyHtml"). */
  key: string;
  label: string;
  mode: StudioFieldMode;
  /** Optional helper text under the editor. */
  hint?: string;
  /** Default template shown as placeholder for non-HTML fields. */
  placeholder?: string;
  /**
   * Hard character limit on the AUTHORED text, when the destination has
   * one (an in-app title is a `varchar(100)`). Counts the template as
   * typed, tokens included — the same limit the storing column applies.
   */
  maxLength?: number;
}

export interface StudioPreviewField {
  rendered: string;
  unknownTokens: string[];
  missingValues: string[];
  /**
   * Tokens that contributed nothing to the output. Distinct from
   * `missingValues` (which rendered a sample/default): these leave an
   * invisible hole the admin would otherwise ship unnoticed.
   */
  emptyValues: string[];
}

export type StudioChannel = "email" | "sms" | "inapp" | "postal" | "generic";

/** One root of the render and whether it resolved real or sample data. */
export interface StudioPreviewRootResult {
  /** Root NAME — the segment a chain starts with (`dispatch`, `worker`). */
  name: string;
  kind: string;
  label: string;
  recordId: string | null;
  real: boolean;
}

/** A named sample persona a root can render as. */
export interface StudioSampleSet {
  id: string;
  label: string;
}

/** A real record a root can render as, supplied by the host's context. */
export interface StudioSeedRecord {
  id: string;
  label: string;
  hint?: string;
  /**
   * The container's occurrence(s) this record came out of. Records in
   * different roots that share one were true together — a notifier
   * replaying an event knows its grievance, its status entry and its
   * recipient came from that one moment — so choosing one chooses its
   * siblings. Absent when a container's records are unrelated (a bulk
   * message's recipients), and each root is then picked on its own.
   */
  occurrenceIds?: string[];
}


/** Why a root has no real records (mirrors `TokenStudioNoRecordsReason`). */
export type StudioNoRecordsReason =
  | "none-supplied"
  | "unreadable"
  | "records-gone"
  | "not-previewable";

/** One root and everything it may be previewed as. */
export interface StudioContextRoot {
  /** Root NAME — the segment a chain starts with (`dispatch`, `worker`). */
  name: string;
  kind: string;
  label: string;
  samples: StudioSampleSet[];
  records: StudioSeedRecord[];
  /** Why there are none, when there are none. */
  noRecords?: {
    reason: StudioNoRecordsReason;
    /** The container's own words ("this message has no recipients yet"). */
    note?: string;
    /** The kind's refusal, when it cannot be previewed at all. */
    detail?: string;
  };
}

/**
 * What this studio can preview against, built by whatever OPENED it:
 * the roots, and per root the real records that container supplied
 * plus the sample personas.
 *
 * There is no search box, because a template editor is not a record
 * finder: the container already knows which records this template is
 * about (a bulk message knows its own recipients), and every record
 * here has already passed its kind's read gate for this author.
 */
export interface StudioContext {
  roots: StudioContextRoot[];
}

/**
 * How one of the studio's data sources is doing. The studio is opened
 * from many hosts, each with its own endpoints and its own gate, so
 * "why is this one empty?" is a question the studio has to be able to
 * answer about a request it did not make itself.
 */
export interface StudioSourceState {
  /** The endpoint being used, verbatim — the diagnostics line shows it. */
  url?: string;
  loading?: boolean;
  /** The failure, when the request failed. */
  error?: unknown;
  /** Ask for it again. */
  retry?: () => void;
}

/** The preview render route's response shape. */
export interface StudioPreviewResult {
  /**
   * True when NO root had a real record — every RECORD in the render is a
   * sample. System values (this site's address, today's date) have no
   * record behind them and stay real even then.
   */
  sample: boolean;
  /** Per-root sample-vs-real, so the preview can say which is which. */
  roots?: StudioPreviewRootResult[];
  contactId: string | null;
  /** Per-field rendered output keyed by StudioField.key. */
  fields: Record<string, StudioPreviewField>;
  /**
   * False when delivery would send nothing with these values (a
   * required field — an in-app title, an email subject — is blank).
   */
  deliverable: boolean;
}

/**
 * What the preview renders against: one entry per root, each naming
 * either a real record or a sample persona. The server gates every
 * named record as a read of it before seeding — the list the studio was
 * opened with is UX, not the authorization boundary.
 */
interface PreviewSeedRequest {
  seeds: Array<
    | { rootName: string; record: { kind: string; id: string } }
    | { rootName: string; sampleSetId: string }
  >;
}

export interface TemplateStudioProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  channel: StudioChannel;
  fields: StudioField[];
  values: Record<string, string>;
  onValueChange: (key: string, value: string) => void;
  /**
   * How DELIVERY shapes each previewed field — taken from the shared
   * delivery declarations (`@shared/delivery-fields`), never
   * hand-written, so the preview can only claim shaping that delivery
   * actually performs. Omit to derive plain text / HTML from each
   * editor's own mode, which is right for an ad-hoc tokenized field
   * with no delivery composition of its own.
   */
  fieldSpecs?: DeliveryFieldSpec[];
  /**
   * FINISHED template strings to preview, keyed by delivery field key.
   * Defaults to the editors' own `values`; a host whose editor state
   * is not yet the delivered text (a notifier's default-vs-override
   * merge, a rich-text body flattened to plain text) composes them
   * here.
   */
  templateValues?: Record<string, string>;
  /** Token browser entries. */
  tokens: TokenCatalogEntry[];
  /** Segment graph for live token validation (omit to skip validation). */
  segments?: TokenSegmentSpec[];
  fieldCatalog?: TokenFieldCatalog;
  /**
   * Named record roots these templates address (`dispatch`, `event`,
   * …) — the roots the token browser starts its tree at.
   */
  rootNames?: string[];
  /**
   * What this studio may preview against, built server-side by the
   * container that opened it (see {@link StudioContext}). Absent — a
   * catalog still loading — means sample data only, chosen by the
   * server's own per-kind fallback.
   */
  studioContext?: StudioContext;
  /** Tree endpoints for this host (defaults to the studio's own). */
  treeBaseUrl?: string;
  /**
   * How the host's catalog request went. Every host loads its own
   * catalog from its own endpoint, so only the host can say whether
   * that request is still running or failed — and without being told,
   * the studio cannot tell a failure apart from an empty answer, which
   * is exactly how a broken launch point ends up looking like a
   * tokenless one. Omit only where there is no request to report.
   */
  catalogState?: StudioSourceState;
}

/** Plain text, unless the editor is a rich-text one. */
function specsFromFieldModes(fields: StudioField[]): DeliveryFieldSpec[] {
  return fields.map((f) => ({
    key: f.key,
    syntax: f.mode === "html" ? ("html" as const) : ("text" as const),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor tracking + insert-at-cursor for line/multiline fields
// ─────────────────────────────────────────────────────────────────────────────

type PlainTarget = HTMLInputElement | HTMLTextAreaElement;

interface ActiveEditorRef {
  key: string;
  /**
   * "literal" fields are focusable but never receive a token: delivery
   * sends them verbatim, so an inserted chain would ship as braces.
   * They still claim the active slot so a token picked while one is
   * focused is refused, rather than landing in the last tokenized
   * field the author happened to touch.
   */
  kind: "plain" | "html" | "literal";
  el?: PlainTarget;
  htmlApi?: React.MutableRefObject<SimpleHtmlEditorApi | null>;
}

function SmsPreviewBubble({ text }: { text: string }) {
  const count = text.length;
  const segments = count === 0 ? 0 : Math.ceil(count / 160);
  return (
    <div className="space-y-2">
      <div className="flex justify-start">
        <div
          className="max-w-[85%] rounded-2xl rounded-bl-sm bg-primary text-primary-foreground px-4 py-2 text-sm whitespace-pre-wrap break-words"
          data-testid="studio-preview-sms-bubble"
        >
          {text || <span className="italic opacity-70">(empty message)</span>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground text-right" data-testid="studio-preview-sms-count">
        {count} characters · {segments} SMS segment{segments === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function InappPreviewCard({
  title,
  body,
  linkUrl,
  linkLabel,
}: {
  title: string;
  body: string;
  linkUrl?: string;
  linkLabel?: string;
}) {
  return (
    <div className="rounded-lg border bg-background shadow-sm p-3 space-y-1.5" data-testid="studio-preview-inapp-card">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded-full bg-primary/10 p-1.5 text-primary shrink-0">
          <Bell className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium break-words">
            {title || <span className="italic text-muted-foreground">(no title)</span>}
          </p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
            {body || <span className="italic">(no body)</span>}
          </p>
          {linkUrl ? (
            <p className="mt-1">
              <span className="text-sm text-primary underline underline-offset-2" title={linkUrl}>
                {linkLabel || linkUrl}
              </span>
              <span className="ml-2 text-xs text-muted-foreground font-mono break-all">{linkUrl}</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Which of the right-hand column's three sections is expanded. */
type StudioPanelId = "preview" | "context" | "tokens";

/**
 * One collapsible section of the studio's right-hand column. Exactly one
 * is open at a time and it takes the column's remaining height — all
 * three expanded left each of them a squeezed slice of the dialog.
 *
 * A closed section stays MOUNTED behind `hidden` rather than being
 * unmounted: collapsing the token browser must not throw away where the
 * author had browsed to, and collapsing the preview must not make it
 * render again on the way back.
 */
function StudioPanel({
  id,
  title,
  status,
  open,
  onOpen,
  children,
}: {
  id: StudioPanelId;
  title: string;
  /** Shown beside the title, so it still reads while the section is closed. */
  status?: React.ReactNode;
  open: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("flex flex-col min-h-0 border-b last:border-b-0", open && "flex-1")}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        aria-controls={`studio-panel-${id}`}
        className="shrink-0 flex items-center gap-2 px-4 py-2.5 text-left hover-elevate"
        data-testid={`button-studio-panel-${id}`}
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open ? "" : "-rotate-90",
          )}
        />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {status}
      </button>
      <div
        id={`studio-panel-${id}`}
        data-testid={`studio-panel-body-${id}`}
        className={cn("min-h-0 flex-1 flex flex-col", !open && "hidden")}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Which endpoints THIS launch point used and what came back.
 *
 * The studio is opened from many hosts, each passing its own catalog
 * and tree endpoints; working out why one of them looks empty used to
 * need a developer with database access. It is the studio's own
 * question, so the studio answers it, in the browser, the same way at
 * every launch point.
 */
function StudioDiagnostics({
  catalogState,
  tokenCount,
  segmentCount,
  contextRootCount,
  rootNames,
  treeRoots,
  treeNotAsked,
  previewError,
}: {
  catalogState?: StudioSourceState;
  tokenCount: number;
  segmentCount: number;
  contextRootCount: number;
  rootNames?: string[];
  treeRoots: TokenTreeRootsState;
  /** Why the tree was never requested, when it was not. */
  treeNotAsked?: string;
  previewError: unknown;
}) {
  const catalogStatus = catalogState?.error
    ? `FAILED — ${getApiErrorMessage(catalogState.error, "request failed")}`
    : catalogState?.loading
      ? "loading…"
      : `${tokenCount} tokens, ${segmentCount} segments, ${contextRootCount} preview roots`;
  const treeStatus = treeNotAsked
    ? `not requested — ${treeNotAsked}`
    : treeRoots.error
      ? `FAILED — ${getApiErrorMessage(treeRoots.error, "request failed")}`
      : treeRoots.loading
        ? "loading…"
        : `${treeRoots.roots.length} tree roots`;
  const previewStatus = previewError
    ? `last error — ${getApiErrorMessage(previewError, "request failed")}`
    : "no error";
  const line = "break-all";
  return (
    <details className="min-w-0 flex-1 text-xs" data-testid="studio-diagnostics">
      <summary
        className="cursor-pointer select-none text-muted-foreground"
        data-testid="button-studio-diagnostics"
      >
        Where this studio's data came from
      </summary>
      <div className="mt-2 max-h-32 overflow-y-auto space-y-1 font-mono text-[11px] text-muted-foreground">
        <div className={line} data-testid="text-diagnostic-catalog">
          catalog: {catalogState?.url ?? "(supplied by the host, not fetched here)"} — {catalogStatus}
        </div>
        <div className={line} data-testid="text-diagnostic-tree">
          tree: {treeRoots.url} — {treeStatus}
        </div>
        <div className={line} data-testid="text-diagnostic-preview">
          preview: POST /api/template-studio/preview — {previewStatus}
        </div>
        <div className={line} data-testid="text-diagnostic-roots">
          roots asked for:{" "}
          {rootNames?.length ? rootNames.join(", ") : "(none named — this host's default set)"}
        </div>
      </div>
    </details>
  );
}

/**
 * Why a root has nothing real to preview against, said in the author's
 * words. The container's own note wins when it left one — only it knows
 * that the reason is "this message has no recipients yet".
 */
function noRecordsMessage(root: StudioContextRoot): string {
  const noRecords = root.noRecords;
  const label = root.label.toLowerCase();
  if (noRecords?.note) return noRecords.note;
  switch (noRecords?.reason) {
    case "none-supplied":
      return `The editor that opened this studio has no ${label} records for it.`;
    case "unreadable":
      return `You may not read the ${label} records this editor supplied.`;
    case "records-gone":
      return `The ${label} records this editor named no longer exist.`;
    case "not-previewable":
      return (
        noRecords.detail ??
        `${root.label} records cannot be previewed against.`
      );
    default:
      return `No real ${label} records were supplied here.`;
  }
}

/** One root's seed picker, plus the truth about what is in it. */
function SeedPicker({
  root,
  value,
  onChange,
}: {
  root: StudioContextRoot;
  value: string;
  onChange: (value: string) => void;
}) {
  // Every real record here is one the container that opened this studio
  // put forward. There is no other source: a root it supplied nothing
  // for shows its sample personas, rather than the first records of
  // that kind, which is what once made 11 unrelated employers look like
  // a bulk message's employers.
  return (
    <div className="space-y-1" data-testid={`studio-seed-root-${root.name}`}>
      <Label className="text-xs text-muted-foreground">{root.label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className="h-8 text-sm"
          data-testid={`select-studio-seed-${root.name}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {root.records.length > 0 && (
            <SelectGroup>
              <SelectLabel>Real records</SelectLabel>
              {root.records.map((r) => (
                <SelectItem
                  key={r.id}
                  value={`record:${r.id}`}
                  data-testid={`studio-seed-record-${r.id}`}
                >
                  {r.label}
                  {r.hint ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {r.hint}
                    </span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          <SelectGroup>
            <SelectLabel>Sample data</SelectLabel>
            {root.samples.map((s) => (
              <SelectItem
                key={s.id}
                value={`sample:${s.id}`}
                data-testid={`studio-seed-sample-${root.name}-${s.id}`}
              >
                {s.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {root.records.length === 0 ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid={`text-studio-no-records-${root.name}`}
        >
          {noRecordsMessage(root)} Sample personas only.
        </p>
      ) : null}
    </div>
  );
}

function FieldIssues({ field }: { field: StudioPreviewField | undefined }) {
  if (!field) return null;
  return (
    <>
      {field.missingValues.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Sample/default values used:</span>{" "}
          {field.missingValues.map((t) => `{{${t}}}`).join(", ")}
        </p>
      )}
      {field.emptyValues.length > 0 && (
        <div
          className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400"
          data-testid="studio-preview-empty-tokens"
        >
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            <span className="font-medium">Rendered nothing:</span>{" "}
            {field.emptyValues.map((t) => `{{${t}}}`).join(", ")} — these leave a
            gap in the message, not a blank value.
          </span>
        </div>
      )}
      {field.unknownTokens.length > 0 && (
        <div className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            <span className="font-medium">Invalid tokens:</span>{" "}
            {field.unknownTokens.map((t) => `{{${t}}}`).join(", ")}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Near-fullscreen tokenized-template editor: editors on the left, a
 * debounced live server-rendered preview + token browser on the right.
 * Channel-aware preview: email renders the
 * composed subject + body, SMS a character-counted bubble, in-app a mock
 * notification card.
 */
export function TemplateStudio({
  open,
  onOpenChange,
  title,
  description,
  channel,
  fields,
  values,
  onValueChange,
  fieldSpecs,
  templateValues,
  tokens,
  segments,
  fieldCatalog,
  rootNames,
  studioContext,
  treeBaseUrl,
  catalogState,
}: TemplateStudioProps) {
  const activeEditorRef = useRef<ActiveEditorRef | null>(null);
  const htmlApiRefs = useRef<Record<string, React.MutableRefObject<SimpleHtmlEditorApi | null>>>({});
  const getHtmlApiRef = (key: string) => {
    if (!htmlApiRefs.current[key]) {
      htmlApiRefs.current[key] = { current: null };
    }
    return htmlApiRefs.current[key];
  };

  // ── The preview request ────────────────────────────────────────────────────
  // Everything the preview needs is right here: the delivery shaping,
  // the finished template text, the roots it may address and the
  // context to render against. The server looks nothing up.
  const specs = useMemo(
    () => fieldSpecs ?? specsFromFieldModes(fields),
    [fieldSpecs, fields],
  );
  const specsJson = JSON.stringify(specs);
  const rootNamesJson = JSON.stringify(rootNames ?? []);

  // Fields delivery sends VERBATIM. They are edited here like any other
  // field, but they get no token affordances: a token typed into one
  // arrives at the recipient as `{{...}}`.
  const literalKeys = useMemo(
    () => new Set(specs.filter((s) => s.tokenized === false).map((s) => s.key)),
    [specsJson], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── What each root renders as ──────────────────────────────────────────────
  // The container that opened this studio already said what each root
  // may render as (`studioContext`), so there is nothing to look up and
  // nothing to search: the author picks one thing per root from a list
  // that was gated for them before it arrived.
  const contextRoots = studioContext?.roots ?? [];
  // A context that never arrived is not a context that is empty. Kept
  // apart everywhere below, because conflating them is the whole defect.
  const catalogFailed = Boolean(catalogState?.error);
  const catalogLoading = Boolean(catalogState?.loading) && !studioContext;

  /**
   * Is the token browser browsing THIS host's tokens?
   *
   * It is when something scopes it: roots the host named itself, or a
   * tree endpoint of its own (which scopes server-side). With neither,
   * the scope was supposed to come from the catalog — and until that
   * arrives, the default tree is the whole site's token list, not this
   * host's. Showing it would be the same lie in a different panel:
   * a failed request reading as a usable, but foreign, token source.
   */
  const treeScopeKnown = (rootNames?.length ?? 0) > 0 || Boolean(treeBaseUrl);
  const tokenSourceUnknown =
    !treeScopeKnown && (catalogLoading || catalogFailed);

  // The tree endpoints this host is using, read from the SAME query the
  // token browser reads, so the diagnostics report what the picker
  // actually got rather than a second opinion.
  const treeRoots = useTokenTreeRoots({
    treeBaseUrl,
    rootNames,
    enabled: open && !tokenSourceUnknown,
  });

  /**
   * The roots the render reports on: exactly the ones shown here, in
   * the order the container put them in. The panel and the preview's
   * real-vs-sample report can therefore never disagree, and a root the
   * author cannot see is never claimed to have been rendered. Before the
   * context arrives the named roots are the best the studio knows.
   */
  const previewRootNames =
    contextRoots.length > 0 ? contextRoots.map((r) => r.name) : (rootNames ?? []);
  const previewRootNamesJson = JSON.stringify(previewRootNames);

  /**
   * The author's pick per root NAME, as `record:<id>` / `sample:<id>`.
   * Only what they actually changed is kept; every root falls back to
   * the default below, so a pick can never outlive the list it was made
   * from — an option that is gone is simply not chosen any more.
   * Picks are deliberate and do not survive the studio closing.
   */
  const [chosen, setChosen] = useState<Record<string, string>>({});

  /** The expanded right-hand section; the studio always opens on the preview. */
  const [panel, setPanel] = useState<StudioPanelId>("preview");

  // Both cleared during the render that opens the studio, so the seed pickers
  // never render the previous session's picks before the reset lands, and the
  // column never flashes the section the last session was left on.
  useModalSeed(open, null, () => {
    setChosen({});
    setPanel("preview");
  });

  /** This root's personas-only choice — the first one it declares. */
  const sampleChoice = (root: StudioContextRoot): string =>
    `sample:${root.samples[0]?.id ?? ""}`;

  /**
   * What each root renders as before the author touches anything: the
   * first real record the container supplied, else a persona. A
   * container that has records in hand is saying "this is what the
   * template is about", so previewing against one of them is what the
   * author wants to see first.
   *
   * When those records come in coherent sets, the whole default is ONE
   * of them — the first root's first record picks the occurrence, and
   * the other roots show that occurrence's records. A root the
   * occurrence never touched opens on a persona rather than on some
   * other occurrence's record, because "this event had no such record"
   * is true and "here is an unrelated one" is not.
   */
  const defaultSeeds = useMemo(() => {
    const anchor = contextRoots.find((r) => r.records.length > 0);
    const occurrences = anchor?.records[0]?.occurrenceIds ?? [];
    const seeds: Record<string, string> = {};
    for (const root of contextRoots) {
      const record =
        occurrences.length > 0
          ? root.records.find((r) =>
              r.occurrenceIds?.some((id) => occurrences.includes(id)),
            )
          : root.records[0];
      seeds[root.name] = record
        ? `record:${record.id}`
        : sampleChoice(root);
    }
    return seeds;
  }, [contextRoots]);

  const defaultChoice = (root: StudioContextRoot): string =>
    defaultSeeds[root.name] ?? sampleChoice(root);

  const choiceFor = (root: StudioContextRoot): string => {
    const picked = chosen[root.name];
    if (picked?.startsWith("record:")) {
      const id = picked.slice("record:".length);
      if (root.records.some((r) => r.id === id)) return picked;
    } else if (picked?.startsWith("sample:")) {
      const id = picked.slice("sample:".length);
      if (root.samples.some((s) => s.id === id)) return picked;
    }
    return defaultChoice(root);
  };

  /**
   * Choose what one root renders as — and, when the container's records
   * come in coherent sets, what the roots that shared that occurrence
   * render as too.
   *
   * A notifier's records are one event's records: the grievance, the
   * status entry it moved into and the person it was sent to were all
   * true at one moment. Left to pick independently, an author could
   * preview Tuesday's grievance beside this morning's status entry and
   * be shown a message that was never sent and could not be. So a pick
   * carries its siblings with it: every other root holding a record
   * from the same occurrence follows. Roots with nothing from that
   * occurrence are left exactly as the author had them — a persona for
   * a root this event never touched is still the honest answer.
   */
  const chooseSeed = (root: StudioContextRoot, choice: string) => {
    const next: Record<string, string> = { [root.name]: choice };
    const picked = choice.startsWith("record:")
      ? root.records.find((r) => r.id === choice.slice("record:".length))
      : undefined;
    const occurrences = picked?.occurrenceIds ?? [];
    if (occurrences.length > 0) {
      for (const other of contextRoots) {
        if (other.name === root.name) continue;
        const sibling = other.records.find((r) =>
          r.occurrenceIds?.some((id) => occurrences.includes(id)),
        );
        if (sibling) {
          next[other.name] = `record:${sibling.id}`;
          continue;
        }
        // No record here from the occurrence just chosen. Anything this
        // root is showing from a DIFFERENT one has to go — that is the
        // mixture this whole rule exists to prevent — and a persona
        // takes its place.
        const current = choiceFor(other);
        const showing = current.startsWith("record:")
          ? other.records.find((r) => r.id === current.slice("record:".length))
          : undefined;
        if (showing?.occurrenceIds?.length) {
          next[other.name] = sampleChoice(other);
        }
      }
    }
    setChosen((prev) => ({ ...prev, ...next }));
  };

  const effectiveContext: PreviewSeedRequest | undefined =
    contextRoots.length > 0
      ? {
          seeds: contextRoots.map((root) => {
            const choice = choiceFor(root);
            const id = choice.slice(choice.indexOf(":") + 1);
            return choice.startsWith("record:")
              ? { rootName: root.name, record: { kind: root.kind, id } }
              : { rootName: root.name, sampleSetId: id };
          }),
        }
      : undefined;
  const contextJson = JSON.stringify(effectiveContext ?? null);

  // ── Debounced preview ──────────────────────────────────────────────────────
  const valuesJson = JSON.stringify(templateValues ?? values);
  const [debouncedJson, setDebouncedJson] = useState(valuesJson);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebouncedJson(valuesJson), 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [valuesJson, open]);
  // Opening the studio previews the current values immediately — seeded in the
  // render phase so the preview pane's first render is this session's template,
  // not the last one's. Changing what a root renders as re-previews at once
  // too: the author asked to see something different, not to wait out a
  // keystroke timer.
  useModalSeed(open, contextJson, () => setDebouncedJson(valuesJson));

  const {
    data: preview,
    isFetching: previewLoading,
    error: previewError,
  } = useQuery<StudioPreviewResult>({
    queryKey: [
      "template-studio-preview",
      specsJson,
      previewRootNamesJson,
      contextJson,
      debouncedJson,
    ],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const body: Record<string, unknown> = {
        fields: specs,
        values: JSON.parse(debouncedJson) as Record<string, string>,
        rootNames: previewRootNames,
      };
      if (effectiveContext) body.context = effectiveContext;
      const res = await fetch("/api/template-studio/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? `Preview failed (${res.status})`,
        );
      }
      return (await res.json()) as StudioPreviewResult;
    },
  });

  // ── Token insertion ────────────────────────────────────────────────────────
  const insertSnippet = useCallback(
    (snippet: string) => {
      // With nothing focused, insert into the first field delivery
      // actually renders tokens in — a literal field would keep the
      // token verbatim and the author would never see why.
      const fallback = fields.find((f) => !literalKeys.has(f.key));
      const active: ActiveEditorRef | null =
        activeEditorRef.current ??
        (fallback
          ? {
              key: fallback.key,
              kind: fallback.mode === "html" ? ("html" as const) : ("plain" as const),
            }
          : null);
      if (!active?.key) return;
      // Focused a verbatim field: refuse rather than redirect the token
      // somewhere the author isn't looking.
      if (active.kind === "literal" || literalKeys.has(active.key)) return;
      if (active.kind === "html") {
        getHtmlApiRef(active.key).current?.insertText(snippet);
        return;
      }
      const el = active.el;
      const current = values[active.key] ?? "";
      const start = el?.selectionStart ?? current.length;
      const end = el?.selectionEnd ?? current.length;
      const next = current.slice(0, start) + snippet + current.slice(end);
      onValueChange(active.key, next);
      requestAnimationFrame(() => {
        if (!el) return;
        el.focus();
        const caret = start + snippet.length;
        try {
          el.setSelectionRange(caret, caret);
        } catch {
          /* noop */
        }
      });
    },
    [fields, values, onValueChange, literalKeys],
  );

  // ── Validation ─────────────────────────────────────────────────────────────
  const invalidByField = useMemo(() => {
    const out: Record<string, Array<{ expr: string; error: string }>> = {};
    if (!segments) return out;
    for (const f of fields) {
      const { invalid } = analyzeTemplateTokens(values[f.key] ?? "", segments, fieldCatalog);
      if (invalid.length > 0) out[f.key] = invalid;
    }
    return out;
  }, [fields, values, segments, fieldCatalog]);

  // ── Preview body per channel ───────────────────────────────────────────────
  // Honest sample/real reporting: a preview can mix real roots (records
  // the admin picked) with sample ones (roots left unpicked).
  const previewRoots = preview?.roots ?? [];
  const realRootLabels = previewRoots.filter((r) => r.real).map((r) => r.label);
  const sampleRootLabels = previewRoots.filter((r) => !r.real).map((r) => r.label);
  // System values (this site's address, today's date) are never sampled —
  // they are the same here as at delivery — so the note must not claim the
  // whole preview is made up.
  const sampleNote =
    realRootLabels.length === 0
      ? "Rendered with sample records — actual values depend on the recipient and record. Dates and links use this site's real values."
      : sampleRootLabels.length > 0
        ? `Real ${realRootLabels.join(", ")}; sample values for ${sampleRootLabels.join(", ")}.`
        : null;

  const pf = (key: string): StudioPreviewField | undefined => preview?.fields[key];

  const renderPreviewBody = () => {
    if (!preview) return null;
    if (channel === "email") {
      const subject = pf("subject");
      const body = pf("bodyHtml");
      return (
        <div className="rounded-lg border bg-background shadow-sm overflow-hidden" data-testid="studio-preview-email">
          <div className="border-b px-4 py-2.5 bg-muted/40">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Subject</p>
            <p className="text-sm font-medium break-words" data-testid="studio-preview-email-subject">
              {subject?.rendered || <span className="italic text-muted-foreground">(no subject — email would not send)</span>}
            </p>
          </div>
          <div
            className="px-4 py-3 prose prose-sm max-w-none dark:prose-invert overflow-x-auto"
            data-testid="studio-preview-email-body"
            // Already sanitized server-side: `server/delivery/shape.ts` runs
            // sanitizeHtml(value, "rich-document") over HTML fields, and
            // preview goes through that same shaping as delivery so the two
            // cannot disagree. No second pass needed here.
            dangerouslySetInnerHTML={{ __html: body?.rendered || "<p><em>(empty body)</em></p>" }}
          />
          <div className="px-4 pb-3 space-y-1">
            <FieldIssues field={subject} />
            <FieldIssues field={body} />
          </div>
        </div>
      );
    }
    if (channel === "sms") {
      const message = pf("message") ?? pf("body");
      return (
        <div className="space-y-1.5">
          <SmsPreviewBubble text={message?.rendered ?? ""} />
          <FieldIssues field={message} />
        </div>
      );
    }
    if (channel === "inapp") {
      const titleF = pf("title");
      const bodyF = pf("body");
      const linkUrlF = pf("linkUrl");
      const linkLabelF = pf("linkLabel");
      return (
        <div className="space-y-1.5">
          <InappPreviewCard
            title={titleF?.rendered ?? ""}
            body={bodyF?.rendered ?? ""}
            linkUrl={linkUrlF?.rendered || undefined}
            linkLabel={linkLabelF?.rendered || undefined}
          />
          <FieldIssues field={titleF} />
          <FieldIssues field={bodyF} />
          <FieldIssues field={linkUrlF} />
        </div>
      );
    }
    if (channel === "postal") {
      // Letter-style sheet: the letter body on "paper" (rendered as the
      // markup it is when the field is HTML — the same sanitized output
      // delivery wraps in the standard letter page), companion fields such
      // as the mailing description as plain text.
      return (
        <div className="space-y-3">
          {fields.map((f) => {
            const r = pf(f.key);
            const isHtml = f.mode === "html";
            return (
              <div key={f.key} className="space-y-1.5">
                {fields.length > 1 && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</p>
                )}
                {isHtml ? (
                  <div
                    className="rounded-sm border bg-white dark:bg-neutral-100 text-neutral-900 shadow-sm px-8 py-6 text-sm leading-relaxed break-words min-h-[12rem] prose prose-sm max-w-none prose-p:my-0 prose-p:mb-4 prose-neutral"
                    data-testid={`studio-preview-postal-${f.key}`}
                    // Same provenance as the email body above: server-sanitized
                    // by `server/delivery/shape.ts` under "rich-document".
                    dangerouslySetInnerHTML={{
                      __html: r?.rendered || "<p><em>(empty letter — nothing would be mailed)</em></p>",
                    }}
                  />
                ) : (
                  <div
                    className="rounded-md border bg-background px-3 py-2 text-sm whitespace-pre-wrap break-words"
                    data-testid={`studio-preview-postal-${f.key}`}
                  >
                    {r?.rendered || <span className="italic text-muted-foreground">(empty)</span>}
                  </div>
                )}
                <FieldIssues field={r} />
              </div>
            );
          })}
        </div>
      );
    }
    // generic: per-field blocks
    return (
      <div className="space-y-3">
        {fields.map((f) => {
          const r = pf(f.key);
          return (
            <div key={f.key} className="rounded-md border bg-background p-3 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</p>
              {f.mode === "html" ? (
                <div
                  className="prose prose-sm max-w-none dark:prose-invert overflow-x-auto"
                  // Same provenance as the email body above: server-sanitized
                  // by `server/delivery/shape.ts` under "rich-document".
                  dangerouslySetInnerHTML={{ __html: r?.rendered || "<p><em>(empty)</em></p>" }}
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap break-words">
                  {r?.rendered || <span className="italic text-muted-foreground">(empty)</span>}
                </p>
              )}
              <FieldIssues field={r} />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[96vw] sm:max-w-[96vw] lg:max-w-[1400px] h-[92vh] flex flex-col p-0 gap-0"
        data-testid="dialog-template-studio"
      >
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle data-testid="studio-title">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_minmax(360px,42%)]">
          {/* ── Editors ── */}
          <div className="min-h-0 min-w-0 overflow-y-auto p-6 space-y-5 border-b lg:border-b-0 lg:border-r">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`studio-field-${f.key}`}>{f.label}</Label>
                {f.mode === "html" ? (
                  <div
                    onFocusCapture={() => {
                      activeEditorRef.current = {
                        key: f.key,
                        kind: "html",
                        htmlApi: getHtmlApiRef(f.key),
                      };
                    }}
                  >
                    <SimpleHtmlEditor
                      data-testid={`studio-editor-${f.key}`}
                      value={values[f.key] ?? ""}
                      onChange={(v) => onValueChange(f.key, v)}
                      minHeight={260}
                      enableTokens
                      tokens={tokens}
                      editorApiRef={getHtmlApiRef(f.key)}
                    />
                  </div>
                ) : f.mode === "multiline" ? (
                  literalKeys.has(f.key) ? (
                    <Textarea
                      id={`studio-field-${f.key}`}
                      data-testid={`studio-editor-${f.key}`}
                      value={values[f.key] ?? ""}
                      placeholder={f.placeholder || undefined}
                      maxLength={f.maxLength}
                      onChange={(e) => onValueChange(f.key, e.target.value)}
                      onFocus={() => {
                        activeEditorRef.current = { key: f.key, kind: "literal" };
                      }}
                      rows={4}
                      className="min-h-[6rem] resize-y"
                    />
                  ) : (
                    <SlashTokenField
                      as="textarea"
                      id={`studio-field-${f.key}`}
                      data-testid={`studio-editor-${f.key}`}
                      value={values[f.key] ?? ""}
                      onChange={(v) => onValueChange(f.key, v)}
                      tokens={tokens}
                      placeholder={f.placeholder || undefined}
                      maxLength={f.maxLength}
                      onInput={(e) => {
                        // Auto-grow with content.
                        const el = e.currentTarget;
                        el.style.height = "auto";
                        el.style.height = `${el.scrollHeight + 2}px`;
                      }}
                      onFocus={(e) => {
                        activeEditorRef.current = { key: f.key, kind: "plain", el: e.currentTarget };
                      }}
                      rows={4}
                      className="min-h-[6rem] resize-y"
                    />
                  )
                ) : literalKeys.has(f.key) ? (
                  <Input
                    id={`studio-field-${f.key}`}
                    data-testid={`studio-editor-${f.key}`}
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder || undefined}
                    maxLength={f.maxLength}
                    onChange={(e) => onValueChange(f.key, e.target.value)}
                    onFocus={() => {
                      activeEditorRef.current = { key: f.key, kind: "literal" };
                    }}
                  />
                ) : (
                  <SlashTokenField
                    as="input"
                    id={`studio-field-${f.key}`}
                    data-testid={`studio-editor-${f.key}`}
                    value={values[f.key] ?? ""}
                    onChange={(v) => onValueChange(f.key, v)}
                    tokens={tokens}
                    placeholder={f.placeholder || undefined}
                    maxLength={f.maxLength}
                    onFocus={(e) => {
                      activeEditorRef.current = { key: f.key, kind: "plain", el: e.currentTarget };
                    }}
                  />
                )}
                {literalKeys.has(f.key) && (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid={`studio-literal-${f.key}`}
                  >
                    Sent exactly as typed — tokens are not rendered in this field.
                  </p>
                )}
                {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                {f.maxLength !== undefined && (
                  <p
                    className={cn(
                      "text-xs text-right",
                      (values[f.key] ?? "").length > f.maxLength
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                    data-testid={`studio-count-${f.key}`}
                  >
                    {(values[f.key] ?? "").length}/{f.maxLength}
                  </p>
                )}
                {(invalidByField[f.key]?.length ?? 0) > 0 && (
                  <div
                    className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
                    data-testid={`studio-invalid-${f.key}`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      <span className="font-medium">Invalid tokens:</span>{" "}
                      {invalidByField[f.key].map((t) => `{{${t.expr}}} (${t.error})`).join(", ")}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ── Preview + context + token browser ── */}
          <div className="min-h-0 min-w-0 flex flex-col">
            <StudioPanel
              id="preview"
              title="Preview"
              open={panel === "preview"}
              onOpen={() => setPanel("preview")}
              status={
                <span className="ml-auto flex items-center gap-2">
                  {preview && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        realRootLabels.length > 0
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                      )}
                      data-testid="studio-preview-data-badge"
                    >
                      {realRootLabels.length > 0 ? "Real record" : "Sample data"}
                    </span>
                  )}
                  {previewLoading && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Rendering…
                    </span>
                  )}
                </span>
              }
            >
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4 bg-muted/30">
                {previewError && !previewLoading ? (
                  <p className="text-xs text-destructive" data-testid="studio-preview-error">
                    Preview unavailable:{" "}
                    {previewError instanceof Error ? previewError.message : "Unknown error"}
                  </p>
                ) : (
                  renderPreviewBody()
                )}
                {preview && !preview.deliverable && !previewLoading && (
                  <p
                    className="mt-3 text-xs text-destructive border-t pt-2"
                    data-testid="studio-preview-undeliverable"
                  >
                    Nothing would be sent — a required field is empty for this recipient.
                  </p>
                )}
                {preview && sampleNote && (
                  <p
                    className="mt-3 text-xs text-muted-foreground border-t pt-2"
                    data-testid="studio-preview-sample-note"
                  >
                    {sampleNote}
                  </p>
                )}
              </div>
            </StudioPanel>

            <StudioPanel
              id="context"
              title="Preview with"
              open={panel === "context"}
              onOpen={() => setPanel("context")}
              status={
                catalogFailed ? (
                  <span
                    className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium bg-destructive/10 text-destructive"
                    data-testid="badge-studio-context-failed"
                  >
                    Failed to load
                  </span>
                ) : undefined
              }
            >
              <div
                className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 space-y-1.5"
                data-testid="studio-subject-panel"
              >
                {/* Loading, failed, and "nothing supplied" are three
                    different answers. The old panel gave one line for all
                    three and left the author to guess which. */}
                {catalogLoading ? (
                  <p
                    className="text-xs text-muted-foreground flex items-center gap-1.5"
                    data-testid="text-studio-context-loading"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading what
                    this editor can preview against…
                  </p>
                ) : catalogFailed ? (
                  <TokenRequestError
                    what="What this editor can preview against"
                    error={catalogState?.error}
                    onRetry={catalogState?.retry}
                    testId="text-studio-context-error"
                  />
                ) : contextRoots.length === 0 ? (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="text-studio-context-empty"
                  >
                    This editor names no records to preview against — every
                    token renders from sample data.
                  </p>
                ) : (
                  <>
                    {contextRoots.some((r) =>
                      r.records.some((rec) => rec.occurrenceIds?.length),
                    ) ? (
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid="text-studio-seeds-linked"
                      >
                        These records come in sets that were true together —
                        picking one moves the others with it.
                      </p>
                    ) : null}
                    {contextRoots.map((root) => (
                      <SeedPicker
                        key={root.name}
                        root={root}
                        value={choiceFor(root)}
                        onChange={(v) => chooseSeed(root, v)}
                      />
                    ))}
                  </>
                )}
              </div>
            </StudioPanel>

            <StudioPanel
              id="tokens"
              title="Tokens"
              open={panel === "tokens"}
              onOpen={() => setPanel("tokens")}
              status={
                treeRoots.error || (tokenSourceUnknown && catalogFailed) ? (
                  <span
                    className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium bg-destructive/10 text-destructive"
                    data-testid="badge-studio-tokens-failed"
                  >
                    Failed to load
                  </span>
                ) : undefined
              }
            >
              {/* Nothing to browse yet is not the same as nothing to
                  browse: with the catalog missing the studio does not
                  know which tokens exist here, and the site-wide tree is
                  not an answer to that question. */}
              {tokenSourceUnknown ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                  {catalogFailed ? (
                    <TokenRequestError
                      what="This editor's tokens"
                      error={catalogState?.error}
                      onRetry={catalogState?.retry}
                      testId="text-studio-tokens-error"
                    />
                  ) : (
                    <p
                      className="p-2 text-sm text-muted-foreground flex items-center gap-1.5"
                      data-testid="text-studio-tokens-loading"
                    >
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading
                      this editor's tokens…
                    </p>
                  )}
                </div>
              ) : (
                <TokenTreeBrowser
                  onInsert={insertSnippet}
                  rootNames={rootNames}
                  treeBaseUrl={treeBaseUrl}
                  // The section header already says what this is.
                  hideHeading
                  className="min-h-0 flex-1 min-w-0 flex flex-col overflow-hidden"
                />
              )}
            </StudioPanel>
          </div>
        </div>

        <div className="px-6 py-3 border-t shrink-0 flex items-start gap-4">
          <StudioDiagnostics
            catalogState={catalogState}
            tokenCount={tokens.length}
            segmentCount={segments?.length ?? 0}
            contextRootCount={contextRoots.length}
            rootNames={rootNames}
            treeRoots={treeRoots}
            treeNotAsked={
              tokenSourceUnknown
                ? catalogFailed
                  ? "this host's roots come from the catalog, and the catalog failed"
                  : "waiting for the catalog to say which roots this host has"
                : undefined
            }
            previewError={previewError}
          />
          <Button
            onClick={() => onOpenChange(false)}
            data-testid="button-studio-done"
            className="shrink-0"
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
