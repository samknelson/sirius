import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Users, MapPin, Phone, Globe, List, UserCog, ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";

interface ConfigurationLayoutProps {
  children: React.ReactNode;
}

export default function ConfigurationLayout({ children }: ConfigurationLayoutProps) {
  const [location] = useLocation();
  const { hasPermission } = useAuth();
  const [isDropDownListsOpen, setIsDropDownListsOpen] = useState(false);

  const regularNavItems = [
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
      path: "/config/masquerade",
      label: "Masquerade",
      icon: UserCog,
      testId: "nav-config-masquerade",
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

  const dropDownListItems = [
    {
      path: "/config/gender-options",
      label: "Gender Options",
      icon: List,
      testId: "nav-config-gender-options",
      permission: "variables.manage",
    },
    {
      path: "/config/worker-id-types",
      label: "Worker ID Types",
      icon: List,
      testId: "nav-config-worker-id-types",
      permission: "variables.manage",
    },
    {
      path: "/config/trust-benefit-types",
      label: "Trust Benefit Types",
      icon: List,
      testId: "nav-config-trust-benefit-types",
      permission: "variables.manage",
    },
  ];

  // Check if any dropdown list item is active
  const isDropDownListActive = dropDownListItems.some(
    (item) => location === item.path || location.startsWith(item.path + "/")
  );

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <div className="w-64 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6">
            Configuration
          </h2>
          <nav className="space-y-2">
            {regularNavItems.filter((item) => hasPermission(item.permission)).map((item) => {
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

            {/* Drop-Down Lists Group */}
            {dropDownListItems.some((item) => hasPermission(item.permission)) && (
              <Collapsible
                open={isDropDownListsOpen || isDropDownListActive}
                onOpenChange={setIsDropDownListsOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant={isDropDownListActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="nav-config-dropdown-lists"
                  >
                    <List className="mr-2 h-4 w-4" />
                    Drop-Down Lists
                    <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200" 
                      style={{ transform: (isDropDownListsOpen || isDropDownListActive) ? 'rotate(180deg)' : 'rotate(0deg)' }} 
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-4 mt-2 space-y-2">
                  {dropDownListItems.filter((item) => hasPermission(item.permission)).map((item) => {
                    const Icon = item.icon;
                    const isActive = location === item.path || location.startsWith(item.path + "/");
                    
                    return (
                      <Link key={item.path} href={item.path}>
                        <Button
                          variant={isActive ? "secondary" : "ghost"}
                          className="w-full justify-start text-sm"
                          data-testid={item.testId}
                        >
                          <Icon className="mr-2 h-4 w-4" />
                          {item.label}
                        </Button>
                      </Link>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            )}
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
