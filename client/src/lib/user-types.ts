export interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl?: string | null;
  accountStatus?: string;
  isActive: boolean;
  createdAt?: string;
  lastLogin?: string;
  workerId?: string | null;
  /**
   * The person's own IANA time zone, or null when they have not chosen one.
   * Display only — see shared/utils/timezone.ts.
   */
  timezone?: string | null;
}
