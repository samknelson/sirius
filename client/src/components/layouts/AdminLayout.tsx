import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Users, Shield, Key, UserCheck, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePageTitle } from "@/contexts/PageTitleContext";

interface AdminLayoutProps {
  children: React.ReactNode;
}

const adminNavItems = [
  {
    href: '/admin/users',
    label: 'Users',
    icon: Users,
    description: 'Manage user accounts'
  },
  {
    href: '/admin/roles', 
    label: 'Roles',
    icon: Shield,
    description: 'Manage system roles'
  },
  {
    href: '/admin/permissions',
    label: 'Permissions', 
    icon: Key,
    description: 'Manage permissions'
  }
];

export default function AdminLayout({ children }: AdminLayoutProps) {
  const [location] = useLocation();

  // Set page title for admin section
  usePageTitle("System Administration");

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

      <div className="mb-6">
        <nav className="flex space-x-1 bg-muted p-1 rounded-lg">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={isActive ? 'default' : 'ghost'}
                  size="sm"
                  className={cn(
                    "flex items-center gap-2 transition-colors",
                    isActive && "bg-background text-foreground shadow-sm"
                  )}
                  data-testid={`nav-${item.label.toLowerCase()}`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="space-y-6">
        {children}
      </div>
    </div>
  );
}