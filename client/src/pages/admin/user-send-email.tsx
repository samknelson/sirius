import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function UserSendEmailContent() {
  const { contact } = useUserLayout();
  return (
    <CommSendWrapper 
      channel="email" 
      contact={contact} 
      customErrorDescription="No contact record found for this user. Sending email requires a contact record."
    />
  );
}

export default function UserSendEmail() {
  return (
    <UserLayout activeTab="send-email">
      <UserSendEmailContent />
    </UserLayout>
  );
}
