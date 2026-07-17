import { useQuery } from "@tanstack/react-query";
import { Layers, List } from "lucide-react";
import type { ContractArticle, ContractSection } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

function ArticleOutlineContent({ article }: { article: ContractArticle }) {
  const { data: sections, isLoading } = useQuery<ContractSection[]>({
    queryKey: ["/api/contracts/articles", article.id, "sections"],
    queryFn: async () => {
      const res = await fetch(`/api/contracts/articles/${article.id}/sections`);
      if (!res.ok) throw new Error("Failed to load sections");
      return res.json();
    },
  });

  if (isLoading) {
    return <Skeleton className="h-4 w-40 ml-6" />;
  }
  if (!sections || sections.length === 0) {
    return <p className="ml-6 text-sm text-muted-foreground italic">No sections.</p>;
  }
  return (
    <ul className="ml-6 space-y-1">
      {sections.map((section) => (
        <li
          key={section.id}
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid={`outline-section-${section.id}`}
        >
          <List size={13} className="shrink-0" />
          <span>
            {section.sectionNumber ? `${section.sectionNumber}. ` : ""}
            {section.name}
          </span>
          {section.isStub && (
            <Badge variant="secondary" className="text-[10px] px-1 py-0">
              stub
            </Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ContractOutline({ contractId }: { contractId: string }) {
  const { data: articles, isLoading } = useQuery<ContractArticle[]>({
    queryKey: ["/api/contracts", contractId, "articles"],
    queryFn: async () => {
      const res = await fetch(`/api/contracts/${contractId}/articles`);
      if (!res.ok) throw new Error("Failed to load articles");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (!articles || articles.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <Layers className="text-muted-foreground" size={32} />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-1">No articles yet</h3>
          <p className="text-muted-foreground text-center text-sm">
            Add articles to build the contract outline.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-2">
        <Accordion type="multiple" className="w-full">
          {articles.map((article) => (
            <AccordionItem
              key={article.id}
              value={article.id}
              data-testid={`outline-article-${article.id}`}
            >
              <AccordionTrigger className="text-left" data-testid={`outline-article-trigger-${article.id}`}>
                <span className="flex items-center gap-2">
                  <Layers size={16} className="text-primary shrink-0" />
                  <span>
                    {article.articleNumber ? `${article.articleNumber}. ` : ""}
                    {article.name}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <ArticleOutlineContent article={article} />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
