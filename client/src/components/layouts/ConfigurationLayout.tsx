import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Users, MapPin, Phone, Globe } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface ConfigurationLayoutProps {
  children: React.ReactNode;
}

export default function ConfigurationLayout({ children }: ConfigurationLayoutProps) {
  const [location] = useLocation();
  const { hasPermission } = useAuth();

  const navigationItems = [
    {
      path: "/config/site",
      label: "Site Information",
      icon: Globe,
      testId: "nav-config-site",
      permission: "variables.manage",
    },
    {
      path: "/config/users",
      label: "User Management",
      icon: Users,
      testId: "nav-config-users",
      permission: "admin.manage",
    },
    {
      path: "/config/addresses",
      label: "Postal Addresses",
      icon: MapPin,
      testId: "nav-config-addresses",
      permission: "admin.manage",
    },
    {
      path: "/config/phone-numbers",
      label: "Phone Numbers",
      icon: Phone,
      testId: "nav-config-phone-numbers",
      permission: "admin.manage",
    },
  ];

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <div className="w-64 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6">
            Configuration
          </h2>
          <nav className="space-y-2">
            {navigationItems.filter((item) => hasPermission(item.permission)).map((item) => {
              const Icon = item.icon;
              const isActive = location === item.path || location.startsWith(item.path + "/");
              
              return (
                <Link key={item.path} href={item.path}>
                  <Button
                    variant={isActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid={item.testId}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {item.label}
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-6">
        {children}
      </div>
    </div>
  );
}