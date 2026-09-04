import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Gavel, Search, Users } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useDebounced } from "@/hooks/use-debounced";
import {
  QUICKSEARCH_MIN_QUERY_LENGTH,
  type QuicksearchResponse,
} from "@shared/quicksearch";

/**
 * Icons a searcher may ask for. A plugin names an icon; anything this build
 * does not know falls back to the generic one rather than breaking the row.
 */
const ICONS: Record<string, typeof Search> = {
  users: Users,
  gavel: Gavel,
  "calendar-days": CalendarDays,
  search: Search,
};

/** Wait this long after the last keystroke before asking the server. */
const DEBOUNCE_MS = 250;

/**
 * Search from anywhere.
 *
 * The dialog renders structured results — it never receives markup from a
 * searcher — so grouping, keyboard navigation and escaping behave the same no
 * matter which record type produced a row. cmdk's own filtering is off: the
 * server decided what matches, and re-filtering here would silently hide rows
 * that matched on something not shown (an SSN, a phone number).
 */
export function QuickSearch() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const debouncedTerm = useDebounced(term, DEBOUNCE_MS);

  // Whether this user has any searcher at all. A role with none granted gets
  // no button rather than a box that can only ever say "no results".
  const { data: availability } = useQuery<{ available: boolean }>({
    queryKey: ["/api/quicksearch/available"],
    enabled: !!user,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const available = availability?.available === true;

  const trimmed = debouncedTerm.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < QUICKSEARCH_MIN_QUERY_LENGTH;
  const shouldSearch = available && open && trimmed.length >= QUICKSEARCH_MIN_QUERY_LENGTH;

  // Keyed on the debounced term, so an answer to a term the user has already
  // typed past is never shown: react-query resolves each key separately and
  // only the current key is rendered.
  const { data, isFetching, isError } = useQuery<QuicksearchResponse>({
    queryKey: ["/api/quicksearch", trimmed],
    enabled: shouldSearch,
    retry: false,
    staleTime: 30 * 1000,
    queryFn: async () => {
      // POST: the search term is user content and must not land in a URL, an
      // access log or the browser's history.
      const res = await fetch("/api/quicksearch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ q: trimmed }),
      });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      return (await res.json()) as QuicksearchResponse;
    },
  });

  // Only render an answer that belongs to what is currently typed.
  const results = data && data.query === trimmed ? data : undefined;

  useEffect(() => {
    if (!available) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [available]);

  useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  const totalResults = useMemo(
    () => (results ? results.groups.reduce((sum, g) => sum + g.results.length, 0) : 0),
    [results],
  );

  if (!available) return null;

  function go(href: string) {
    setOpen(false);
    navigate(href);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Search"
        data-testid="button-quicksearch"
      >
        <Search className="h-4 w-4" />
      </Button>

      {/* Filtering is the server's job — see the component doc. */}
      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
        <CommandInput
          value={term}
          onValueChange={setTerm}
          placeholder="Search…"
          data-testid="input-quicksearch"
        />
        <CommandList data-testid="list-quicksearch-results">
          {/* cmdk's built-in filtering is disabled below, so every state the
              user can be in has to be spelled out explicitly. */}
          {trimmed.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground" data-testid="text-quicksearch-idle">
              Start typing to search.
            </div>
          )}
          {tooShort && (
            <div className="py-6 text-center text-sm text-muted-foreground" data-testid="text-quicksearch-too-short">
              Keep typing — at least {QUICKSEARCH_MIN_QUERY_LENGTH} characters.
            </div>
          )}
          {shouldSearch && isError && (
            <div className="py-6 text-center text-sm text-destructive" data-testid="text-quicksearch-error">
              Search failed. Try again in a moment.
            </div>
          )}
          {shouldSearch && !isError && isFetching && !results && (
            <div className="py-6 text-center text-sm text-muted-foreground" data-testid="text-quicksearch-loading">
              Searching…
            </div>
          )}
          {shouldSearch && !isError && results && totalResults === 0 && (
            <CommandEmpty data-testid="text-quicksearch-empty">
              Nothing matched “{results.query}”.
            </CommandEmpty>
          )}

          {results?.groups.map((group) => {
            const Icon = (group.icon && ICONS[group.icon]) || Search;
            return (
              <CommandGroup
                key={group.configId}
                heading={group.label}
                data-testid={`group-quicksearch-${group.pluginId}`}
              >
                {group.results.map((result) => (
                  <CommandItem
                    key={`${group.configId}:${result.id}`}
                    value={`${group.configId}:${result.id}`}
                    onSelect={() => go(result.href)}
                    data-testid={`item-quicksearch-${result.id}`}
                  >
                    <Icon className="mr-2 h-4 w-4 shrink-0 opacity-60" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{result.title}</div>
                      {result.subtitle && (
                        <div className="truncate text-xs text-muted-foreground">
                          {result.subtitle}
                        </div>
                      )}
                    </div>
                    {/* Says WHY a row came back — the only way a user can tell
                        that digits matched an SSN, without the number being
                        shown anywhere. */}
                    {result.matchedOn && (
                      <Badge variant="secondary" className="ml-2 shrink-0 text-xs">
                        {result.matchedOn}
                      </Badge>
                    )}
                  </CommandItem>
                ))}
                {group.truncated && (
                  <div className="px-2 py-1 text-xs text-muted-foreground" data-testid={`text-quicksearch-truncated-${group.pluginId}`}>
                    More matches — keep typing to narrow it down.
                  </div>
                )}
              </CommandGroup>
            );
          })}

          {results?.failures.map((failure) => (
            <div
              key={failure.configId}
              className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
              data-testid={`text-quicksearch-failure-${failure.pluginId}`}
            >
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {failure.reason === "timeout"
                ? `${failure.label} took too long to answer.`
                : `${failure.label} could not be searched.`}
            </div>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
