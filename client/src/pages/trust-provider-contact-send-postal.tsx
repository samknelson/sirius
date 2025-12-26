import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function TrustProviderContactSendPostalContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();
  const contact = trustProviderContact.contact ? {
    id: trustProviderContact.contactId,
    email: trustProviderContact.contact.email,
    displayName: trustProviderContact.contact.displayName,
  } : null;
  return <CommSendWrapper channel="postal" contact={contact} />;
}

export default function TrustProviderContactSendPostal() {
  return (
    <TrustProviderContactLayout activeTab="send-postal">
      <TrustProviderContactSendPostalContent />
    </TrustProviderContactLayout>
  );
}
