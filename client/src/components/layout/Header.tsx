import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import {
  LogOut,
  User,
  Settings,
  Users,
  Building2,
  UserCog,
  Home,
  Bookmark,
  ChevronDown,
  Calendar,
  FileText,
  BookOpen,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SiteSettings {
  siteName: string;
  footer: string;
}

export default function Header() {
  const { user, logout, hasPermission, masquerade, stopMasquerade } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();

  const { data: settings } = useQuery<SiteSettings>({
    queryKey: ["/api/site-settings"],
  });

  // Check ledgerStaff policy for Accounts navigation
  const { data: ledgerStaffPolicy } = useQuery<{ allowed: boolean }>({
    queryKey: ["/api/access/policies/ledgerStaff"],
    staleTime: 30000,
  });

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleStopMasquerade = async () => {
    try {
      await stopMasquerade();
      toast({
        title: "Masquerade Stopped",
        description: "You are now viewing as your original account.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to stop masquerade",
        variant: "destructive",
      });
    }
  };

  const getUserDisplayName = () => {
    if (!user) return "";
    const nameParts = [user.firstName, user.lastName].filter(Boolean);
    if (nameParts.length > 0) {
      return nameParts.join(" ");
    }
    return user.email || "User";
  };

  return (
    <header className="border-b bg-white dark:bg-gray-950 dark:border-gray-800">
      {/* Masquerade indicator banner */}
      {masquerade.isMasquerading && masquerade.originalUser && (
        <div className="bg-orange-500 text-white px-6 py-2 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <UserCog className="h-4 w-4" />
            <span>
              <strong>Masquerading as {getUserDisplayName()}</strong>
              {" • "}
              Original user:{" "}
              {[
                masquerade.originalUser.firstName,
                masquerade.originalUser.lastName,
              ]
                .filter(Boolean)
                .join(" ") || masquerade.originalUser.email}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleStopMasquerade}
            data-testid="button-stop-masquerade"
          >
            Stop Masquerade
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between h-16 px-6">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-4">
            <h1
              className="text-xl font-bold text-gray-900 dark:text-gray-100"
              data-testid="text-site-name"
            >
              {settings?.siteName || "Sirius"}
            </h1>
          </div>

          {/* Navigation Links */}
          <nav className="flex items-center space-x-4">
            <Link href="/">
              <Button
                variant={location === "/" ? "default" : "ghost"}
                size="sm"
                data-testid="nav-home"
              >
                <Home className="h-4 w-4 mr-2" />
                Home
              </Button>
            </Link>

            <Link href="/workers">
              <Button
                variant={location === "/workers" ? "default" : "ghost"}
                size="sm"
                data-testid="nav-workers"
              >
                <Users className="h-4 w-4 mr-2" />
                Workers
              </Button>
            </Link>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={location.startsWith("/employers") || location.startsWith("/employer-contacts") ? "default" : "ghost"}
                  size="sm"
                  data-testid="nav-employers"
                >
                  <Building2 className="h-4 w-4 mr-2" />
                  Employers
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem asChild>
                  <Link href="/employers" className="w-full">
                    <div className="flex items-center cursor-pointer" data-testid="menu-employers-list">
                      <Building2 className="h-4 w-4 mr-2" />
                      Employers
                    </div>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/employer-contacts/all" className="w-full">
                    <div className="flex items-center cursor-pointer" data-testid="menu-employer-contacts-all">
                      <Users className="h-4 w-4 mr-2" />
                      Employer Contacts
                    </div>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/employers/monthly-uploads" className="w-full">
                    <div className="flex items-center cursor-pointer" data-testid="menu-monthly-uploads">
                      <Calendar className="h-4 w-4 mr-2" />
                      Monthly Uploads
                    </div>
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {ledgerStaffPolicy?.allowed && (
              <Link href="/ledger/accounts">
                <Button
                  variant={location.startsWith("/ledger/accounts") ? "default" : "ghost"}
                  size="sm"
                  data-testid="nav-ledger-accounts"
                >
                  <BookOpen className="h-4 w-4 mr-2" />
                  Accounts
                </Button>
              </Link>
            )}

            {hasPermission("admin") && (
              <Link href="/reports">
                <Button
                  variant={location === "/reports" ? "default" : "ghost"}
                  size="sm"
                  data-testid="nav-reports"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Reports
                </Button>
              </Link>
            )}

            {hasPermission("admin") && (
              <Link href="/config">
                <Button
                  variant={location.startsWith("/config") ? "default" : "ghost"}
                  size="sm"
                  data-testid="nav-config"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Configuration
                </Button>
              </Link>
            )}
          </nav>
        </div>

        <div className="flex items-center space-x-4">
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" data-testid="button-user-menu">
                  <User className="h-4 w-4 mr-2" />
                  <span data-testid="text-username">{getUserDisplayName()}</span>
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(hasPermission("bookmark") || hasPermission("admin")) && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link href="/bookmarks" className="w-full">
                        <div className="flex items-center cursor-pointer" data-testid="menu-bookmarks">
                          <Bookmark className="h-4 w-4 mr-2" />
                          Bookmarks
                        </div>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={handleLogout} data-testid="menu-logout">
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
