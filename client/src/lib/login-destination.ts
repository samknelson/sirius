// One per-tab handoff for every sign-in mechanism. Never store query strings.
const STORAGE_KEY = 'redirectAfterLogin';
let pending: string | null | undefined;

export function validateLoginDestination(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value === '/' ||
      /[\\?#\s\u0000-\u001f\u007f-\u009f]/u.test(value) || value.includes('//')) return null;
  try {
    // Decode each segment solely for validation, not for navigation. Reject
    // double encoding, encoded delimiters and dot-segment normalization.
    const segments = value.slice(1).split('/').map(segment => decodeURIComponent(segment));
    if (segments.some(segment => segment === '.' || segment === '..' ||
        /[/\\?#%\s\u0000-\u001f\u007f-\u009f]/u.test(segment))) return null;
    const first = segments[0].toLowerCase();
    if (new Set([
      'api', 'auth', 'login', 'logout', 'auth-error', 'unauthorized',
      'register', 'verify-worker', 'bootstrap', 'sign-in', 'sign-out',
      'sign-up', 'callback', 'oauth', 'saml',
    ]).has(first)) return null;
    // Reject values the browser would silently rewrite.
    if (new URL(value, 'https://application.invalid').pathname !== value) return null;
    return value;
  } catch {
    return null;
  }
}

export function getLoginDestination(): string | null {
  if (pending === undefined) {
    try {
      pending = validateLoginDestination(window.sessionStorage.getItem(STORAGE_KEY));
    } catch {
      pending = null;
    }
  }
  return pending;
}

function saveLoginDestination(value: string | null): void {
  pending = value;
  try {
    if (value) window.sessionStorage.setItem(STORAGE_KEY, value);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same-document login still works when per-tab storage is unavailable.
  }
}

export function clearLoginDestination(): void {
  saveLoginDestination(null);
}

/** An explicit parameter, even empty/invalid/duplicated, replaces older state. */
export function applyLoginDestinationQuery(search: string): void {
  const params = new URLSearchParams(search);
  if (params.has('destination')) {
    const values = params.getAll('destination');
    saveLoginDestination(values.length === 1 ? validateLoginDestination(values[0]) : null);
  }
}

export function consumeLoginDestination(): string {
  const destination = getLoginDestination();
  clearLoginDestination();
  return destination ?? '/dashboard';
}

export function buildLoginUrl(destination: string | null): string {
  const safe = validateLoginDestination(destination);
  return safe ? `/login?destination=${encodeURIComponent(safe)}` : '/login';
}

export function captureLoginDestination(pathname: string): string {
  // Provider landings must not replace the interrupted page.
  const existing = getLoginDestination();
  const destination = existing && (pathname === '/' || pathname === '/dashboard')
    ? existing
    : validateLoginDestination(pathname);
  saveLoginDestination(destination);
  return buildLoginUrl(destination);
}
