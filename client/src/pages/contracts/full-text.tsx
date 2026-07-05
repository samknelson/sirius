import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import type { ContractArticle, ContractSection } from "@shared/schema";
import { ContractLayout } from "@/components/layouts/ContractLayout";
import { ContractHtml } from "@/components/contracts/ContractHtml";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

function ArticleFullText({ article }: { article: ContractArticle }) {
  const { data: sections, isLoading } = useQuery<ContractSection[]>({
    queryKey: ["/api/contracts/articles", article.id, "sections"],
    queryFn: async () => {
      const res = await fetch(`/api/contracts/articles/${article.id}/sections`);
      if (!res.ok) throw new Error("Failed to load sections");
      return res.json();
    },
  });

  return (
    <AccordionItem value={article.id} data-testid={`fulltext-article-${article.id}`}>
      <AccordionTrigger className="text-left" data-testid={`fulltext-article-trigger-${article.id}`}>
        <span className="text-base font-semibold text-foreground">
          {article.articleNumber ? `Article ${article.articleNumber} — ` : ""}
          {article.name}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : sections && sections.length > 0 ? (
          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section.id} className="space-y-2" data-testid={`fulltext-section-${section.id}`}>
                <h3 className="text-base font-medium flex items-center gap-2">
                  <span>
                    {section.sectionNumber ? `${section.sectionNumber}. ` : ""}
                    {section.name}
                  </span>
                  {section.isStub && <Badge variant="secondary">stub</Badge>}
                </h3>
                <ContractHtml html={section.body} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No sections.</p>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function FullTextBody() {
  const { id } = useParams<{ id: string }>();
  const { data: articles, isLoading } = useQuery<ContractArticle[]>({
    queryKey: ["/api/contracts", id, "articles"],
    queryFn: async () => {
      const res = await fetch(`/api/contracts/${id}/articles`);
      if (!res.ok) throw new Error("Failed to load articles");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (!articles || articles.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <FileText className="text-muted-foreground" size={32} />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-1">Nothing to show yet</h3>
          <p className="text-muted-foreground text-center text-sm">
            Add articles and sections to see the full contract text.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-3xl">
      <CardContent className="py-2">
        <Accordion type="multiple" className="w-full">
          {articles.map((article) => (
            <ArticleFullText key={article.id} article={article} />
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

export default function ContractFullTextPage() {
  return (
    <ContractLayout activeTab="fulltext">
      <FullTextBody />
    </ContractLayout>
  );
}
