import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function UserSendPostalContent() {
  const { contact } = useUserLayout();
  return (
    <CommSendWrapper 
      channel="postal" 
      contact={contact} 
      customErrorDescription="No contact record found for this user. Sending postal mail requires a contact record."
    />
  );
}

export default function UserSendPostal() {
  return (
    <UserLayout activeTab="send-postal">
      <UserSendPostalContent />
    </UserLayout>
  );
}
