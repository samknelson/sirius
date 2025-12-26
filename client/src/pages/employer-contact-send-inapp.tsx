import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function EmployerContactSendInAppContent() {
  const { employerContact } = useEmployerContactLayout();
  const contact = employerContact.contact ? {
    id: employerContact.contactId,
    email: employerContact.contact.email,
    displayName: employerContact.contact.displayName,
  } : null;
  return <CommSendWrapper channel="inapp" contact={contact} />;
}

export default function EmployerContactSendInApp() {
  return (
    <EmployerContactLayout activeTab="send-inapp">
      <EmployerContactSendInAppContent />
    </EmployerContactLayout>
  );
}
