import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, Shield, User } from 'lucide-react';
import RolesManagement from '@/components/admin/RolesManagement';
import UserRoleSettings from '@/components/admin/UserRoleSettings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePageTitle } from "@/contexts/PageTitleContext";

export default function RolesPage() {
  usePageTitle("Roles");
  return (
    <div className="container mx-auto py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="heading-roles">
          Role Management
        </h1>
        <p className="text-muted-foreground mt-2">
          Define and manage roles with specific permissions
        </p>
      </div>

      <Tabs defaultValue="roles" className="space-y-6">
        <TabsList className="grid h-auto w-full grid-cols-2 md:grid-cols-4">
          <TabsTrigger value="roles" data-testid="tab-roles">Roles</TabsTrigger>
          <TabsTrigger value="workers" data-testid="tab-worker-users">Worker Users</TabsTrigger>
          <TabsTrigger value="employers" data-testid="tab-employer-users">Employer Users</TabsTrigger>
          <TabsTrigger value="providers" data-testid="tab-provider-users">Provider Users</TabsTrigger>
        </TabsList>

        <TabsContent value="roles">
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
        </TabsContent>
        <TabsContent value="workers">
          <UserRoleSettings
            subject="Worker User"
            subjectPlural="worker users"
            requiredVariable="worker_user_roles_required"
            optionalVariable="worker_user_roles_optional"
            icon={User}
            testIdPrefix="worker"
          />
        </TabsContent>
        <TabsContent value="employers">
          <UserRoleSettings
            subject="Employer User"
            subjectPlural="employer users"
            requiredVariable="employer_user_roles_required"
            optionalVariable="employer_user_roles_optional"
            icon={Briefcase}
            testIdPrefix="employer"
          />
        </TabsContent>
        <TabsContent value="providers">
          <UserRoleSettings
            subject="Provider User"
            subjectPlural="trust provider users"
            requiredVariable="trust_provider_user_roles_required"
            optionalVariable="trust_provider_user_roles_optional"
            icon={Shield}
            testIdPrefix="provider"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
