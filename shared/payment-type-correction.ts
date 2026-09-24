export interface PaymentTypeCorrectionEntry {
  id: string;
  amount: string;
  proposedAmount: string;
  eaId: string;
  key: string;
  plugin: string;
}

export interface PaymentTypeCorrectionPreview {
  paymentTypeId: string;
  paymentTypeName: string;
  currentDirection: string;
  targetDirection: "charge";
  snapshot: string;
  eligible: boolean;
  blockers: string[];
  paymentCount: number;
  entryCount: number;
  payments: Array<{
    id: string;
    amount: string;
    entries: PaymentTypeCorrectionEntry[];
    blockers: string[];
  }>;
}

export interface PaymentTypeCorrectionConfirmation {
  snapshot: string;
  confirmed: true;
}

export interface PaymentTypeCorrectionResult {
  paymentTypeId: string;
  direction: "charge";
  paymentCount: number;
  entryCount: number;
}