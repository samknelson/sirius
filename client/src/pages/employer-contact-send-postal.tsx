import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function EmployerContactSendPostalContent() {
  const { employerContact } = useEmployerContactLayout();
  const contact = employerContact.contact ? {
    id: employerContact.contactId,
    email: employerContact.contact.email,
    displayName: employerContact.contact.displayName,
  } : null;
  return <CommSendWrapper channel="postal" contact={contact} composeTarget={{ scope: "employer_contact", recordId: employerContact.id }} />;
}

export default function EmployerContactSendPostal() {
  return (
    <EmployerContactLayout activeTab="send-postal">
      <EmployerContactSendPostalContent />
    </EmployerContactLayout>
  );
}
