import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function UserSendInAppContent() {
  const { contact } = useUserLayout();
  return (
    <CommSendWrapper 
      channel="inapp" 
      contact={contact} 
      customErrorDescription="No contact record found for this user. Sending in-app messages requires a contact record."
    />
  );
}

export default function UserSendInApp() {
  return (
    <UserLayout activeTab="send-inapp">
      <UserSendInAppContent />
    </UserLayout>
  );
}
