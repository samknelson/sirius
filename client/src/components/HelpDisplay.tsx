import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { HelpCircle } from "lucide-react";
import type { Help } from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Global per-page help display. Watches the current wouter route and shows
 * any configured help entries whose path patterns match. The summary is
 * shown inline; entries with details get a "more" affordance that opens a
 * dialog rendering the (server-sanitized) limited HTML.
 */
export function HelpDisplay() {
  const [location] = useLocation();
  const [openHelp, setOpenHelp] = useState<Help | null>(null);

  const { data: helpEntries = [] } = useQuery<Help[]>({
    queryKey: ["/api/helps/lookup", { path: location }],
    queryFn: async () => {
      const res = await fetch(`/api/helps/lookup?path=${encodeURIComponent(location)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load help: ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (helpEntries.length === 0) return null;

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 space-y-2" data-testid="container-help-display">
        {helpEntries.map((help) => (
          <div
            key={help.id}
            className="flex items-start gap-2 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 text-sm text-blue-900 dark:text-blue-100"
            data-testid={`help-summary-${help.id}`}
          >
            <HelpCircle className="h-4 w-4 mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="flex-1">
              {help.summary}
              {help.details && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 ml-2 text-blue-700 dark:text-blue-300 align-baseline"
                  onClick={() => setOpenHelp(help)}
                  data-testid={`button-help-more-${help.id}`}
                >
                  more
                </Button>
              )}
            </span>
          </div>
        ))}
      </div>

      <Dialog open={openHelp !== null} onOpenChange={(open) => !open && setOpenHelp(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              Help
            </DialogTitle>
            <DialogDescription>{openHelp?.summary}</DialogDescription>
          </DialogHeader>
          {openHelp?.details && (
            // Already sanitized server-side: `server/modules/helps.ts` runs
            // sanitizeHtml(details, "rich-document") on write, and the
            // built-in entries in `server/help/system/index.ts` go through the
            // same policy on read. No second pass needed here.
            <div
              className="prose prose-sm dark:prose-invert max-w-none [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_table]:border-collapse [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:px-2 [&_td]:py-1"
              dangerouslySetInnerHTML={{ __html: openHelp.details }}
              data-testid="text-help-details"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
