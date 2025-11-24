import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { EALayout } from "@/components/layouts/EALayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { JsonDataViewer } from "@/components/ui/json-data-viewer";

type LedgerEA = {
  id: string;
  accountId: string;
  entityType: string;
  entityId: string;
  data: unknown;
};

type LedgerAccount = {
  id: string;
  name: string;
  description: string | null;
};

function EAViewContent() {
  const { id } = useParams<{ id: string }>();

  const { data: ea, isLoading: eaLoading } = useQuery<LedgerEA>({
    queryKey: ['/api/ledger/ea', id],
  });

  const { data: account, isLoading: accountLoading } = useQuery<LedgerAccount>({
    queryKey: ['/api/ledger/accounts', ea?.accountId],
    enabled: !!ea?.accountId,
  });

  if (eaLoading || accountLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Account Entry Details</CardTitle>
          <CardDescription>Loading account entry information...</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!ea) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Account Entry Not Found</CardTitle>
          <CardDescription>The requested account entry could not be found.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account Entry Details</CardTitle>
        <CardDescription>View information about this account entry</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Entry ID</label>
            <p className="text-foreground font-mono text-sm" data-testid="text-entry-id">
              {ea.id}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Account</label>
            <p className="text-foreground" data-testid="text-account-name">
              {account?.name || ea.accountId}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Entity Type</label>
            <p className="text-foreground capitalize" data-testid="text-entity-type">
              {ea.entityType}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Entity ID</label>
            <p className="text-foreground font-mono text-sm" data-testid="text-entity-id">
              {ea.entityId}
            </p>
          </div>
        </div>

        {ea.data ? (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-muted-foreground">Additional Data</label>
            <JsonDataViewer
              data={ea.data}
              title="Additional Data"
              description="View additional JSON data for this account entry"
              iconOnly
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function EAView() {
  return (
    <EALayout activeTab="view">
      <EAViewContent />
    </EALayout>
  );
}
