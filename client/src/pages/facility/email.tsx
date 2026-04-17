import { FacilityLayout, useFacilityLayout } from "@/components/layouts/FacilityLayout";
import EntityEmailManagement from "@/components/shared/EntityEmailManagement";
import { useAccessCheck } from "@/hooks/use-access-check";

function EmailContent() {
  const { facility } = useFacilityLayout();
  const { canAccess: canEdit } = useAccessCheck("facility.edit", facility.id);

  if (!canEdit) {
    return (
      <div className="text-sm text-muted-foreground" data-testid="text-email-readonly">
        Email: <span className="text-foreground">{facility.contact?.email || "—"}</span>
      </div>
    );
  }

  return (
    <EntityEmailManagement
      config={{
        entityId: facility.id,
        currentEmail: facility.contact?.email || null,
        apiEndpoint: `/api/facilities/${facility.id}`,
        apiMethod: "PATCH",
        apiPayloadKey: "email",
        invalidateQueryKeys: [
          ["/api/facilities"],
          ["/api/facilities", facility.id],
        ],
        cardTitle: "Facility Email",
        cardDescription: "Manage the email for this facility's contact",
      }}
    />
  );
}

export default function FacilityEmailPage() {
  return (
    <FacilityLayout activeTab="email">
      <EmailContent />
    </FacilityLayout>
  );
}
