import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Braces, Search, Clock } from "lucide-react";
import type { TokenDefinition } from "@shared/bulk-tokens";

interface TokenPickerProps {
  onInsert: (snippet: string) => void;
  /** Accepted for backward compatibility but no longer used — every token is always shown. */
  messageId?: string;
}

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

export function TokenPicker({ onInsert }: TokenPickerProps) {
  // Always show every registered token — authors should be able to
  // search the full set regardless of who's currently on the
  // recipient list. Recipient context still controls what each token
  // resolves to at send time.
  const { data } = useQuery<{ tokens: TokenDefinition[] }>({
    queryKey: ["/api/bulk-tokens"],
  });
  const tokens = data?.tokens || [];

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setRecent(loadRecent());
      setSearch("");
    }
  }, [open]);

  const handleInsert = (t: TokenDefinition) => {
    const next = [t.id, ...recent.filter((id) => id !== t.id)].slice(0, RECENT_MAX);
    setRecent(next);
    saveRecent(next);
    onInsert(`{{${t.id}}}`);
    setOpen(false);
  };

  const scopeOrder: Array<TokenDefinition["scope"]> = ["contact", "worker", "employer", "system"];
  const scopeLabel: Record<TokenDefinition["scope"], string> = {
    contact: "Contact",
    worker: "Worker",
    employer: "Employer",
    system: "System",
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter((t) => {
      return (
        t.label.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q)
      );
    });
  }, [tokens, search]);

  const tokensById = useMemo(() => {
    const map: Record<string, TokenDefinition> = {};
    for (const t of tokens) map[t.id] = t;
    return map;
  }, [tokens]);

  const recentTokens = useMemo(() => {
    if (search.trim()) return [];
    return recent.map((id) => tokensById[id]).filter((t): t is TokenDefinition => Boolean(t));
  }, [recent, tokensById, search]);

  const recentIdSet = useMemo(() => new Set(recentTokens.map((t) => t.id)), [recentTokens]);
  const groups: Record<string, TokenDefinition[]> = {};
  for (const t of filtered) {
    if (recentIdSet.has(t.id)) continue;
    (groups[t.scope] = groups[t.scope] || []).push(t);
  }

  const renderToken = (t: TokenDefinition, keyPrefix: string) => (
    <button
      key={`${keyPrefix}-${t.id}`}
      type="button"
      onClick={() => handleInsert(t)}
      className="w-full text-left px-2 py-1.5 rounded hover-elevate active-elevate-2 text-sm"
      data-testid={`button-insert-token-${t.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{t.label}</span>
        <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
          {`{{${t.id}}}`}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="button-open-token-picker">
          <Braces className="h-4 w-4 mr-1.5" />
          Insert token
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 max-h-96 flex flex-col" align="end">
        <div className="p-3 border-b shrink-0">
          <p className="text-sm font-medium">Insert a personalization token</p>
          <p className="text-xs text-muted-foreground mt-1">
            Tokens are replaced with each recipient's data when sent. Tokens that don't apply to a given recipient fall back to a default.
          </p>
          <div className="relative mt-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tokens…"
              className="h-8 pl-7 text-sm"
              data-testid="input-token-search"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {recentTokens.length > 0 && (
            <div className="p-2 border-b" data-testid="section-recent-tokens">
              <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Recently used
              </div>
              {recentTokens.map((t) => renderToken(t, "recent"))}
            </div>
          )}
          {scopeOrder.map((scope) => {
            const items = groups[scope] || [];
            if (items.length === 0) return null;
            return (
              <div key={scope} className="p-2 border-b last:border-b-0">
                <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {scopeLabel[scope]}
                </div>
                {items.map((t) => renderToken(t, scope))}
              </div>
            );
          })}
          {tokens.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">Loading tokens…</div>
          )}
          {tokens.length > 0 && filtered.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground" data-testid="text-no-tokens-found">
              No tokens match "{search}".
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
