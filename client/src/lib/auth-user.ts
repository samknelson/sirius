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
  if (!response.ok) throw new Error("Unable to check your sign-in. Please try again.");
  return authUserResponse.parse(await response.json());
}
