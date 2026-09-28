export interface T631ArrivalResponse {
  authenticated: boolean;
  message: string;
  accessUuid?: string;
}

/** Reject anything except a worker schedule URL with a canonical access key. */
export function scheduleDestination(result: T631ArrivalResponse): string | null {
  const key = result.accessUuid;
  return result.authenticated && typeof key === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key)
    ? `/edls-sched/${key}`
    : null;
}

interface T631ArrivalCredentials {
  workerId: string;
  token: string;
}

declare global {
  interface Window {
    __t631ArrivalCredentials?: T631ArrivalCredentials;
  }
}

let pendingArrivalRequest: Promise<T631ArrivalResponse> | undefined;

function missingInputs(): T631ArrivalResponse {
  return {
    authenticated: false,
    message: "A worker ID and token are required.",
  };
}

/**
 * Dispatch the credential-bearing request before React mounts. The initial
 * document has already removed the token from the URL; this takes it out of
 * `window` too, and keeps only the non-sensitive result promise for the route.
 */
export function initializeT631ArrivalRequest(): void {
  if (
    pendingArrivalRequest ||
    window.location.pathname !== "/sitespecific/t631/arrive"
  ) {
    return;
  }

  const credentials = window.__t631ArrivalCredentials;
  delete window.__t631ArrivalCredentials;

  if (
    !credentials ||
    !credentials.workerId.trim() ||
    !credentials.token.trim()
  ) {
    pendingArrivalRequest = Promise.resolve(missingInputs());
    return;
  }

  const workerId = credentials.workerId;
  pendingArrivalRequest = fetch("/api/public/sitespecific/t631/arrive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    body: JSON.stringify({
      worker_id: workerId,
      token: credentials.token,
    }),
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Arrival request failed with status ${response.status}`);
      }
      return (await response.json()) as T631ArrivalResponse;
    })
    .catch(() => ({
      authenticated: false,
      message: `Authentication failed for worker [${workerId}].`,
    }));
}

export function takeT631ArrivalRequest(): Promise<T631ArrivalResponse> {
  initializeT631ArrivalRequest();
  const request =
    pendingArrivalRequest ?? Promise.resolve(missingInputs());
  pendingArrivalRequest = undefined;
  return request;
}