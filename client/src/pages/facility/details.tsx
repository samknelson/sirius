import { FacilityLayout, useFacilityLayout } from "@/components/layouts/FacilityLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function DetailsContent() {
  const { facility } = useFacilityLayout();
  return (
    <div className="space-y-6">
      <Card data-testid="card-details">
        <CardHeader>
          <CardTitle>Facility Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Name</dt>
              <dd className="mt-1 text-sm" data-testid="text-detail-name">{facility.name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Sirius ID</dt>
              <dd className="mt-1 text-sm text-muted-foreground" data-testid="text-detail-sirius-id">{facility.siriusId || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Email</dt>
              <dd className="mt-1 text-sm text-muted-foreground" data-testid="text-detail-email">{facility.contact?.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Contact ID</dt>
              <dd className="mt-1 text-sm text-muted-foreground font-mono" data-testid="text-detail-contact-id">{facility.contactId}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export default function FacilityDetailsPage() {
  return (
    <FacilityLayout activeTab="details">
      <DetailsContent />
    </FacilityLayout>
  );
}
