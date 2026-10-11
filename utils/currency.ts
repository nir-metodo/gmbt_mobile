const SYMBOLS: Record<string, string> = {
  ILS: '₪',
  NIS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/** "ILS" → "₪", "USD" → "$"; already-a-symbol values pass through; empty → "₪". */
export function currencySymbol(code?: string | null): string {
  if (!code) return '₪';
  const upper = code.toUpperCase();
  if (SYMBOLS[upper]) return SYMBOLS[upper];
  return code;
}
