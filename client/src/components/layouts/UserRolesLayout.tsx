import type { ReactNode } from "react";
import { Shield } from "lucide-react";
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
    <div className="container mx-auto max-w-7xl space-y-6 py-8">
      <div>
        <h1
          className="flex items-center gap-2 text-2xl font-bold md:text-3xl"
          data-testid="heading-roles"
        >
          <Shield className="h-7 w-7" />
          Role Management
        </h1>
        <p className="mt-2 text-muted-foreground">
          Define roles and configure role assignment for each user type
        </p>
      </div>

      <EntityTabNavigation
        tabs={tabs}
        activeTab={activeTab}
        testIdPrefix="tab-user-roles-"
        primaryTestId="tabs-user-roles"
      />

      {children}
    </div>
  );
}