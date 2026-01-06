import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Users } from "lucide-react";
import UsersManagement from "@/components/admin/UsersManagement";
import { usePageTitle } from "@/contexts/PageTitleContext";

export default function AdminUsersPage() {
  usePageTitle("User Management");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          User Management
        </h1>
        <p className="text-muted-foreground">
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
            Manage system users and their account status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsersManagement />
        </CardContent>
      </Card>
    </div>
  );
}
