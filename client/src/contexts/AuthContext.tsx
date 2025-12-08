import { createContext, useContext, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  isActive: boolean;
}

interface MasqueradeInfo {
  isMasquerading: boolean;
  originalUser?: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  };
}

interface AuthContextType {
  user: User | null;
  permissions: string[];
  components: string[];
  masquerade: MasqueradeInfo;
  login: () => void;
  logout: () => void;
  stopMasquerade: () => Promise<void>;
  isLoading: boolean;
  isAuthenticated: boolean;
  authReady: boolean; // True when auth state has been definitively resolved
  hasPermission: (permission: string) => boolean;
  hasComponent: (componentId: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [components, setComponents] = useState<string[]>([]);
  const [masquerade, setMasquerade] = useState<MasqueradeInfo>({ isMasquerading: false });

  // Check if user is authenticated on app start
  const { data: authData, isLoading } = useQuery({
    queryKey: ['/api/auth/user'],
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
    queryFn: async () => {
      try {
        const response = await fetch('/api/auth/user', {
          credentials: 'include',
        });
        if (response.status === 401) {
          return null; // Not authenticated
        }
        if (!response.ok) {
          throw new Error('Failed to fetch user data');
        }
        return await response.json();
      } catch (error) {
        return null;
      }
    },
  });

  useEffect(() => {
    if (authData && (authData as any).user) {
      setUser((authData as any).user);
      setPermissions((authData as any).permissions || []);
      setComponents((authData as any).components || []);
      setMasquerade((authData as any).masquerade || { isMasquerading: false });
    } else {
      setUser(null);
      setPermissions([]);
      setComponents([]);
      setMasquerade({ isMasquerading: false });
    }
  }, [authData]);

  const login = () => {
    window.location.href = '/api/login';
  };

  const logout = () => {
    window.location.href = '/api/logout';
  };

  const stopMasquerade = async () => {
    try {
      const response = await fetch('/api/auth/masquerade/stop', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to stop masquerade');
      }
      // Refresh auth data
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    } catch (error) {
      throw error;
    }
  };

  const hasPermission = (permission: string) => {
    return permissions.includes(permission);
  };

  const hasComponent = (componentId: string) => {
    return components.includes(componentId);
  };

  const authReady = !isLoading; // Auth state is ready when loading is complete

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions,
        components,
        masquerade,
        login,
        logout,
        stopMasquerade,
        isLoading,
        isAuthenticated: !!user,
        authReady,
        hasPermission,
        hasComponent,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}