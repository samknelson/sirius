import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layers, ChevronRight, Pencil } from "lucide-react";
import type { ContractArticle } from "@shared/schema";
import { ContractLayout } from "@/components/layouts/ContractLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function OverviewBody() {
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
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
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
          <p className="text-muted-foreground text-center text-sm mb-4">
            Add articles from the Edit tab.
          </p>
          <Link href={`/contract/${id}/articles/edit`}>
            <Button data-testid="button-manage-articles">Manage Articles</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {articles.map((article) => (
        <Card key={article.id} data-testid={`card-article-${article.id}`}>
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <Layers size={18} className="text-primary shrink-0" />
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {article.articleNumber ? `${article.articleNumber}. ` : ""}
                  {article.name}
                </div>
              </div>
            </div>
            <Link href={`/contract/${id}/article/${article.id}/edit`}>
              <Button variant="outline" size="sm" data-testid={`button-manage-sections-${article.id}`}>
                <Pencil size={14} className="mr-2" />
                Sections
                <ChevronRight size={14} className="ml-1" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ContractArticlesOverviewPage() {
  return (
    <ContractLayout activeTab="articles-overview">
      <OverviewBody />
    </ContractLayout>
  );
}
