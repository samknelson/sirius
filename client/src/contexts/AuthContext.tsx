import { createContext, useContext, useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';

interface User {
  id: string;
  username: string;
  isActive: boolean;
}

interface AuthContextType {
  user: User | null;
  permissions: string[];
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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

  // Check if user is authenticated on app start
  const { data: authData, isLoading } = useQuery({
    queryKey: ['/api/me'],
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
    queryFn: async () => {
      try {
        const response = await fetch('/api/me', {
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
    } else {
      setUser(null);
      setPermissions([]);
    }
  }, [authData]);

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const response = await apiRequest('POST', '/api/login', { username, password });
      return await response.json();
    },
    onSuccess: (data) => {
      setUser(data.user);
      setPermissions(data.permissions || []);
      // Invalidate and refetch user data
      queryClient.invalidateQueries({ queryKey: ['/api/me'] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/logout');
      return await response.json();
    },
    onSuccess: () => {
      setUser(null);
      setPermissions([]);
      // Clear all query cache on logout
      queryClient.clear();
    },
  });

  const login = async (username: string, password: string) => {
    await loginMutation.mutateAsync({ username, password });
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  const hasPermission = (permission: string) => {
    return permissions.includes(permission);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions,
        login,
        logout,
        isLoading,
        isAuthenticated: !!user,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}