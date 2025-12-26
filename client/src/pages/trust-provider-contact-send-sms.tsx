import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function TrustProviderContactSendSmsContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();
  const contact = trustProviderContact.contact ? {
    id: trustProviderContact.contactId,
    email: trustProviderContact.contact.email,
    displayName: trustProviderContact.contact.displayName,
  } : null;
  return <CommSendWrapper channel="sms" contact={contact} />;
}

export default function TrustProviderContactSendSms() {
  return (
    <TrustProviderContactLayout activeTab="send-sms">
      <TrustProviderContactSendSmsContent />
    </TrustProviderContactLayout>
  );
}
