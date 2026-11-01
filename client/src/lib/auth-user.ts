import { z } from "zod";

// Reject HTML fallbacks, malformed JSON and incomplete "success" envelopes.
const authUserResponse = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    isActive: z.boolean(),
  }).passthrough(),
  permissions: z.array(z.string()),
  components: z.array(z.string()),
  masquerade: z.object({ isMasquerading: z.boolean() }).passthrough(),
  timezone: z.object({
    systemTimeZone: z.string(),
    userTimeZone: z.string().nullable(),
    allowUserTimezones: z.boolean(),
  }),
});

export async function fetchAuthUser({ signal }: { signal?: AbortSignal } = {}) {
  const response = await fetch("/api/auth/user", { credentials: "include", signal, cache: "no-store" });
  if (response.status === 401) return null;
  if (response.status === 403) {
    const body = await response.json().catch(() => null);
    // Clerk resolves its local account during the existing current-user request.
    // Accept only our fixed refusal surface, never an arbitrary redirect.
    if (typeof body?.authErrorUrl === "string" &&
        /^\/auth-error\?error=access_denied&ref=CLERK-[A-Z0-9-]{1,24}(?:&category=inactive_account)?$/.test(body.authErrorUrl)) {
      const path = window.location.pathname;
      // An unlinked Clerk identity is expected during worker registration.
      // Keep sign-in reachable too so the user can sign out or register.
      const enrolling = (path === "/register" || path === "/login") &&
        !body.authErrorUrl.endsWith("&category=inactive_account");
      if (path !== "/auth-error" && !enrolling) window.location.assign(body.authErrorUrl);
      return null;
    }
  }
  if (!response.ok) throw new Error("Unable to check your sign-in. Please try again.");
  return authUserResponse.parse(await response.json());
}
