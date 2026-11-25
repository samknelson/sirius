import { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, createElement, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { User } from '@/lib/user-types';
import {
  DEFAULT_TIMEZONE_POLICY,
  resolveEffectiveTimeZone,
} from '@shared/utils/timezone';
import { getBrowserTimeZone, setDisplayTimeZone } from '@/lib/display-timezone';
import { fetchAuthUser } from '@/lib/auth-user';
import { clearSamlAttempt } from '@/lib/saml-attempt';

let _clerkSignOut: ((opts?: { redirectUrl?: string }) => Promise<void>) | null = null;
export function registerClerkSignOut(fn: typeof _clerkSignOut) {
  _clerkSignOut = fn;
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

/**
 * The two facts published by the server that decide which zone this person
 * sees dates in. The third input — the browser's own zone — is read locally.
 */
interface TimeZoneInfo {
  /** The zone the server runs in: what every stored timestamp actually means. */
  systemTimeZone: string;
  /** This person's own recorded zone, or null when they have not chosen one. */
  userTimeZone: string | null;
  /** Whether site policy honours a personal zone at all. */
  allowUserTimezones: boolean;
}

interface AuthContextType {
  user: User | null;
  permissions: string[];
  components: string[];
  masquerade: MasqueradeInfo;
  /** Raw inputs, as published by the server. */
  timezone: TimeZoneInfo;
  /**
   * The zone dates should be displayed in, already resolved. Read this rather
   * than re-deciding from the parts — the resolution rule lives in exactly one
   * place (resolveEffectiveTimeZone) so the server and client cannot disagree.
   */
  displayTimeZone: string;
  login: () => void;
  logout: () => void;
  stopMasquerade: () => Promise<void>;
  isLoading: boolean;
  isAuthenticated: boolean;
  authReady: boolean; // True when auth state has been definitively resolved
  authError: boolean;
  retryAuth: () => void;
  isCheckingAuth: boolean;
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
  // A placeholder for the window before /api/auth/user answers, which no dated
  // screen is rendered in: the router holds a loading screen until auth
  // resolves, and the surfaces that paint outside it (sign-in, bootstrap) show
  // no dates. It exists so the resolver always has coherent input, not because
  // anything is displayed from it.
  //
  // The browser's own zone stands in for the site's because the client cannot
  // know the real one until the server sends it, and of the wrong answers
  // available it is the one that would look least wrong if it ever did surface.
  // Note this is NOT the permissive default returning by the back door — with
  // personal zones off the resolver reads systemTimeZone, and this seeds
  // systemTimeZone; a stored personal zone is still ignored.
  const [timezone, setTimezone] = useState<TimeZoneInfo>(() => ({
    systemTimeZone: getBrowserTimeZone(),
    userTimeZone: null,
    allowUserTimezones: DEFAULT_TIMEZONE_POLICY.allowUserTimezones,
  }));

  // Check if user is authenticated on app start
  const { data: authData, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['/api/auth/user'],
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
    queryFn: fetchAuthUser,
  });

  useEffect(() => {
    if (authData === undefined) return;
    if (authData && (authData as any).user) {
      clearSamlAttempt();
      setUser((authData as any).user);
      setPermissions((authData as any).permissions || []);
      setComponents((authData as any).components || []);
      setMasquerade((authData as any).masquerade || { isMasquerading: false });
      const tz = (authData as any).timezone;
      if (tz) setTimezone(tz as TimeZoneInfo);
    } else {
      setUser(null);
      setPermissions([]);
      setComponents([]);
      setMasquerade({ isMasquerading: false });
      setTimezone({
        systemTimeZone: getBrowserTimeZone(),
        userTimeZone: null,
        allowUserTimezones: DEFAULT_TIMEZONE_POLICY.allowUserTimezones,
      });
    }
  }, [authData]);

  const login = () => {
    window.location.href = '/api/login';
  };

  const logout = useCallback(async () => {
    window.dispatchEvent(new Event("auth:session-ended"));
    if (_clerkSignOut) {
      await _clerkSignOut({ redirectUrl: '/api/logout' });
    } else {
      window.location.href = '/api/logout';
    }
  }, []);

  const stopMasquerade = async () => {
    try {
      const response = await fetch('/api/auth/masquerade/stop', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to stop masquerade');
      }
      await queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/access/policies/staff'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/my-employers'] });
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && (
          key.includes('/api/users/') && key.includes('/roles') ||
          key.includes('/api/access/')
        );
      }});
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

  // Wait for state synchronization too: the query can settle one render before
  // its effect, otherwise the login guard briefly sees a signed-out user.
  const authReady = !isLoading && !isError && authData !== undefined &&
    (authData === null ? user === null : user?.id === authData.user.id);

  const displayTimeZone = resolveEffectiveTimeZone({
    systemTimeZone: timezone.systemTimeZone,
    userTimeZone: timezone.userTimeZone,
    allowUserTimezones: timezone.allowUserTimezones,
    // The browser's real zone, captured before the formatters were redirected.
    // Asking the runtime here would hand back the zone we ourselves installed,
    // so clearing a personal zone would never fall back to where you are.
    runtimeTimeZone: getBrowserTimeZone(),
  });

  // Formatting reads the zone at call time, so it has to be in place BEFORE the
  // subtree below renders — hence during render rather than in an effect, which
  // would land after the first paint. Idempotent: a repeat render of the same
  // zone changes nothing.
  setDisplayTimeZone(displayTimeZone);

  // And again once this render is actually COMMITTED. A render can be thrown
  // away — Strict Mode's double invocation, an interrupted concurrent render —
  // and the line above would have left the module pointing at a zone nothing
  // on screen is using. Layout timing, so it lands before the browser paints.
  useLayoutEffect(() => {
    setDisplayTimeZone(displayTimeZone);
  }, [displayTimeZone]);

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions,
        components,
        masquerade,
        timezone,
        displayTimeZone,
        login,
        logout,
        stopMasquerade,
        isLoading,
        isAuthenticated: !!user,
        authReady,
        authError: isError,
        retryAuth: () => { void refetch(); },
        isCheckingAuth: isFetching,
        hasPermission,
        hasComponent,
      }}
    >
      {/*
        Keyed on the display zone so that changing it actually repaints. Every
        formatter reads the zone at call time, so without this the screen would
        keep whatever it rendered until something else happened to re-render it.
        Remounting is heavy-handed, but the zone changes at most once per
        session — on the settings page, or once at login for someone whose
        chosen zone differs from their browser's.

        Built with createElement rather than written as `<Fragment key=…>`
        because the dev tooling decorates JSX elements with a metadata prop,
        and a Fragment accepts only `key` and `children`.
      */}
      {createElement(Fragment, { key: displayTimeZone }, children)}
    </AuthContext.Provider>
  );
}