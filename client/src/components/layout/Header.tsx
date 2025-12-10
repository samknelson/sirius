import { useState } from "react";
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
  Shield,
  Menu,
  Server,
  ScanLine,
  ClipboardCheck,
  List,
  Key,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface SiteSettings {
  siteName: string;
  footer: string;
}

interface SystemModeResponse {
  mode: "dev" | "test" | "live";
}

export default function Header() {
  const { user, logout, hasPermission, hasComponent, masquerade, stopMasquerade } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: settings } = useQuery<SiteSettings>({
    queryKey: ["/api/site-settings"],
  });

  const { data: systemMode } = useQuery<SystemModeResponse>({
    queryKey: ["/api/system-mode"],
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

      <div className="flex items-center justify-between h-16 px-4 md:px-6">
        <div className="flex items-center space-x-4 md:space-x-6">
          {/* Mobile hamburger menu */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                data-testid="button-mobile-menu"
                aria-label="Open navigation menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader>
                <SheetTitle>{settings?.siteName || "Sirius"}</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col space-y-2 mt-6">
                <Link href="/" onClick={() => setMobileMenuOpen(false)}>
                  <Button
                    variant={location === "/" ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="mobile-nav-home"
                  >
                    <Home className="h-4 w-4 mr-2" />
                    Home
                  </Button>
                </Link>

                <div className="text-sm font-medium text-muted-foreground px-4 py-2">Workers</div>
                <Link href="/workers" onClick={() => setMobileMenuOpen(false)}>
                  <Button
                    variant={location === "/workers" ? "default" : "ghost"}
                    className="w-full justify-start pl-8"
                    data-testid="mobile-nav-workers-list"
                  >
                    <List className="h-4 w-4 mr-2" />
                    List
                  </Button>
                </Link>
                {hasComponent("cardcheck") && (
                  <Link href="/cardcheck-definitions" onClick={() => setMobileMenuOpen(false)}>
                    <Button
                      variant={location.startsWith("/cardcheck") ? "default" : "ghost"}
                      className="w-full justify-start pl-8"
                      data-testid="mobile-nav-cardcheck-definitions"
                    >
                      <ClipboardCheck className="h-4 w-4 mr-2" />
                      Cardchecks
                    </Button>
                  </Link>
                )}

                <Link href="/employers" onClick={() => setMobileMenuOpen(false)}>
                  <Button
                    variant={location.startsWith("/employers") ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="mobile-nav-employers"
                  >
                    <Building2 className="h-4 w-4 mr-2" />
                    Employers
                  </Button>
                </Link>

                <Link href="/employer-contacts/all" onClick={() => setMobileMenuOpen(false)}>
                  <Button
                    variant={location.startsWith("/employer-contacts") ? "default" : "ghost"}
                    className="w-full justify-start pl-8"
                    data-testid="mobile-nav-employer-contacts"
                  >
                    <Users className="h-4 w-4 mr-2" />
                    Employer Contacts
                  </Button>
                </Link>

                <Link href="/employers/monthly-uploads" onClick={() => setMobileMenuOpen(false)}>
                  <Button
                    variant={location === "/employers/monthly-uploads" ? "default" : "ghost"}
                    className="w-full justify-start pl-8"
                    data-testid="mobile-nav-monthly-uploads"
                  >
                    <Calendar className="h-4 w-4 mr-2" />
                    Monthly Uploads
                  </Button>
                </Link>

                {(hasComponent("trust.providers") || (hasPermission("admin") && hasComponent("trust.benefits.scan"))) && (
                  <>
                    <div className="text-sm font-medium text-muted-foreground px-4 py-2">Trust</div>
                    {hasComponent("trust.providers") && (
                      <Link href="/trust/providers" onClick={() => setMobileMenuOpen(false)}>
                        <Button
                          variant={location.startsWith("/trust/provider") ? "default" : "ghost"}
                          className="w-full justify-start pl-8"
                          data-testid="mobile-nav-providers"
                        >
                          <Shield className="h-4 w-4 mr-2" />
                          Providers
                        </Button>
                      </Link>
                    )}
                  </>
                )}
                {hasPermission("admin") && hasComponent("trust.benefits.scan") && (
                  <Link href="/admin/wmb-scan-queue" onClick={() => setMobileMenuOpen(false)}>
                    <Button
                      variant={location === "/admin/wmb-scan-queue" ? "default" : "ghost"}
                      className="w-full justify-start pl-8"
                      data-testid="mobile-nav-benefit-scan"
                    >
                      <ScanLine className="h-4 w-4 mr-2" />
                      Benefit Scan
                    </Button>
                  </Link>
                )}

                {ledgerStaffPolicy?.allowed && (
                  <Link href="/ledger/accounts" onClick={() => setMobileMenuOpen(false)}>
                    <Button
                      variant={location.startsWith("/ledger/accounts") ? "default" : "ghost"}
                      className="w-full justify-start"
                      data-testid="mobile-nav-accounts"
                    >
                      <BookOpen className="h-4 w-4 mr-2" />
                      Accounts
                    </Button>
                  </Link>
                )}

                {hasPermission("admin") && (
                  <>
                    <div className="text-sm font-medium text-muted-foreground px-4 py-2">Users</div>
                    <Link href="/config/users/list" onClick={() => setMobileMenuOpen(false)}>
                      <Button
                        variant={location === "/config/users/list" ? "default" : "ghost"}
                        className="w-full justify-start pl-8"
                        data-testid="mobile-nav-users-list"
                      >
                        <Users className="h-4 w-4 mr-2" />
                        Users
                      </Button>
                    </Link>
                    <Link href="/config/users/roles" onClick={() => setMobileMenuOpen(false)}>
                      <Button
                        variant={location === "/config/users/roles" ? "default" : "ghost"}
                        className="w-full justify-start pl-8"
                        data-testid="mobile-nav-users-roles"
                      >
                        <Shield className="h-4 w-4 mr-2" />
                        Roles
                      </Button>
                    </Link>
                    <Link href="/config/users/permissions" onClick={() => setMobileMenuOpen(false)}>
                      <Button
                        variant={location === "/config/users/permissions" ? "default" : "ghost"}
                        className="w-full justify-start pl-8"
                        data-testid="mobile-nav-users-permissions"
                      >
                        <Key className="h-4 w-4 mr-2" />
                        Permissions
                      </Button>
                    </Link>
                    <Link href="/config/users/policies" onClick={() => setMobileMenuOpen(false)}>
                      <Button
                        variant={location === "/config/users/policies" ? "default" : "ghost"}
                        className="w-full justify-start pl-8"
                        data-testid="mobile-nav-users-policies"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Policies
                      </Button>
                    </Link>
                    <Link href="/config/masquerade" onClick={() => setMobileMenuOpen(false)}>
                      <Button
                        variant={location === "/config/masquerade" ? "default" : "ghost"}
                        className="w-full justify-start pl-8"
                        data-testid="mobile-nav-users-masquerade"
                      >
                        <UserCog className="h-4 w-4 mr-2" />
                        Masquerade
                      </Button>
                    </Link>
                  </>
                )}

                {hasPermission("admin") && (
                  <Link href="/reports" onClick={() => setMobileMenuOpen(false)}>
                    <Button
                      variant={location === "/reports" ? "default" : "ghost"}
                      className="w-full justify-start"
                      data-testid="mobile-nav-reports"
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Reports
                    </Button>
                  </Link>
                )}

                {hasPermission("admin") && (
                  <Link href="/config" onClick={() => setMobileMenuOpen(false)}>
                    <Button
                      variant={location.startsWith("/config") ? "default" : "ghost"}
                      className="w-full justify-start"
                      data-testid="mobile-nav-config"
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Configuration
                    </Button>
                  </Link>
                )}
              </nav>
            </SheetContent>
          </Sheet>

          <div className="flex items-center gap-3">
            <h1
              className="text-lg md:text-xl font-bold text-gray-900 dark:text-gray-100"
              data-testid="text-site-name"
            >
              {settings?.siteName || "Sirius"}
            </h1>
            {systemMode?.mode && systemMode.mode !== "live" && (
              <Badge
                variant="secondary"
                className={`text-xs uppercase font-medium ${
                  systemMode.mode === "dev"
                    ? "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                    : "bg-yellow-200 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200"
                }`}
                data-testid="badge-system-mode"
              >
                <Server className="h-3 w-3 mr-1" />
                {systemMode.mode}
              </Badge>
            )}
          </div>

          {/* Desktop Navigation Links - hidden on mobile */}
          <nav className="hidden md:flex items-center space-x-4">
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={location === "/workers" || location.startsWith("/cardcheck") ? "default" : "ghost"}
                  size="sm"
                  data-testid="nav-workers"
                >
                  <Users className="h-4 w-4 mr-2" />
                  Workers
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem asChild>
                  <Link href="/workers" className="w-full">
                    <div className="flex items-center cursor-pointer" data-testid="menu-workers-list">
                      <List className="h-4 w-4 mr-2" />
                      List
                    </div>
                  </Link>
                </DropdownMenuItem>
                {hasComponent("cardcheck") && (
                  <DropdownMenuItem asChild>
                    <Link href="/cardcheck-definitions" className="w-full">
                      <div className="flex items-center cursor-pointer" data-testid="menu-cardcheck-definitions">
                        <ClipboardCheck className="h-4 w-4 mr-2" />
                        Cardchecks
                      </div>
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

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

            {(hasComponent("trust.providers") || (hasPermission("admin") && hasComponent("trust.benefits.scan"))) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={location.startsWith("/trust/") || location === "/admin/wmb-scan-queue" ? "default" : "ghost"}
                    size="sm"
                    data-testid="nav-trust"
                  >
                    <Shield className="h-4 w-4 mr-2" />
                    Trust
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {hasComponent("trust.providers") && (
                    <DropdownMenuItem asChild>
                      <Link href="/trust/providers" className="w-full">
                        <div className="flex items-center cursor-pointer" data-testid="menu-trust-providers">
                          <Shield className="h-4 w-4 mr-2" />
                          Providers
                        </div>
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {hasPermission("admin") && hasComponent("trust.benefits.scan") && (
                    <DropdownMenuItem asChild>
                      <Link href="/admin/wmb-scan-queue" className="w-full">
                        <div className="flex items-center cursor-pointer" data-testid="menu-benefit-scan">
                          <ScanLine className="h-4 w-4 mr-2" />
                          Benefit Scan
                        </div>
                      </Link>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={location.startsWith("/config/users") || location === "/config/masquerade" ? "default" : "ghost"}
                    size="sm"
                    data-testid="nav-users"
                  >
                    <UserCog className="h-4 w-4 mr-2" />
                    Users
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem asChild>
                    <Link href="/config/users/list" className="w-full">
                      <div className="flex items-center cursor-pointer" data-testid="menu-users-list">
                        <Users className="h-4 w-4 mr-2" />
                        Users
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/config/users/roles" className="w-full">
                      <div className="flex items-center cursor-pointer" data-testid="menu-users-roles">
                        <Shield className="h-4 w-4 mr-2" />
                        Roles
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/config/users/permissions" className="w-full">
                      <div className="flex items-center cursor-pointer" data-testid="menu-users-permissions">
                        <Key className="h-4 w-4 mr-2" />
                        Permissions
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/config/users/policies" className="w-full">
                      <div className="flex items-center cursor-pointer" data-testid="menu-users-policies">
                        <FileText className="h-4 w-4 mr-2" />
                        Policies
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/config/masquerade" className="w-full">
                      <div className="flex items-center cursor-pointer" data-testid="menu-users-masquerade">
                        <UserCog className="h-4 w-4 mr-2" />
                        Masquerade
                      </div>
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
