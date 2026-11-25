import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import {
  applyLoginDestinationQuery,
  captureLoginDestination,
  consumeLoginDestination,
} from '@/lib/login-destination';

/** Capture only after the caller has confirmed that the session is absent. */
export function LoginRequiredRedirect({ pathname }: { pathname: string }) {
  const [, navigate] = useLocation();
  const redirected = useRef(false);
  useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;
    navigate(captureLoginDestination(pathname), { replace: true });
  }, [pathname, navigate]);
  return null;
}

/** Login and external-provider landings share precedence and consumption. */
export function useLoginReturn(confirmed: boolean, search?: string) {
  const [, navigate] = useLocation();
  const appliedSearch = useRef<string>();
  const redirected = useRef(false);
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    // Persist before a provider can leave this document, and on query changes.
    // The ref also keeps Strict Mode's effect replay from reviving a consumed URL.
    if (search !== undefined && appliedSearch.current !== search) {
      appliedSearch.current = search;
      applyLoginDestinationQuery(search);
    }
    if (!confirmed || redirected.current) return;
    redirected.current = true;
    navigate(consumeLoginDestination(), { replace: true });
    setComplete(true);
  }, [confirmed, search, navigate]);
  return complete;
}

export function LoginReturnRedirect({ children }: { children?: ReactNode }) {
  const complete = useLoginReturn(true);
  return complete ? <>{children}</> : null;
}
