export interface User {
  id: string;
  replitUserId?: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl?: string | null;
  accountStatus?: string;
  isActive: boolean;
  createdAt?: string;
  lastLogin?: string;
  workerId?: string | null;
}
