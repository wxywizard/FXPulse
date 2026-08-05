export const CURRENCY_CODES = [
  "AUD",
  "CAD",
  "CHF",
  "CNY",
  "EUR",
  "GBP",
  "HKD",
  "JPY",
  "NZD",
  "SGD",
  "USD",
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface CurrencyMeta {
  code: CurrencyCode;
  name: string;
  englishName: string;
  symbol: string;
  flag: string;
  decimals: number;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  AUD: { code: "AUD", name: "澳元", englishName: "Australian Dollar", symbol: "A$", flag: "🇦🇺", decimals: 4 },
  CAD: { code: "CAD", name: "加拿大元", englishName: "Canadian Dollar", symbol: "C$", flag: "🇨🇦", decimals: 4 },
  CHF: { code: "CHF", name: "瑞士法郎", englishName: "Swiss Franc", symbol: "CHF", flag: "🇨🇭", decimals: 4 },
  CNY: { code: "CNY", name: "人民币", englishName: "Chinese Yuan", symbol: "¥", flag: "🇨🇳", decimals: 4 },
  EUR: { code: "EUR", name: "欧元", englishName: "Euro", symbol: "€", flag: "🇪🇺", decimals: 4 },
  GBP: { code: "GBP", name: "英镑", englishName: "Pound Sterling", symbol: "£", flag: "🇬🇧", decimals: 4 },
  HKD: { code: "HKD", name: "港元", englishName: "Hong Kong Dollar", symbol: "HK$", flag: "🇭🇰", decimals: 4 },
  JPY: { code: "JPY", name: "日元", englishName: "Japanese Yen", symbol: "¥", flag: "🇯🇵", decimals: 2 },
  NZD: { code: "NZD", name: "新西兰元", englishName: "New Zealand Dollar", symbol: "NZ$", flag: "🇳🇿", decimals: 4 },
  SGD: { code: "SGD", name: "新加坡元", englishName: "Singapore Dollar", symbol: "S$", flag: "🇸🇬", decimals: 4 },
  USD: { code: "USD", name: "美元", englishName: "US Dollar", symbol: "$", flag: "🇺🇸", decimals: 4 },
};

export const HISTORY_WINDOWS = [7, 15, 30, 90, 365] as const;
export type HistoryWindow = (typeof HISTORY_WINDOWS)[number];

export function isCurrencyCode(value: string | null | undefined): value is CurrencyCode {
  return CURRENCY_CODES.includes((value ?? "").toUpperCase() as CurrencyCode);
}

export function normalizeCurrency(value: string): CurrencyCode {
  return value.toUpperCase() as CurrencyCode;
}

export function isHistoryWindow(value: number): value is HistoryWindow {
  return HISTORY_WINDOWS.includes(value as HistoryWindow);
}

export function formatRate(rate: number, quote: CurrencyCode): string {
  const maximumFractionDigits = quote === "JPY" ? 3 : rate >= 100 ? 2 : rate >= 1 ? 4 : 6;
  return new Intl.NumberFormat("zh-Hans", {
    minimumFractionDigits: Math.min(2, maximumFractionDigits),
    maximumFractionDigits,
  }).format(rate);
}

export function defaultQuote(base: CurrencyCode): CurrencyCode {
  if (base !== "USD") return "USD";
  return "HKD";
}
