import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function EmployerContactSendSmsContent() {
  const { employerContact } = useEmployerContactLayout();
  const contact = employerContact.contact ? {
    id: employerContact.contactId,
    email: employerContact.contact.email,
    displayName: employerContact.contact.displayName,
  } : null;
  return <CommSendWrapper channel="sms" contact={contact} />;
}

export default function EmployerContactSendSms() {
  return (
    <EmployerContactLayout activeTab="send-sms">
      <EmployerContactSendSmsContent />
    </EmployerContactLayout>
  );
}
