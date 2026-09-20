import type { ReactNode } from "react";
import { Shield } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EntityTabNavigation } from "@/components/shared/EntityTabNavigation";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useUserRolesTabAccess } from "@/hooks/useTabAccess";

interface UserRolesLayoutProps {
  activeTab: "roles" | "worker-users" | "employer-users" | "provider-users";
  children: ReactNode;
}

export default function UserRolesLayout({ activeTab, children }: UserRolesLayoutProps) {
  usePageTitle("Roles");
  const { tabs } = useUserRolesTabAccess();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader
        title="Role Management"
        icon={<Shield className="text-primary-foreground" size={16} />}
      />

      <EntityTabNavigation
        tabs={tabs}
        activeTab={activeTab}
        testIdPrefix="tab-user-roles-"
        primaryTestId="tabs-user-roles"
      />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}