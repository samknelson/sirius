export interface FloodContext {
  userId?: string;
  ip?: string;
  [key: string]: any;
}

export interface FloodEventDefinition {
  name: string;
  threshold: number;
  windowSeconds: number;
  getIdentifier: (context: FloodContext) => string;
}

export interface FloodCheckResult {
  allowed: boolean;
  count: number;
  threshold: number;
  windowSeconds: number;
  identifier: string;
}
