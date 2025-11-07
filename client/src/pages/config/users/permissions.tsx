import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Key } from 'lucide-react';
import PermissionsManagement from '@/components/admin/PermissionsManagement';

export default function PermissionsPage() {
  return (
    <div className="container mx-auto py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold" data-testid="heading-permissions">
          Permission Management
        </h1>
        <p className="text-muted-foreground mt-2">
          View and manage system permissions and their descriptions
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Permissions
          </CardTitle>
          <CardDescription>
            System-wide permissions and access control
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PermissionsManagement />
        </CardContent>
      </Card>
    </div>
  );
}
