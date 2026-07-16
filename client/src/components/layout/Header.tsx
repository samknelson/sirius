import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTerm } from "@/contexts/TerminologyContext";
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
  ChevronRight,
  Calendar,
  FileText,
  BookOpen,
  Shield,
  Menu,
  Server,
  ScanLine,
  ClipboardCheck,
  FileCheck,
  List,
  Key,
  Clock,
  Droplets,
  FileWarning,
  Map,
  Upload,
  Briefcase,
  QrCode,
  FileSpreadsheet,
  Landmark,
  Megaphone,
  Layers,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { AlertsBell } from "./AlertsBell";
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
import { useSiteSettings, useSystemMode } from "@/lib/use-variable";
import type { ResolvedMenu, ResolvedMenuItem } from "@shared/menu-types";

/** Map server-provided icon names to lucide components. */
const ICON_MAP: Record<string, LucideIcon> = {
  Home,
  User,
  Users,
  UserCog,
  Building2,
  Briefcase,
  QrCode,
  Settings,
  Calendar,
  FileText,
  BookOpen,
  Shield,
  ScanLine,
  ClipboardCheck,
  FileCheck,
  List,
  Key,
  Clock,
  Droplets,
  FileWarning,
  Map,
  Upload,
  FileSpreadsheet,
  Landmark,
  Megaphone,
  Layers,
  Stethoscope,
};

function getIcon(name: string): LucideIcon {
  return ICON_MAP[name] || FileText;
}

function isItemActive(item: ResolvedMenuItem, location: string): boolean {
  if (item.active) {
    switch (item.active.type) {
      case "exact":
        return location === item.active.value;
      case "prefix":
        return location.startsWith(item.active.value);
      case "includes":
        return location.includes(item.active.value);
    }
  }
  if (item.href) return location === item.href;
  if (item.children) return item.children.some((c) => isItemActive(c, location));
  return false;
}

export default function Header() {
  const { user, logout, hasPermission, masquerade, stopMasquerade } = useAuth();
  const term = useTerm();
  const [location] = useLocation();
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState<Record<string, boolean>>({});

  const settings = useSiteSettings();
  const systemMode = useSystemMode();

  // Server-resolved main navigation (selected menu plugin, per-user gated)
  const { data: menu } = useQuery<ResolvedMenu>({
    queryKey: ["/api/menu"],
    enabled: !!user,
    staleTime: 30000,
  });
  const menuItems = menu?.items ?? [];

  const itemLabel = (item: ResolvedMenuItem): string => {
    if (item.labelTerm) {
      return term(item.labelTerm.key, { plural: item.labelTerm.plural });
    }
    return item.label || item.id;
  };

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

  const renderDesktopLeaf = (item: ResolvedMenuItem) => {
    const Icon = getIcon(item.icon);
    return (
      <Link key={item.id} href={item.href!}>
        <Button
          variant={isItemActive(item, location) ? "default" : "ghost"}
          size="sm"
          data-testid={item.testId || `nav-${item.id}`}
        >
          <Icon className="h-4 w-4 mr-2" />
          {itemLabel(item)}
        </Button>
      </Link>
    );
  };

  const renderDesktopDropdown = (item: ResolvedMenuItem) => {
    const Icon = getIcon(item.icon);
    return (
      <DropdownMenu key={item.id}>
        <DropdownMenuTrigger asChild>
          <Button
            variant={isItemActive(item, location) ? "default" : "ghost"}
            size="sm"
            data-testid={item.testId || `nav-${item.id}`}
          >
            <Icon className="h-4 w-4 mr-2" />
            {itemLabel(item)}
            <ChevronDown className="h-4 w-4 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {item.children!.map((child) => {
            const ChildIcon = getIcon(child.icon);
            return (
              <div key={child.id}>
                {child.separatorBefore && <DropdownMenuSeparator />}
                <DropdownMenuItem asChild>
                  <Link href={child.href || "#"} className="w-full">
                    <div
                      className="flex items-center cursor-pointer"
                      data-testid={child.testId || `menu-${child.id}`}
                    >
                      <ChildIcon className="h-4 w-4 mr-2" />
                      {itemLabel(child)}
                    </div>
                  </Link>
                </DropdownMenuItem>
              </div>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const renderMobileLeaf = (item: ResolvedMenuItem, indent = false) => {
    const Icon = getIcon(item.icon);
    return (
      <Link key={item.id} href={item.href!} onClick={() => setMobileMenuOpen(false)}>
        <Button
          variant={isItemActive(item, location) ? "default" : "ghost"}
          className={`w-full justify-start ${indent ? "pl-10 text-sm" : ""}`}
          data-testid={`mobile-${item.testId || `nav-${item.id}`}`}
        >
          <Icon className="h-4 w-4 mr-2" />
          {itemLabel(item)}
        </Button>
      </Link>
    );
  };

  const renderMobileSection = (item: ResolvedMenuItem) => {
    const Icon = getIcon(item.icon);
    const expanded = !!mobileExpanded[item.id];
    return (
      <div key={item.id}>
        <div className="border-t border-gray-100 dark:border-gray-800 my-2" />
        <button
          onClick={() => setMobileExpanded((s) => ({ ...s, [item.id]: !s[item.id] }))}
          className="flex items-center w-full px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          data-testid={`mobile-nav-section-${item.id}`}
          aria-expanded={expanded}
          aria-controls={`mobile-section-${item.id}`}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 mr-2" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 mr-2" />
          )}
          <Icon className="h-4 w-4 mr-2" />
          {itemLabel(item)}
        </button>
        {expanded && (
          <div className="space-y-1" id={`mobile-section-${item.id}`}>
            {item.children!.map((child) => renderMobileLeaf(child, true))}
          </div>
        )}
      </div>
    );
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

      {/* Row 1: Site name, system mode, and user menu */}
      <div className="flex items-center justify-between h-12 px-4 md:px-6 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-3">
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
            <SheetContent side="left" className="w-72 flex flex-col overflow-hidden p-0">
              <SheetHeader className="px-6 pt-6 pb-2">
                <SheetTitle>{settings?.siteName || "Sirius"}</SheetTitle>
              </SheetHeader>
              <nav
                className="flex-1 overflow-y-auto px-4 pb-6 space-y-1"
                data-testid="mobile-nav-scroll"
              >
                {menuItems.map((item) =>
                  item.children && item.children.length > 0
                    ? renderMobileSection(item)
                    : item.href
                      ? renderMobileLeaf(item)
                      : null,
                )}
              </nav>
            </SheetContent>
          </Sheet>

          <h1
            className="text-lg md:text-xl font-bold text-gray-900 dark:text-gray-100"
            data-testid="text-site-name"
          >
            {settings?.siteName || "Sirius"}
          </h1>
          {!systemMode.isLoading && systemMode.mode !== "live" && (
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

        {/* User menu - right side of row 1 */}
        <div className="flex items-center gap-2">
          {user && <AlertsBell />}
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

      {/* Row 2: Desktop Navigation Links - hidden on mobile */}
      <nav className="hidden md:flex items-center space-x-4 h-10 px-4 md:px-6 overflow-x-auto">
        {menuItems.map((item) =>
          item.children && item.children.length > 0
            ? renderDesktopDropdown(item)
            : item.href
              ? renderDesktopLeaf(item)
              : null,
        )}
      </nav>
    </header>
  );
}
