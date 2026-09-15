import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, Shield, User } from 'lucide-react';
import RolesManagement from '@/components/admin/RolesManagement';
import UserRoleSettings from '@/components/admin/UserRoleSettings';

type RolesView = "roles" | "workers" | "employers" | "providers";

export default function RolesPage({ view = "roles" }: { view?: RolesView }) {
  if (view === "workers") {
    return (
      <UserRoleSettings
        subject="Worker User"
        subjectPlural="worker users"
        requiredVariable="worker_user_roles_required"
        optionalVariable="worker_user_roles_optional"
        icon={User}
        testIdPrefix="worker"
      />
    );
  }

  if (view === "employers") {
    return (
      <UserRoleSettings
        subject="Employer User"
        subjectPlural="employer users"
        requiredVariable="employer_user_roles_required"
        optionalVariable="employer_user_roles_optional"
        icon={Briefcase}
        testIdPrefix="employer"
      />
    );
  }

  if (view === "providers") {
    return (
      <UserRoleSettings
        subject="Provider User"
        subjectPlural="trust provider users"
        requiredVariable="trust_provider_user_roles_required"
        optionalVariable="trust_provider_user_roles_optional"
        icon={Shield}
        testIdPrefix="provider"
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Roles
        </CardTitle>
        <CardDescription>Create and manage roles and assign permissions</CardDescription>
      </CardHeader>
      <CardContent>
        <RolesManagement />
      </CardContent>
    </Card>
  );
}
