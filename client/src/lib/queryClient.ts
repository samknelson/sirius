import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Custom error class that preserves HTTP response details
 */
export class ApiError extends Error {
  status: number;
  data: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const serverMessage = error.data?.error || error.data?.message;
    if (typeof serverMessage === "string" && serverMessage.trim()) {
      return serverMessage;
    }
    if (error.message) {
      return error.message.replace(/^\d{3}:\s*/, "") || fallback;
    }
    return fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

/**
 * Extract the per-problem detail lines an API rejection carries in
 * `{ message, errors: string[] }` (e.g. the plugin config save routes, whose
 * `errors` name the unsupported medium / bad template token / schema
 * violation). Returns an empty array for any other error shape — callers fall
 * back to the top-level message, which now summarizes the first problem.
 */
export function getApiErrorDetails(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  const errors = error.data?.errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .map((e: unknown) => (typeof e === "string" ? e.trim() : ""))
    .filter((e): e is string => e.length > 0);
}

export interface EligibilityFailure {
  pluginName: string;
  explanation: string;
}

/**
 * Extract structured eligibility failures from a 403 dispatch create/accept
 * rejection (`{ message, eligibilityFailures: [{ pluginName, explanation }] }`).
 * Returns an empty array for any other error shape.
 */
export function getEligibilityFailures(error: unknown): EligibilityFailure[] {
  if (!(error instanceof ApiError)) return [];
  const failures = error.data?.eligibilityFailures;
  if (!Array.isArray(failures)) return [];
  return failures.filter(
    (f: any): f is EligibilityFailure =>
      f && typeof f.pluginName === "string" && typeof f.explanation === "string",
  );
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let data: any = null;
    let message = res.statusText;
    
    try {
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
        message = data.message || data.error || res.statusText;
      } else {
        message = (await res.text()) || res.statusText;
      }
    } catch {
      // If parsing fails, use status text
    }
    
    throw new ApiError(res.status, `${res.status}: ${message}`, data);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { headers?: Record<string, string> },
): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(options?.headers ?? {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  
  // Parse JSON if the response has content
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined;
  }
  
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await res.json();
  }
  
  if (contentType && contentType.includes('text/html')) {
    throw new ApiError(502, 'Server returned an unexpected response. Please try again.');
  }

  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

export function serializeQueryKey(queryKey: readonly unknown[]): string {
  if (queryKey.length === 1) {
    return queryKey[0] as string;
  }
  
  if (queryKey.length === 2 && typeof queryKey[1] === 'object' && queryKey[1] !== null) {
    const [basePath, params] = queryKey as [string, Record<string, unknown>];
    const filteredParams = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
    
    if (filteredParams.length === 0) {
      return basePath;
    }
    
    const searchParams = new URLSearchParams();
    filteredParams.forEach(([key, value]) => {
      searchParams.append(key, String(value));
    });
    
    return `${basePath}?${searchParams.toString()}`;
  }
  
  return queryKey.join("/") as string;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = serializeQueryKey(queryKey);
    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      throw new ApiError(502, 'Server returned an unexpected response. Please try again.');
    }
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
