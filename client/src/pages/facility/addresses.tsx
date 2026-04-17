import { FacilityLayout, useFacilityLayout } from "@/components/layouts/FacilityLayout";
import AddressManagement from "@/components/worker/AddressManagement";
import { useAccessCheck } from "@/hooks/use-access-check";

function AddressesContent() {
  const { facility } = useFacilityLayout();
  const { canAccess: canEdit } = useAccessCheck("facility.edit", facility.id);

  return (
    <AddressManagement
      workerId={facility.id}
      contactId={facility.contactId}
      canEdit={canEdit}
    />
  );
}

export default function FacilityAddressesPage() {
  return (
    <FacilityLayout activeTab="addresses">
      <AddressesContent />
    </FacilityLayout>
  );
}
