import TrustProviderLayout, { useTrustProviderLayout } from "@/components/layouts/TrustProviderLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function TrustProviderViewContent() {
  const { provider } = useTrustProviderLayout();

  if (!provider) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider Information</CardTitle>
        <CardDescription>View trust provider details</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Basic Information</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Provider ID</label>
                <p className="text-sm text-muted-foreground mt-1" data-testid="text-provider-id">
                  {provider.id}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Name</label>
                <p className="text-sm mt-1" data-testid="text-provider-name">
                  {provider.name}
                </p>
              </div>
            </div>
          </div>

          {!!provider.data && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Additional Data</h3>
              <pre className="text-sm bg-muted p-4 rounded-md overflow-x-auto" data-testid="text-provider-data">
                {JSON.stringify(provider.data, null, 2) as string}
              </pre>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function TrustProviderViewPage() {
  return (
    <TrustProviderLayout activeTab="view">
      <TrustProviderViewContent />
    </TrustProviderLayout>
  );
}
