import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield } from 'lucide-react';
import RolesManagement from '@/components/admin/RolesManagement';
import { usePageTitle } from "@/contexts/PageTitleContext";

export default function AdminRolesPage() {
  usePageTitle("Roles");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Role Management
        </h1>
        <p className="text-muted-foreground">
          Create and manage system roles with different permission levels
        </p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Roles
          </CardTitle>
          <CardDescription>
            Define system roles and their descriptions. Use the arrows to reorder roles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RolesManagement />
        </CardContent>
      </Card>
    </div>
  );
}