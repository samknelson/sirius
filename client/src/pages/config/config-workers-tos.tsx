import { useEffect, useState } from "react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useVariableValue, useSetVariable } from "@/lib/use-variable";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { TOS_BANNER_VARIABLE_NAME, TOS_BANNER_DEFAULT_HTML } from "@/lib/worker-tos-banner";
import { Loader2, Save, CalendarOff } from "lucide-react";

export default function WorkersTosConfigPage() {
  usePageTitle("Time Off Sick Settings");
  const { toast } = useToast();

  const { data: value, isLoading } = useVariableValue(TOS_BANNER_VARIABLE_NAME);
  const [content, setContent] = useState<string>(TOS_BANNER_DEFAULT_HTML);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (isLoading || initialized) return;
    setContent(typeof value === "string" && value ? value : TOS_BANNER_DEFAULT_HTML);
    setInitialized(true);
  }, [value, isLoading, initialized]);

  const saveMutation = useSetVariable(TOS_BANNER_VARIABLE_NAME, {
    onSuccess: () => {
      toast({
        title: "Settings saved",
        description: "The absence banner text has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-96" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold" data-testid="text-page-title">
          Time Off Sick Settings
        </h1>
        <p className="text-muted-foreground">
          Configure the banner shown on a worker's pages while they have an open absence.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarOff className="h-5 w-5" />
            Absence Banner
          </CardTitle>
          <CardDescription>
            This message is displayed across all of a worker's detail pages while they have an
            absence with no end date. Basic HTML formatting and links are supported.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SimpleHtmlEditor
            value={content}
            onChange={setContent}
            placeholder="Banner text shown during an open absence..."
            data-testid="editor-tos-banner"
          />
          <div className="flex justify-end">
            <Button
              onClick={() => saveMutation.mutate(content)}
              disabled={saveMutation.isPending}
              data-testid="button-save-tos-banner"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
