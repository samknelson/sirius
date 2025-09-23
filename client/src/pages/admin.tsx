import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Shield, Key, UserCheck } from 'lucide-react';
import UsersManagement from '@/components/admin/UsersManagement';
import RolesManagement from '@/components/admin/RolesManagement';
import PermissionsManagement from '@/components/admin/PermissionsManagement';
import RoleAssignments from '@/components/admin/RoleAssignments';

export default function AdminPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          System Administration
        </h1>
        <p className="text-muted-foreground mt-2">
          Manage users, roles, permissions, and access control for the Sirius system
        </p>
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-6">
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
          <TabsTrigger value="assignments" className="flex items-center gap-2" data-testid="tab-assignments">
            <UserCheck className="h-4 w-4" />
            Assignments
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
                Define and manage system roles with their descriptions
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
                Define and manage system permissions and access controls
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PermissionsManagement />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assignments">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5" />
                Role Assignments
              </CardTitle>
              <CardDescription>
                Assign roles to users and manage their permissions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RoleAssignments />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}