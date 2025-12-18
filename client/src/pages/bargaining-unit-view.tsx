import { Card, CardContent } from "@/components/ui/card";
import { BargainingUnitLayout, useBargainingUnitLayout } from "@/components/layouts/BargainingUnitLayout";

function hasData(data: unknown): boolean {
  return data !== null && typeof data === 'object' && Object.keys(data).length > 0;
}

function BargainingUnitViewContent() {
  const { bargainingUnit } = useBargainingUnitLayout();

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Bargaining Unit Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Name</label>
              <p className="text-foreground" data-testid="text-name">
                {bargainingUnit.name}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Sirius ID</label>
              <p className="text-foreground font-mono text-sm" data-testid="text-sirius-id">
                {bargainingUnit.siriusId}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Internal ID</label>
              <p className="text-foreground font-mono text-sm" data-testid="text-internal-id">
                {bargainingUnit.id}
              </p>
            </div>
          </div>
        </div>

        {hasData(bargainingUnit.data) && (
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">Additional Data</h3>
            <pre className="bg-muted p-4 rounded-md text-sm overflow-auto" data-testid="text-data">
              {JSON.stringify(bargainingUnit.data, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function BargainingUnitViewPage() {
  return (
    <BargainingUnitLayout activeTab="view">
      <BargainingUnitViewContent />
    </BargainingUnitLayout>
  );
}
