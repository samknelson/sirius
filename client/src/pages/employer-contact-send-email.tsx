import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function EmployerContactSendEmailContent() {
  const { employerContact } = useEmployerContactLayout();
  const contact = employerContact.contact ? {
    id: employerContact.contactId,
    email: employerContact.contact.email,
    displayName: employerContact.contact.displayName,
  } : null;
  return <CommSendWrapper channel="email" contact={contact} />;
}

export default function EmployerContactSendEmail() {
  return (
    <EmployerContactLayout activeTab="send-email">
      <EmployerContactSendEmailContent />
    </EmployerContactLayout>
  );
}
