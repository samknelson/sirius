import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { CommSendWrapper } from "@/components/comm/CommSendWrapper";

function UserLogCallContent() {
  const { contact } = useUserLayout();
  return (
    <CommSendWrapper
      channel="interaction"
      contact={contact}
      customErrorDescription="No contact record found for this user. Logging an interaction requires a contact record."
    />
  );
}

export default function UserLogCall() {
  return (
    <UserLayout activeTab="log-call">
      <UserLogCallContent />
    </UserLayout>
  );
}
