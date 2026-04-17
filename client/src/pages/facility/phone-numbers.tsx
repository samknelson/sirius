import { FacilityLayout, useFacilityLayout } from "@/components/layouts/FacilityLayout";
import { PhoneNumberManagement } from "@/components/worker/PhoneNumberManagement";
import { useAccessCheck } from "@/hooks/use-access-check";

function PhonesContent() {
  const { facility } = useFacilityLayout();
  const { canAccess: canEdit } = useAccessCheck("facility.edit", facility.id);

  return <PhoneNumberManagement contactId={facility.contactId} canEdit={canEdit} />;
}

export default function FacilityPhoneNumbersPage() {
  return (
    <FacilityLayout activeTab="phone-numbers">
      <PhonesContent />
    </FacilityLayout>
  );
}
