/** Formato de montos (moneda del workspace) para la interfaz. */

const LOCALE = 'es-AR';
const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, decimals: number): Intl.NumberFormat {
  const key = `${currency}:${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        maximumFractionDigits: decimals,
        minimumFractionDigits: 0,
      });
    } catch {
      f = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: decimals });
    }
    formatters.set(key, f);
  }
  return f;
}

/** `$1.450` (sin decimales salvo montos chicos con centavos). */
export function money(amount: number, currency: string): string {
  return formatter(currency, amount < 100 && !Number.isInteger(amount) ? 2 : 0).format(amount);
}

/** `$320`, `$1,4k`, `$2,1M`: para badges y gráficos. */
export function moneyCompact(amount: number, currency: string): string {
  if (amount < 1000) return money(Math.round(amount), currency);
  const symbol =
    formatter(currency, 0)
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? '';
  const [value, suffix] = amount < 1_000_000 ? [amount / 1000, 'k'] : [amount / 1_000_000, 'M'];
  const digits = new Intl.NumberFormat(LOCALE, {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
  return `${symbol}${digits}${suffix}`;
}

/** Acepta `1450`, `1.450,50` o `1450.5`. Null si no es un número válido. */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(/[^\d.,-]/g, '');
  if (!t) return null;
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
