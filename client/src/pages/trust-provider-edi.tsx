import { useQuery } from "@tanstack/react-query";
import TrustProviderLayout, { useTrustProviderLayout } from "@/components/layouts/TrustProviderLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, FileText } from "lucide-react";
import { Link } from "wouter";
import type { TrustProviderEdi } from "@shared/schema/trust/provider-edi-schema";

function TrustProviderEdiContent() {
  const { provider } = useTrustProviderLayout();

  const { data: ediRecords, isLoading } = useQuery<TrustProviderEdi[]>({
    queryKey: ["/api/trust-provider-edi", { providerId: provider?.id }],
    queryFn: async () => {
      const response = await fetch(`/api/trust-provider-edi?providerId=${provider!.id}`);
      if (!response.ok) throw new Error("Failed to fetch EDI records");
      return response.json();
    },
    enabled: !!provider,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle data-testid="heading-edi-list">EDI Records</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="border rounded-lg p-4">
                  <Skeleton className="h-6 w-48 mb-2" />
                  <Skeleton className="h-4 w-64" />
                </div>
              ))}
            </div>
          ) : !ediRecords || ediRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="text-edi-empty">
              <FileText size={48} className="mx-auto mb-4 opacity-50" />
              <p>No EDI records found for this provider.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {ediRecords.map((edi) => (
                <Card key={edi.id} className="hover:shadow-md transition-shadow" data-testid={`card-edi-${edi.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-lg" data-testid={`text-edi-name-${edi.id}`}>
                            {edi.name}
                          </h3>
                          <Badge variant={edi.active ? "default" : "secondary"} data-testid={`badge-edi-status-${edi.id}`}>
                            {edi.active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <div className="space-y-1 text-sm text-muted-foreground">
                          {edi.siriusId && (
                            <p data-testid={`text-edi-sirius-id-${edi.id}`}>
                              Sirius ID: <span className="font-medium">{edi.siriusId}</span>
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link href={`/trust/provider-edi/${edi.id}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-view-edi-${edi.id}`}
                          >
                            <Eye size={16} className="mr-2" />
                            View
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TrustProviderEdiPage() {
  return (
    <TrustProviderLayout activeTab="edi">
      <TrustProviderEdiContent />
    </TrustProviderLayout>
  );
}
