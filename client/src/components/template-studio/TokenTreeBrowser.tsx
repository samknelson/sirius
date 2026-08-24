import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/queryClient";
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { MAX_CHAIN_DEPTH, type TokenArgSpec } from "@shared/tokens";

/**
 * Browsable token picker: the author walks the record graph one level at
 * a time (dispatch → worker → address → a field) and every leaf inserts
 * ONE complete, valid token. Nothing is enumerated up front — each level
 * is fetched from the tree endpoints as it is opened — so chains of any
 * depth stay reachable and no row has to print a record's whole column
 * list to describe itself.
 *
 * Which roots exist is decided by the surface being edited: the notifier
 * hosts name their record roots, bulk messaging names none and gets the
 * ordinary contact-side roots. Search asks the server, so a match deep
 * under a record is found without pulling the graph down.
 */

// ── Server shapes (mirrors server/plugins/tokens/tree.ts) ──────────────

type TokenTreeChildKind = "relation" | "leaf" | "field";

export interface TokenTreeRoot {
  name: string;
  label: string;
  description?: string;
  type: string;
  contextRoot: boolean;
  recipientRooted: boolean;
  defaultLeaf?: string;
}

interface TokenTreeChild {
  kind: TokenTreeChildKind;
  segment: string;
  label: string;
  description?: string;
  suffix: string;
  outputType?: string;
  args?: Record<string, TokenArgSpec>;
  needsArgument?: boolean;
  defaultLeaf?: string;
  defaultValue?: string;
  example?: string;
}

interface TokenTypeExpansion {
  type: string;
  label: string;
  fieldsOpen: boolean;
  children: TokenTreeChild[];
}

interface TokenTreeSearchHit {
  expression: string;
  path: string[];
  kind: TokenTreeChildKind | "root";
  label: string;
  description?: string;
}

// ── Recently used (shared key with the other token affordances) ────────

const RECENT_KEY = "token-picker-recent";
const RECENT_MAX = 5;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_MAX)));
  } catch {
    /* ignore */
  }
}

// ── Argument handling ──────────────────────────────────────────────────

function quoteArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Initial argument values for a child: its declared defaults. */
function initialArgValues(child: TokenTreeChild): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(child.args ?? {})) {
    out[name] = spec.default ?? "";
  }
  return out;
}

/**
 * The text to append for a child with author-chosen arguments. Required
 * arguments are always written; optional ones only when the author moved
 * them off their default.
 */
function suffixWithArgs(child: TokenTreeChild, values: Record<string, string>): string {
  const parts = Object.entries(child.args ?? {})
    .filter(([name, spec]) => {
      const value = values[name] ?? "";
      if (spec.required) return true;
      return value !== "" && value !== (spec.default ?? "");
    })
    .map(([name]) => `${name}=${quoteArg(values[name] ?? "")}`);
  return parts.length > 0 ? `.${child.segment}(${parts.join(", ")})` : `.${child.segment}`;
}

/** True when a required argument is still blank. */
function argsIncomplete(child: TokenTreeChild, values: Record<string, string>): boolean {
  // A child that needs an argument but declares none can't be completed
  // here — refuse rather than emit a segment with its argument dropped.
  if (child.needsArgument && Object.keys(child.args ?? {}).length === 0) return true;
  return Object.entries(child.args ?? {}).some(
    ([name, spec]) => spec.required && (values[name] ?? "").trim() === "",
  );
}

/** Children a picker offers arguments for (a field's name is its label). */
function hasChoosableArgs(child: TokenTreeChild): boolean {
  if (child.kind === "field") return false;
  return Object.keys(child.args ?? {}).length > 0;
}

/**
 * Display code for a child row: the segment this row really appends,
 * without the leading dot — `field(name="full")`, not a friendlier
 * rewrite of it. Field rows keep their name as secondary context.
 */
function childDisplayCode(child: TokenTreeChild): string {
  return child.suffix.replace(/^\./, "");
}

// ── Component ──────────────────────────────────────────────────────────

/** One step of the walk: the chain so far and where it has arrived. */
interface TreeStep {
  label: string;
  /** Token expression so far, braces excluded. */
  expression: string;
  type: string;
  /** Set when the chain renders a value if it stops here. */
  insertable: boolean;
}

interface ArgDraft {
  child: TokenTreeChild;
  values: Record<string, string>;
  /** Whether applying the arguments inserts the token or walks into it. */
  action: "insert" | "browse";
  /**
   * The chain the draft was opened under. Applying builds from this, not
   * from wherever the walk has since moved to.
   */
  baseExpression: string;
  /** Chain length the draft was opened at, for the depth guard. */
  baseDepth: number;
}

/** The studio's own tree endpoints, for a host that names none. */
export const DEFAULT_TREE_BASE_URL = "/api/token-studio/tree";

/** The tree's roots and HOW THEY GOT HERE — loading, failed, or loaded. */
export interface TokenTreeRootsState {
  /** The endpoint this host is asking, verbatim, for diagnostics. */
  url: string;
  roots: TokenTreeRoot[];
  loading: boolean;
  error: unknown;
  /** Ask again after a failure. */
  retry: () => void;
}

/**
 * The tree's root list, shared by the picker and the studio's
 * diagnostics. Both read the SAME query key, so asking twice costs one
 * request and the two can never disagree about what this host's tree
 * endpoint returned.
 */
export function useTokenTreeRoots({
  treeBaseUrl = DEFAULT_TREE_BASE_URL,
  rootNames,
  enabled = true,
}: {
  treeBaseUrl?: string;
  rootNames?: string[];
  enabled?: boolean;
}): TokenTreeRootsState {
  const rootsParam = rootNames?.length ? rootNames.join(",") : "";
  const url = rootsParam
    ? `${treeBaseUrl}/roots?roots=${encodeURIComponent(rootsParam)}`
    : `${treeBaseUrl}/roots`;
  const { data, isLoading, error, refetch } = useQuery<{ roots: TokenTreeRoot[] }>({
    queryKey: [url],
    enabled,
  });
  return {
    url,
    roots: data?.roots ?? [],
    loading: isLoading,
    error: error ?? null,
    retry: () => {
      void refetch();
    },
  };
}

/** A failed request, said out loud, with the one thing to do about it. */
export function TokenRequestError({
  what,
  error,
  onRetry,
  testId,
}: {
  /** What could not be loaded, as a noun phrase. */
  what: string;
  error: unknown;
  onRetry?: () => void;
  testId: string;
}) {
  return (
    <div
      className="p-2 space-y-1.5 text-sm text-destructive"
      data-testid={testId}
    >
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          <span className="font-medium">{what} could not be loaded.</span>{" "}
          {getApiErrorMessage(error, "The request failed.")}
        </span>
      </div>
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          onClick={onRetry}
          data-testid={`${testId}-retry`}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Try again
        </Button>
      )}
    </div>
  );
}

export interface TokenTreeBrowserProps {
  onInsert: (snippet: string) => void;
  /**
   * Tree endpoints for the surface being edited. Each surface serves the
   * tree behind its own gate, so the picker never reaches further than
   * the editor it sits in.
   */
  treeBaseUrl?: string;
  /** Named record roots this surface seeds (`dispatch`, `event`, …). */
  rootNames?: string[];
  /**
   * Drop the browser's own "Insert a personalization token" title, for a
   * host that already titles the area it is embedded in.
   */
  hideHeading?: boolean;
  className?: string;
}

export function TokenTreeBrowser({
  onInsert,
  treeBaseUrl = DEFAULT_TREE_BASE_URL,
  rootNames,
  hideHeading,
  className,
}: TokenTreeBrowserProps) {
  const rootsParam = rootNames?.length ? rootNames.join(",") : "";
  const [stack, setStack] = useState<TreeStep[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [argDraft, setArgDraft] = useState<ArgDraft | null>(null);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Searching leaves the current level, so an open options panel would
  // apply to a row the author can no longer see.
  useEffect(() => {
    if (search.trim().length >= 2) setArgDraft(null);
  }, [search]);

  const current = stack.length > 0 ? stack[stack.length - 1] : undefined;
  const searching = query.length >= 2;
  // The grammar rejects longer chains, so the picker stops offering
  // children rather than building a token the studio marks invalid.
  const atMaxDepth = stack.length >= MAX_CHAIN_DEPTH;

  const {
    roots,
    loading: rootsLoading,
    error: rootsError,
    retry: retryRoots,
  } = useTokenTreeRoots({ treeBaseUrl, rootNames });

  const {
    data: expansion,
    isLoading: levelLoading,
    error: levelError,
    refetch: refetchLevel,
  } = useQuery<TokenTypeExpansion>({
    queryKey: [`${treeBaseUrl}/type/${encodeURIComponent(current?.type ?? "")}`],
    enabled: Boolean(current),
  });

  const searchUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (rootsParam) params.set("roots", rootsParam);
    params.set("q", query);
    return `${treeBaseUrl}/search?${params.toString()}`;
  }, [treeBaseUrl, rootsParam, query]);
  const {
    data: searchData,
    isFetching: searchFetching,
    error: searchError,
    refetch: refetchSearch,
  } = useQuery<{
    hits: TokenTreeSearchHit[];
  }>({
    queryKey: [searchUrl],
    enabled: searching,
  });
  const hits = searchData?.hits ?? [];

  const insert = (expression: string) => {
    const next = [expression, ...recent.filter((e) => e !== expression)].slice(0, RECENT_MAX);
    setRecent(next);
    saveRecent(next);
    setArgDraft(null);
    onInsert(`{{${expression}}}`);
  };

  /** Walk into a child of the chain that was `depth` segments long. */
  const walkInto = (child: TokenTreeChild, expression: string, depth: number) => {
    setStack((prev) => [
      ...prev.slice(0, depth),
      {
        label: child.label,
        expression,
        type: child.outputType ?? "",
        insertable: child.defaultLeaf !== undefined,
      },
    ]);
  };

  const openChild = (child: TokenTreeChild, action: "insert" | "browse") => {
    if (!current || atMaxDepth) return;
    // A required argument with no default has to be asked for before the
    // token means anything — the author never receives a stub to finish.
    if (child.needsArgument) {
      setArgDraft({
        child,
        values: initialArgValues(child),
        action,
        baseExpression: current.expression,
        baseDepth: stack.length,
      });
      return;
    }
    const expression = `${current.expression}${child.suffix}`;
    setArgDraft(null);
    if (action === "insert") {
      insert(expression);
      return;
    }
    walkInto(child, expression, stack.length);
  };

  const applyArgDraft = () => {
    if (!argDraft) return;
    const { child, values, action, baseExpression, baseDepth } = argDraft;
    if (baseDepth >= MAX_CHAIN_DEPTH) return;
    const expression = `${baseExpression}${suffixWithArgs(child, values)}`;
    setArgDraft(null);
    if (action === "insert") {
      insert(expression);
      return;
    }
    walkInto(child, expression, baseDepth);
  };

  const goTo = (depth: number) => {
    setArgDraft(null);
    setStack(stack.slice(0, depth));
  };

  // ── Rows ────────────────────────────────────────────────────────────

  const insertButton = (expression: string, title: string) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 shrink-0"
      title={title}
      onClick={() => insert(expression)}
      data-testid={`button-insert-token-${expression}`}
    >
      <Plus className="h-3.5 w-3.5" />
    </Button>
  );

  const renderRootRow = (root: TokenTreeRoot) => (
    <div key={root.name} className="flex items-center gap-1">
      <button
        type="button"
        title={root.label}
        onClick={() => {
          setArgDraft(null);
          setSearch("");
          setStack([
            {
              label: root.label,
              expression: root.name,
              type: root.type,
              insertable: root.defaultLeaf !== undefined,
            },
          ]);
        }}
        className="flex-1 min-w-0 text-left px-2 py-1 rounded hover-elevate active-elevate-2"
        data-testid={`button-token-open-${root.name}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs truncate">{root.name}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </div>
      </button>
      {root.defaultLeaf !== undefined && insertButton(root.name, `Insert {{${root.name}}}`)}
    </div>
  );

  const renderChildRow = (child: TokenTreeChild, index: number) => {
    const preview = current ? `${current.expression}${child.suffix}` : child.suffix;
    const isRelation = child.kind === "relation";
    const displayCode = childDisplayCode(child);
    return (
      <div key={`${child.kind}-${child.segment}-${child.label}-${index}`} className="flex items-center gap-1">
        <button
          type="button"
          title={child.label}
          onClick={() => openChild(child, isRelation ? "browse" : "insert")}
          className="flex-1 min-w-0 text-left px-2 py-1 rounded hover-elevate active-elevate-2"
          data-testid={
            isRelation || child.needsArgument
              ? `button-token-open-${child.segment}`
              : `button-insert-token-${preview}`
          }
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 font-mono text-xs truncate">{displayCode}</span>
            {/* The segment is the truth; a field's name is what makes the
                list scannable, so it rides alongside instead of replacing it. */}
            {child.kind === "field" && (
              <span className="shrink-0 text-[11px] text-muted-foreground truncate max-w-[40%]">
                {child.label}
              </span>
            )}
            {isRelation && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
          </div>
        </button>
        {hasChoosableArgs(child) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 shrink-0"
            title="Choose this token's options"
            onClick={() =>
              current &&
              setArgDraft({
                child,
                values: initialArgValues(child),
                action: isRelation ? "browse" : "insert",
                baseExpression: current.expression,
                baseDepth: stack.length,
              })
            }
            data-testid={`button-token-args-${child.segment}`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
        )}
        {isRelation &&
          child.defaultLeaf !== undefined &&
          !child.needsArgument &&
          insertButton(preview, `Insert {{${preview}}}`)}
      </div>
    );
  };

  const renderHitRow = (hit: TokenTreeSearchHit) => {
    const displayCode = hit.expression;
    return (
      <button
        key={hit.expression}
        type="button"
        title={hit.label}
        onClick={() => insert(hit.expression)}
        className="w-full text-left px-2 py-1 rounded hover-elevate active-elevate-2"
        data-testid={`button-insert-token-${hit.expression}`}
      >
        <span className="font-mono text-xs truncate block">{displayCode}</span>
      </button>
    );
  };

  const relations = (expansion?.children ?? []).filter((c) => c.kind === "relation");
  const leaves = (expansion?.children ?? []).filter((c) => c.kind === "leaf");
  const fields = (expansion?.children ?? []).filter((c) => c.kind === "field");

  /** The display segment for a stack step (the piece added at that step). */
  const stepSegment = (step: TreeStep, prev?: TreeStep): string => {
    const expr = step.expression;
    return prev ? expr.substring(prev.expression.length + 1) : expr;
  };

  return (
    <div className={className ?? "flex flex-col min-h-0 h-full"}>
      <div className={cn("border-b shrink-0", hideHeading ? "px-4 pb-3" : "p-3")}>
        {!hideHeading && (
          <p className="text-sm font-medium">Insert a personalization token</p>
        )}
        <div className={cn("relative", hideHeading ? "" : "mt-2")}>
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search records and fields…"
            className="h-8 pl-7 text-sm"
            data-testid="input-token-search"
          />
        </div>
      </div>

      {!searching && current && (
        <div className="px-3 py-1.5 border-b shrink-0" data-testid="token-tree-breadcrumbs">
          <div className="flex flex-wrap items-center gap-0.5 text-xs">
            <button
              type="button"
              onClick={() => goTo(0)}
              className="px-1.5 py-0.5 rounded hover-elevate text-muted-foreground font-mono text-[11px]"
              data-testid="button-token-breadcrumb-root"
            >
              ←
            </button>
            {stack.map((step, i) => (
              <span key={step.expression} className="flex items-center gap-0.5">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <button
                  type="button"
                  title={step.label}
                  onClick={() => goTo(i + 1)}
                  className={cn(
                    "px-1.5 py-0.5 rounded hover-elevate font-mono text-[11px]",
                    i === stack.length - 1 ? "" : "text-muted-foreground",
                  )}
                  data-testid={`button-token-breadcrumb-${i}`}
                >
                  {stepSegment(step, stack[i - 1])}
                </button>
              </span>
            ))}
            {current.insertable && (
              <span className="ml-auto shrink-0">
                {insertButton(current.expression, "Insert this record")}
              </span>
            )}
          </div>
        </div>
      )}

      {argDraft && (
        <div className="p-3 border-b shrink-0 bg-muted/40 space-y-2" data-testid="panel-token-args">
          <p className="text-xs font-medium">{argDraft.child.label} — options</p>
          {Object.entries(argDraft.child.args ?? {}).map(([name, spec]) => (
            <div key={name} className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {name}
                {spec.required ? " *" : ""}
              </label>
              {/*
                An argument whose valid values are known (the tabs of the
                page a record lives on) is picked from, never typed: a
                blank box invites a typo that only surfaces at delivery.
              */}
              {spec.choices ? (
                <Select
                  value={argDraft.values[name] ?? ""}
                  onValueChange={(value) =>
                    setArgDraft({
                      ...argDraft,
                      values: { ...argDraft.values, [name]: value },
                    })
                  }
                >
                  <SelectTrigger
                    className="h-8 text-sm"
                    data-testid={`select-token-arg-${name}`}
                  >
                    <SelectValue placeholder={`Choose a ${name}…`} />
                  </SelectTrigger>
                  <SelectContent>
                    {spec.choices.map((choice) => (
                      <SelectItem key={choice.value} value={choice.value}>
                        {choice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={argDraft.values[name] ?? ""}
                  onChange={(e) =>
                    setArgDraft({
                      ...argDraft,
                      values: { ...argDraft.values, [name]: e.target.value },
                    })
                  }
                  className="h-8 text-sm"
                  data-testid={`input-token-arg-${name}`}
                />
              )}
              {spec.description && (
                <p className="text-[11px] text-muted-foreground">{spec.description}</p>
              )}
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setArgDraft(null)}
              data-testid="button-token-args-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={argsIncomplete(argDraft.child, argDraft.values)}
              onClick={applyArgDraft}
              data-testid="button-token-args-apply"
            >
              {argDraft.action === "browse" ? "Open" : "Insert"}
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0">
        {searching ? (
          <div className="p-2">
            {searchFetching && hits.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
              </div>
            ) : searchError ? (
              <TokenRequestError
                what="Token search"
                error={searchError}
                onRetry={() => {
                  void refetchSearch();
                }}
                testId="text-token-search-error"
              />
            ) : hits.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground" data-testid="text-no-tokens-found">
                No tokens match "{query}".
              </div>
            ) : (
              hits.map(renderHitRow)
            )}
          </div>
        ) : current ? (
          <div className="p-2 space-y-0.5">
            {levelLoading && (
              <div className="p-2 text-sm text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            )}
            {!atMaxDepth && relations.map((c, i) => renderChildRow(c, i))}
            {!atMaxDepth && leaves.map((c, i) => renderChildRow(c, relations.length + i))}
            {!atMaxDepth && fields.map((c, i) => renderChildRow(c, relations.length + leaves.length + i))}
            {levelError && !levelLoading && (
              <TokenRequestError
                what={`What ${current.label} offers`}
                error={levelError}
                onRetry={() => {
                  void refetchLevel();
                }}
                testId="text-token-level-error"
              />
            )}
            {!levelLoading &&
              !levelError &&
              !atMaxDepth &&
              (expansion?.children.length ?? 0) === 0 && (
                <div className="p-2 text-sm text-muted-foreground">
                  This record offers nothing to insert.
                </div>
              )}
            {atMaxDepth && (
              <div className="p-2 text-sm text-muted-foreground" data-testid="text-token-max-depth">
                This chain is as long as a token can be ({MAX_CHAIN_DEPTH} steps). Insert this
                record's own value, or go back and take a shorter route.
              </div>
            )}
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {roots.map(renderRootRow)}
            {/* Three states, three sentences: a failed request must never
                be able to read as "there are no tokens here". */}
            {rootsLoading && (
              <div
                className="p-2 text-sm text-muted-foreground flex items-center gap-1.5"
                data-testid="text-tokens-loading"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading tokens…
              </div>
            )}
            {!rootsLoading && Boolean(rootsError) && (
              <TokenRequestError
                what="The token list"
                error={rootsError}
                onRetry={retryRoots}
                testId="text-token-roots-error"
              />
            )}
            {!rootsLoading && !rootsError && roots.length === 0 && (
              <div className="p-2 text-sm text-muted-foreground" data-testid="text-no-tokens-found">
                This editor offers no token records — nothing here has tokens to
                insert.
              </div>
            )}
            {recent.length > 0 && (
              <div data-testid="section-recent-tokens">
                <div className="border-t my-1" />
                <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Recently used
                </div>
                {recent.map((expression) => (
                  <button
                    key={expression}
                    type="button"
                    onClick={() => insert(expression)}
                    className="w-full text-left px-2 py-1 rounded hover-elevate active-elevate-2 font-mono text-xs truncate block"
                    data-testid={`button-insert-token-${expression}`}
                  >
                    {expression}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
