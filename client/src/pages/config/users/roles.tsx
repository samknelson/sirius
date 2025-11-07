import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield } from 'lucide-react';
import RolesManagement from '@/components/admin/RolesManagement';

export default function RolesPage() {
  return (
    <div className="container mx-auto py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold" data-testid="heading-roles">
          Role Management
        </h1>
        <p className="text-muted-foreground mt-2">
          Define and manage roles with specific permissions
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Roles
          </CardTitle>
          <CardDescription>
            Create and manage roles and assign permissions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RolesManagement />
        </CardContent>
      </Card>
    </div>
  );
}
