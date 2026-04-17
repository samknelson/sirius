import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, Loader2, ShieldCheck } from "lucide-react";

export interface TokenCoverageRow {
  tokenId: string;
  label: string;
  defaultValue: string;
  missingCount: number;
  missingSample: { contactId: string; name: string }[];
}

export interface TokenCoverageResponse {
  totalRecipients: number;
  perToken: TokenCoverageRow[];
}

interface Props {
  messageId: string;
}

export function TokenCoverageCard({ messageId }: Props) {
  const { data, isLoading, isError, error } = useQuery<TokenCoverageResponse>({
    queryKey: ["/api/bulk-messages", messageId, "token-coverage"],
  });

  if (isLoading) {
    return (
      <Card data-testid="card-token-coverage">
        <CardContent className="flex items-center justify-center h-24">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="card-token-coverage">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-4 w-4 text-destructive" />
            Token Coverage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription data-testid="text-coverage-error">
              {(error as Error)?.message || "Failed to compute token coverage."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const tokensWithMissing = data.perToken.filter((t) => t.missingCount > 0);
  const allCovered = data.perToken.length > 0 && tokensWithMissing.length === 0;
  const totalMissing = tokensWithMissing.reduce((sum, t) => sum + t.missingCount, 0);

  return (
    <Card data-testid="card-token-coverage">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          Token Coverage
          {data.perToken.length > 0 && (
            <Badge
              variant={allCovered ? "secondary" : "destructive"}
              className="ml-auto"
              data-testid="badge-coverage-summary"
            >
              {allCovered
                ? "All recipients covered"
                : `${totalMissing} missing across ${tokensWithMissing.length} token${tokensWithMissing.length === 1 ? "" : "s"}`}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.perToken.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="text-no-tokens">
            This message doesn't use any tokens.
          </p>
        )}

        {allCovered && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500" data-testid="status-all-covered">
            <CheckCircle className="h-4 w-4" />
            All {data.totalRecipients} recipient{data.totalRecipients === 1 ? "" : "s"} have data for every token used.
          </div>
        )}

        {data.perToken.map((row) => (
          <TokenRow key={row.tokenId} row={row} totalRecipients={data.totalRecipients} />
        ))}
      </CardContent>
    </Card>
  );
}

function TokenRow({ row, totalRecipients }: { row: TokenCoverageRow; totalRecipients: number }) {
  const [open, setOpen] = useState(false);
  const isMissing = row.missingCount > 0;
  return (
    <div
      className="border rounded-md p-3 space-y-2"
      data-testid={`row-coverage-${row.tokenId}`}
    >
      <div className="flex items-center gap-2 text-sm">
        {isMissing ? (
          <AlertCircle className="h-4 w-4 text-amber-500" />
        ) : (
          <CheckCircle className="h-4 w-4 text-green-500" />
        )}
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{`{{${row.tokenId}}}`}</code>
        <span className="text-muted-foreground">{row.label}</span>
        <Badge
          variant={isMissing ? "destructive" : "secondary"}
          className="ml-auto"
          data-testid={`badge-coverage-${row.tokenId}`}
        >
          {isMissing
            ? `${row.missingCount} of ${totalRecipients} missing`
            : `All ${totalRecipients} covered`}
        </Badge>
      </div>
      {isMissing && (
        <>
          <p className="text-xs text-muted-foreground">
            Recipients without a value will see the default:{" "}
            <span className="font-mono">{row.defaultValue || "(empty)"}</span>
          </p>
          {row.missingSample.length > 0 && (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  data-testid={`button-toggle-missing-${row.tokenId}`}
                >
                  {open ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                  Show {Math.min(row.missingSample.length, 10)} affected recipient
                  {row.missingSample.length === 1 ? "" : "s"}
                  {row.missingCount > row.missingSample.length && ` (of ${row.missingCount})`}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-1">
                <ul className="text-xs text-muted-foreground space-y-0.5 pl-5 list-disc">
                  {row.missingSample.map((s) => (
                    <li key={s.contactId} data-testid={`item-missing-${row.tokenId}-${s.contactId}`}>
                      {s.name}
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
    </div>
  );
}
