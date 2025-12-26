export interface LedgerAccountBase {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface LedgerAccount extends LedgerAccountBase {
  currencyCode: string;
}

export interface LedgerAccountWithDetails extends LedgerAccount {
  data?: {
    icon?: string;
    iconColor?: string;
    invoicesEnabled?: boolean;
    invoiceHeader?: string;
    invoiceFooter?: string;
  } | null;
}

export interface LedgerNotification {
  type: "created" | "updated" | "deleted";
  amount: string;
  previousAmount?: string;
  description: string;
}
