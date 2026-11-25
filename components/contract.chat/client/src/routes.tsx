import ProtectedRoute from "@/components/auth/ProtectedRoute";
import SettingsPage from "./settings-page";

export default function ContractChatSettingsRoute() {
  return (
    <ProtectedRoute permission="admin" component="contract.chat">
      <SettingsPage />
    </ProtectedRoute>
  );
}
