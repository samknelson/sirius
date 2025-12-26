import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function UserSendSmsContent() {
  const { contact } = useUserLayout();
  return (
    <CommSendWrapper 
      channel="sms" 
      contact={contact} 
      customErrorDescription="No contact record found for this user. Sending SMS requires a contact record."
    />
  );
}

export default function UserSendSms() {
  return (
    <UserLayout activeTab="send-sms">
      <UserSendSmsContent />
    </UserLayout>
  );
}
