import { createContext, useContext, ReactNode } from "react";
import { UserCircle, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface UserDetails {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  lastLogin?: string;
}

interface UserLayoutContextValue {
  user: UserDetails;
  isLoading: boolean;
  isError: boolean;
}

const UserLayoutContext = createContext<UserLayoutContextValue | null>(null);

export function useUserLayout() {
  const context = useContext(UserLayoutContext);
  if (!context) {
    throw new Error("useUserLayout must be used within UserLayout");
  }
  return context;
}

interface UserLayoutProps {
  activeTab: "details" | "logs";
  children: ReactNode;
}

export function UserLayout({ activeTab, children }: UserLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: user, isLoading: userLoading, error: userError } = useQuery<UserDetails>({
    queryKey: ["/api/admin/users", id],
    queryFn: async () => {
      const response = await fetch(`/api/admin/users/${id}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error("User not found");
      }
      return response.json();
    },
    enabled: !!id,
  });

  const isLoading = userLoading;
  const isError = !!userError;

  // Error/Not found state - check this BEFORE loading
  if (userError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <UserCircle className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">User Not Found</span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/config/users/list">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-users">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Users
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <UserCircle className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">User Not Found</h3>
              <p className="text-muted-foreground text-center">
                The user you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/config/users/list">
                <Button className="mt-4" data-testid="button-return-to-users">
                  Return to Users
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Loading state - check this AFTER error handling
  if (isLoading || !user) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <UserCircle className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/config/users/list">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-users">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Users
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Skeleton className="h-16 w-16 rounded-full mb-4" />
              <Skeleton className="h-6 w-48 mb-2" />
              <Skeleton className="h-4 w-64" />
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Success state - render layout with tabs
  const displayName = user.firstName && user.lastName
    ? `${user.firstName} ${user.lastName}`
    : user.firstName || user.lastName || user.email || user.id;

  const mainTabs = [
    { id: "details", label: "Details", href: `/users/${user.id}` },
    { id: "logs", label: "Logs", href: `/users/${user.id}/logs` },
  ];

  const contextValue: UserLayoutContextValue = {
    user,
    isLoading: false,
    isError: false,
  };

  return (
    <UserLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <UserCircle className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid={`text-user-name-${user.id}`}>
                  {displayName}
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/config/users/list">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-users">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Users
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        {/* Main Tab Navigation */}
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-3">
              {mainTabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return isActive ? (
                  <Button
                    key={tab.id}
                    variant="default"
                    size="sm"
                    data-testid={`button-user-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-user-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </UserLayoutContext.Provider>
  );
}
