import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function TrustProviderContactSendInAppContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();
  const contact = trustProviderContact.contact ? {
    id: trustProviderContact.contactId,
    email: trustProviderContact.contact.email,
    displayName: trustProviderContact.contact.displayName,
  } : null;
  return <CommSendWrapper channel="inapp" contact={contact} />;
}

export default function TrustProviderContactSendInApp() {
  return (
    <TrustProviderContactLayout activeTab="send-inapp">
      <TrustProviderContactSendInAppContent />
    </TrustProviderContactLayout>
  );
}
