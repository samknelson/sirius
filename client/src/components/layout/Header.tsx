import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Link, useLocation } from 'wouter';
import { LogOut, User, Settings, Users } from 'lucide-react';

export default function Header() {
  const { user, logout, hasPermission } = useAuth();
  const [location] = useLocation();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <header className="border-b bg-white dark:bg-gray-950 dark:border-gray-800">
      <div className="flex items-center justify-between h-16 px-6">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Sirius
            </h1>
            <span className="text-sm text-muted-foreground">
              Worker Management System
            </span>
          </div>

          {/* Navigation Links */}
          <nav className="flex items-center space-x-4">
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
            
            {hasPermission('admin.manage') && (
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
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              <span data-testid="text-username">{user.username}</span>
              {hasPermission('admin.manage') && (
                <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded-full">
                  Admin
                </span>
              )}
            </div>
          )}
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}