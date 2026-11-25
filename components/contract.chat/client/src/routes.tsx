import ProtectedRoute from "@/components/auth/ProtectedRoute";
import SettingsPage from "./settings-page";
import ContractChatPage from "./chat-page";

export default function ContractChatSettingsRoute() {
  return (
    <ProtectedRoute permission="admin" component="contract.chat">
      <SettingsPage />
    </ProtectedRoute>
  );
}

export function ContractChatRoute() {
  return (
    <ProtectedRoute permission="contract.chat" component="contract.chat">
      <ContractChatPage />
    </ProtectedRoute>
  );
}
