import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Shield, Key, UserCheck } from 'lucide-react';
import UsersManagement from '@/components/admin/UsersManagement';
import RolesManagement from '@/components/admin/RolesManagement';
import PermissionsManagement from '@/components/admin/PermissionsManagement';
import { usePageTitle } from "@/contexts/PageTitleContext";

export default function UserManagementConfigPage() {
  usePageTitle("User Management");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          User Management
        </h1>
        <p className="text-muted-foreground mt-2">
          Manage users, roles, permissions, and access control for the Sirius system
        </p>
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="users" className="flex items-center gap-2" data-testid="tab-users">
            <Users className="h-4 w-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="roles" className="flex items-center gap-2" data-testid="tab-roles">
            <Shield className="h-4 w-4" />
            Roles
          </TabsTrigger>
          <TabsTrigger value="permissions" className="flex items-center gap-2" data-testid="tab-permissions">
            <Key className="h-4 w-4" />
            Permissions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                User Management
              </CardTitle>
              <CardDescription>
                Create and manage user accounts, activate or deactivate users
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UsersManagement />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Role Management
              </CardTitle>
              <CardDescription>
                Define and manage roles with specific permissions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RolesManagement />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Permission Management
              </CardTitle>
              <CardDescription>
                View and manage system permissions and their descriptions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PermissionsManagement />
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}