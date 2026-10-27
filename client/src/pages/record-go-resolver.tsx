import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { usePageTitle } from "@/contexts/PageTitleContext";

export default function RecordGoResolverRoute() {
  usePageTitle("Go to record");
  const { id } = useParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);

    async function resolve() {
      try {
        if (!id) throw new Error("Enter a record ID, metadata ID, or record sequence.");
        const result = await apiRequest("GET", `/api/go/${encodeURIComponent(id)}`);
        // Refuse malformed responses, external destinations, and another Go
        // URL: none may restart this resolver or cause a navigation loop.
        if (typeof result?.href !== "string" || !result.href.startsWith("/")) {
          throw new Error("The server did not return a valid record destination.");
        }
        const destination = new URL(result.href, window.location.origin);
        if (destination.origin !== window.location.origin ||
            /^\/go(?:\/|$)/i.test(destination.pathname)) {
          throw new Error("The server did not return a valid record destination.");
        }
        if (active) window.location.replace(destination.href);
      } catch (cause) {
        if (active) setError(getApiErrorMessage(cause, "Unable to open this record."));
      }
    }

    void resolve();
    return () => { active = false; };
  }, [id]);

  if (!error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center gap-2" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span>Opening record…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-[400px] items-start justify-center p-6 md:p-10">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Unable to open record</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p role="alert" data-testid="record-go-error">{error}</p>
          <Link href="/go" className="text-primary underline-offset-4 hover:underline">
            Try another record identifier
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
