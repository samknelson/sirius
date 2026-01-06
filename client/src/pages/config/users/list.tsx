import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users } from 'lucide-react';
import UsersManagement from '@/components/admin/UsersManagement';
import { usePageTitle } from "@/contexts/PageTitleContext";

export default function UsersListPage() {
  usePageTitle("Users");
  return (
    <div className="container mx-auto py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold" data-testid="heading-users">
          User Management
        </h1>
        <p className="text-muted-foreground mt-2">
          Create and manage user accounts, activate or deactivate users
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Users
          </CardTitle>
          <CardDescription>
            Manage user accounts and their status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsersManagement />
        </CardContent>
      </Card>
    </div>
  );
}
