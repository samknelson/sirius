import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Loader2, ArrowLeft, Pencil } from "lucide-react";
import { CardcheckDefinition } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CardcheckDefinitionViewPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: definition, isLoading, error } = useQuery<CardcheckDefinition>({
    queryKey: ["/api/cardcheck/definition", id],
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (error || !definition) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-destructive">Cardcheck definition not found.</p>
            <Link href="/cardcheck/definitions">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Definitions
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <Link href="/cardcheck/definitions">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="heading-cardcheck-definition">
                {definition.name}
              </h1>
              <p className="text-muted-foreground font-mono text-sm">
                [{definition.siriusId}]
              </p>
            </div>
          </div>
          <Link href={`/cardcheck/definition/${id}/edit`}>
            <Button data-testid="button-edit">
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Sirius ID</label>
                <p className="text-foreground font-mono text-sm" data-testid="text-sirius-id">
                  {definition.siriusId}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Record ID</label>
                <p className="text-foreground font-mono text-sm" data-testid="text-id">
                  {definition.id}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Name</label>
                <p className="text-foreground" data-testid="text-name">
                  {definition.name}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Description</label>
              <p className="text-foreground whitespace-pre-wrap" data-testid="text-description">
                {definition.description || <span className="text-muted-foreground italic">No description</span>}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Body (HTML)</label>
              <div 
                className="bg-muted rounded-md p-4 min-h-[100px] prose prose-sm max-w-none dark:prose-invert"
                data-testid="text-body"
              >
                {definition.body ? (
                  <div dangerouslySetInnerHTML={{ __html: definition.body }} />
                ) : (
                  <span className="text-muted-foreground italic">No body content</span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Data (JSON)</label>
              <pre 
                className="bg-muted rounded-md p-4 overflow-x-auto text-sm font-mono"
                data-testid="text-data"
              >
                {definition.data ? JSON.stringify(definition.data, null, 2) : "null"}
              </pre>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/cardcheck/definitions">
            <Button variant="outline" data-testid="button-back-to-list">
              Back to List
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
