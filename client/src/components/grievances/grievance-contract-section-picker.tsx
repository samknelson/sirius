import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Search, Layers, List } from "lucide-react";

interface CatalogSection {
  id: string;
  sectionNumber: string | null;
  name: string;
  body: string | null;
  isStub: boolean;
  sequence: number;
}

interface CatalogArticle {
  id: string;
  articleNumber: string | null;
  name: string;
  sequence: number;
  sections: CatalogSection[];
}

interface GrievanceContractSectionPickerProps {
  grievanceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Section ids already linked to the grievance (shown checked + disabled). */
  linkedSectionIds: string[];
  /** Called with the newly-selected section ids when the user confirms. */
  onConfirm: (sectionIds: string[]) => void;
  busy?: boolean;
}

/** Strip HTML tags so the rich-text section body is searchable as plain text. */
function stripHtml(html: string | null): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sectionLabel(s: CatalogSection): string {
  return `${s.sectionNumber ? `${s.sectionNumber}. ` : ""}${s.name}`;
}

export function GrievanceContractSectionPicker({
  grievanceId,
  open,
  onOpenChange,
  linkedSectionIds,
  onConfirm,
  busy = false,
}: GrievanceContractSectionPickerProps) {
  const [view, setView] = useState<"search" | "outline">("search");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const linkedSet = useMemo(() => new Set(linkedSectionIds), [linkedSectionIds]);

  useEffect(() => {
    if (open) {
      setSearch("");
      setSelected(new Set());
      setView("search");
    }
  }, [open]);

  const { data, isLoading } = useQuery<{ articles: CatalogArticle[] }>({
    queryKey: ["/api/grievances", grievanceId, "contract", "catalog"],
    queryFn: async () => {
      const res = await fetch(`/api/grievances/${grievanceId}/contract/catalog`);
      if (!res.ok) throw new Error("Failed to load contract catalog");
      return res.json();
    },
    enabled: open,
  });

  const articles = data?.articles ?? [];

  // Flattened, search-annotated section list (with owning article for context).
  const flatSections = useMemo(() => {
    const rows: Array<{ article: CatalogArticle; section: CatalogSection; haystack: string }> = [];
    for (const article of articles) {
      for (const section of article.sections) {
        const haystack = [
          section.sectionNumber ?? "",
          section.name,
          stripHtml(section.body),
        ]
          .join(" ")
          .toLowerCase();
        rows.push({ article, section, haystack });
      }
    }
    return rows;
  }, [articles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return flatSections;
    return flatSections.filter((r) => r.haystack.includes(q));
  }, [flatSections, search]);

  const toggle = (id: string) => {
    if (linkedSet.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selected));
  };

  const renderRow = (
    section: CatalogSection,
    article: CatalogArticle | null,
    keyPrefix: string,
  ) => {
    const isLinked = linkedSet.has(section.id);
    const isChecked = isLinked || selected.has(section.id);
    return (
      <label
        key={`${keyPrefix}-${section.id}`}
        className={`flex items-start gap-3 rounded-md px-2 py-2 ${
          isLinked ? "opacity-60" : "hover-elevate cursor-pointer"
        }`}
        data-testid={`picker-section-${section.id}`}
      >
        <Checkbox
          checked={isChecked}
          disabled={isLinked || busy}
          onCheckedChange={() => toggle(section.id)}
          className="mt-0.5"
          data-testid={`checkbox-section-${section.id}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">
              {sectionLabel(section)}
            </span>
            {section.isStub && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0">
                stub
              </Badge>
            )}
            {isLinked && (
              <Badge variant="outline" className="text-[10px] px-1 py-0">
                linked
              </Badge>
            )}
          </div>
          {article && (
            <p className="text-xs text-muted-foreground truncate">
              {article.articleNumber ? `${article.articleNumber}. ` : ""}
              {article.name}
            </p>
          )}
        </div>
      </label>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add contract sections</DialogTitle>
          <DialogDescription>
            Select the CBA sections this grievance alleges were violated.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={view === "search" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("search")}
            data-testid="button-picker-view-search"
          >
            <Search size={14} className="mr-1" />
            Search
          </Button>
          <Button
            type="button"
            variant={view === "outline" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("outline")}
            data-testid="button-picker-view-outline"
          >
            <Layers size={14} className="mr-1" />
            Outline
          </Button>
        </div>

        {view === "search" && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by number, title, or text…"
              className="pl-8"
              data-testid="input-section-search"
            />
          </div>
        )}

        <ScrollArea className="flex-1 -mx-2 px-2">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : flatSections.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-no-sections">
              This contract has no sections yet.
            </p>
          ) : view === "search" ? (
            filtered.length === 0 ? (
              <p
                className="text-sm text-muted-foreground py-8 text-center"
                data-testid="text-no-section-matches"
              >
                No sections match "{search}".
              </p>
            ) : (
              <div className="space-y-1">
                {filtered.map((r) => renderRow(r.section, r.article, "search"))}
              </div>
            )
          ) : (
            <Accordion type="multiple" className="w-full">
              {articles.map((article) => (
                <AccordionItem
                  key={article.id}
                  value={article.id}
                  data-testid={`picker-article-${article.id}`}
                >
                  <AccordionTrigger className="text-left">
                    <span className="flex items-center gap-2">
                      <Layers size={15} className="text-primary shrink-0" />
                      <span className="text-sm">
                        {article.articleNumber ? `${article.articleNumber}. ` : ""}
                        {article.name}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {article.sections.length === 0 ? (
                      <p className="ml-6 text-sm text-muted-foreground italic">
                        No sections.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {article.sections.map((s) => renderRow(s, null, "outline"))}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </ScrollArea>

        <DialogFooter>
          <span className="text-sm text-muted-foreground mr-auto" data-testid="text-picker-selected-count">
            {selected.size} selected
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            data-testid="button-picker-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={busy || selected.size === 0}
            data-testid="button-picker-confirm"
          >
            Add {selected.size > 0 ? `${selected.size} ` : ""}
            {selected.size === 1 ? "section" : "sections"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
