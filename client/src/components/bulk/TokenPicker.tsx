import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Braces } from "lucide-react";
import type { TokenDefinition } from "@shared/bulk-tokens";

interface TokenPickerProps {
  onInsert: (snippet: string) => void;
}

export function TokenPicker({ onInsert }: TokenPickerProps) {
  const { data } = useQuery<{ tokens: TokenDefinition[] }>({
    queryKey: ["/api/bulk-tokens"],
  });
  const tokens = data?.tokens || [];

  const groups: Record<string, TokenDefinition[]> = {};
  for (const t of tokens) {
    (groups[t.scope] = groups[t.scope] || []).push(t);
  }
  const scopeOrder: Array<TokenDefinition["scope"]> = ["contact", "worker", "employer", "system"];
  const scopeLabel: Record<TokenDefinition["scope"], string> = {
    contact: "Contact",
    worker: "Worker",
    employer: "Employer",
    system: "System",
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="button-open-token-picker">
          <Braces className="h-4 w-4 mr-1.5" />
          Insert token
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 max-h-96 overflow-y-auto" align="end">
        <div className="p-3 border-b">
          <p className="text-sm font-medium">Insert a personalization token</p>
          <p className="text-xs text-muted-foreground mt-1">
            Tokens are replaced with each recipient's data when sent.
          </p>
        </div>
        {scopeOrder.map((scope) => {
          const items = groups[scope] || [];
          if (items.length === 0) return null;
          return (
            <div key={scope} className="p-2 border-b last:border-b-0">
              <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {scopeLabel[scope]}
              </div>
              {items.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onInsert(`{{${t.id}}}`)}
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
              ))}
            </div>
          );
        })}
        {tokens.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">Loading tokens…</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
