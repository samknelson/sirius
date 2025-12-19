export interface CurrencyDefinition {
  code: string;
  label: string;
  precision: number;
  symbol?: string;
  symbolPosition?: 'prefix' | 'suffix';
  format(amount: number): string;
  parse(input: string): number | null;
  quantize(amount: number): number;
}

const currencyRegistry = new Map<string, CurrencyDefinition>();

export function registerCurrency(currency: CurrencyDefinition): void {
  if (currencyRegistry.has(currency.code)) {
    console.warn(`Currency "${currency.code}" is already registered. Overwriting.`);
  }
  currencyRegistry.set(currency.code, currency);
}

export function getCurrency(code: string): CurrencyDefinition | undefined {
  return currencyRegistry.get(code);
}

export function getAllCurrencies(): CurrencyDefinition[] {
  return Array.from(currencyRegistry.values());
}

export function hasCurrency(code: string): boolean {
  return currencyRegistry.has(code);
}

export function formatAmount(amount: number, currencyCode: string): string {
  const currency = getCurrency(currencyCode);
  if (!currency) {
    return amount.toFixed(2);
  }
  return currency.format(amount);
}

export function parseAmount(input: string, currencyCode: string): number | null {
  const currency = getCurrency(currencyCode);
  if (!currency) {
    const parsed = parseFloat(input.replace(/[^0-9.-]/g, ''));
    return isNaN(parsed) ? null : parsed;
  }
  return currency.parse(input);
}

export function quantizeAmount(amount: number, currencyCode: string): number {
  const currency = getCurrency(currencyCode);
  if (!currency) {
    return Math.round(amount * 100) / 100;
  }
  return currency.quantize(amount);
}

export function createBaseCurrency(config: {
  code: string;
  label: string;
  precision: number;
  symbol?: string;
  symbolPosition?: 'prefix' | 'suffix';
}): CurrencyDefinition {
  const { code, label, precision, symbol, symbolPosition = 'prefix' } = config;
  const multiplier = Math.pow(10, precision);

  return {
    code,
    label,
    precision,
    symbol,
    symbolPosition,

    format(amount: number): string {
      const quantized = this.quantize(amount);
      const formatted = precision === 0 
        ? Math.round(quantized).toString()
        : quantized.toFixed(precision);
      
      if (symbol) {
        return symbolPosition === 'prefix' 
          ? `${symbol}${formatted}`
          : `${formatted} ${symbol}`;
      }
      return formatted;
    },

    parse(input: string): number | null {
      let cleaned = input.trim();
      if (symbol) {
        cleaned = cleaned.replace(symbol, '').trim();
      }
      cleaned = cleaned.replace(/[^0-9.-]/g, '');
      const parsed = parseFloat(cleaned);
      if (isNaN(parsed)) {
        return null;
      }
      return this.quantize(parsed);
    },

    quantize(amount: number): number {
      return Math.round(amount * multiplier) / multiplier;
    },
  };
}

export const USD = createBaseCurrency({
  code: 'USD',
  label: 'U.S. Dollars',
  precision: 2,
  symbol: '$',
  symbolPosition: 'prefix',
});

export const POINTS = createBaseCurrency({
  code: 'POINTS',
  label: 'Points',
  precision: 0,
  symbol: 'points',
  symbolPosition: 'suffix',
});

export const SHARES = createBaseCurrency({
  code: 'SHARES',
  label: 'Shares',
  precision: 4,
  symbol: 'shares',
  symbolPosition: 'suffix',
});

registerCurrency(USD);
registerCurrency(POINTS);
registerCurrency(SHARES);
