import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Key } from 'lucide-react';
import PermissionsManagement from '@/components/admin/PermissionsManagement';
import { usePageTitle } from "@/contexts/PageTitleContext";

export default function AdminPermissionsPage() {
  usePageTitle("Permissions");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Permissions Management
        </h1>
        <p className="text-muted-foreground">
          Manage system permissions and assign them to roles
        </p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Permissions
          </CardTitle>
          <CardDescription>
            View and manage permission assignments to roles
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PermissionsManagement />
        </CardContent>
      </Card>
    </div>
  );
}