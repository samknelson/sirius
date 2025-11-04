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
  masquerade: MasqueradeInfo;
  login: () => void;
  logout: () => void;
  stopMasquerade: () => Promise<void>;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasPermission: (permission: string) => boolean;
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
      setMasquerade((authData as any).masquerade || { isMasquerading: false });
    } else {
      setUser(null);
      setPermissions([]);
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

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions,
        masquerade,
        login,
        logout,
        stopMasquerade,
        isLoading,
        isAuthenticated: !!user,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}