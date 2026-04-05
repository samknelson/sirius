import { useQuery } from "@tanstack/react-query";
import { TrustProviderEdiLayout, useTrustProviderEdiLayout } from "@/components/layouts/TrustProviderEdiLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SftpClientDestination } from "@shared/schema/system/sftp-client-schema";

function EdiDetailsContent() {
  const { edi } = useTrustProviderEdiLayout();

  const { data: sftpDestination } = useQuery<SftpClientDestination>({
    queryKey: ["/api/sftp/client-destinations", edi.sftpClientId],
    enabled: !!edi.sftpClientId,
  });

  return (
    <div className="space-y-6">
      <Card data-testid="card-edi-details">
        <CardHeader>
          <CardTitle>EDI Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Name</dt>
              <dd className="mt-1 text-sm" data-testid="text-edi-detail-name">{edi.name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Sirius ID</dt>
              <dd className="mt-1 text-sm" data-testid="text-edi-detail-sirius-id">
                {edi.siriusId || <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Status</dt>
              <dd className="mt-1 text-sm" data-testid="text-edi-detail-active">
                <Badge variant={edi.active ? "default" : "secondary"}>
                  {edi.active ? "Active" : "Inactive"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">SFTP Destination</dt>
              <dd className="mt-1 text-sm" data-testid="text-edi-detail-sftp">
                {sftpDestination ? (
                  <span>{sftpDestination.name}</span>
                ) : edi.sftpClientId ? (
                  <span className="text-muted-foreground italic">Loading...</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {edi.data && Object.keys(edi.data as Record<string, unknown>).length > 0 && (
        <Card data-testid="card-edi-data">
          <CardHeader>
            <CardTitle>Additional Data</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm bg-muted/50 p-4 rounded-md overflow-auto" data-testid="text-edi-data-json">
              {JSON.stringify(edi.data, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function TrustProviderEdiDetailsPage() {
  return (
    <TrustProviderEdiLayout activeTab="details">
      <EdiDetailsContent />
    </TrustProviderEdiLayout>
  );
}
