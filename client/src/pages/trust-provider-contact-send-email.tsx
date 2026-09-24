import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function TrustProviderContactSendEmailContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();
  const contact = trustProviderContact.contact ? {
    id: trustProviderContact.contactId,
    email: trustProviderContact.contact.email,
    displayName: trustProviderContact.contact.displayName,
  } : null;
  return <CommSendWrapper channel="email" contact={contact} composeTarget={{ scope: "provider_contact", recordId: trustProviderContact.id }} />;
}

export default function TrustProviderContactSendEmail() {
  return (
    <TrustProviderContactLayout activeTab="send-email">
      <TrustProviderContactSendEmailContent />
    </TrustProviderContactLayout>
  );
}
