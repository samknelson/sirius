export interface Role {
  id: string;
  name: string;
  description: string | null;
  sequence?: number;
  createdAt?: string;
}

export interface Address {
  id: string;
  contactId: string;
  friendlyName: string | null;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isPrimary: boolean;
  isActive: boolean;
}

export interface PhoneNumber {
  id: string;
  contactId: string;
  friendlyName: string | null;
  phoneNumber: string;
  isPrimary: boolean;
  isActive: boolean;
}

export interface EmploymentStatus {
  id: string;
  name: string;
  code: string;
  employed?: boolean;
  description?: string | null;
  sequence?: number;
  data?: { color?: string } | null;
}
