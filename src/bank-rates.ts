import { CURRENCY_CODES, type CurrencyCode } from "./currencies";

const YOYO_RATE_BASE_URL = "https://yoyorate.com/compare/hk/hkd-to-";
const UPSTREAM_TIMEOUT_MS = 5_000;
const ALL_SUPPORTED_CURRENCIES = CURRENCY_CODES;
const ALL_BANK_CURRENCIES = CURRENCY_CODES.filter(
  (currency): currency is Exclude<CurrencyCode, "HKD"> => currency !== "HKD",
);

export const HONG_KONG_BANKS = [
  { id: "boc", name: "中银香港", englishName: "Bank of China (Hong Kong)" },
  { id: "bocom", name: "交通银行（香港）", englishName: "Bank of Communications (Hong Kong)" },
  { id: "ccb", name: "中国建设银行（亚洲）", englishName: "China Construction Bank (Asia)" },
  { id: "chbank", name: "创兴银行", englishName: "Chong Hing Bank" },
  { id: "chiyu", name: "集友银行", englishName: "Chiyu Banking Corporation" },
  { id: "cmbwinglungbank", name: "招商永隆银行", englishName: "CMB Wing Lung Bank" },
  { id: "cncb", name: "中信银行（国际）", englishName: "China CITIC Bank International" },
  { id: "dahsing", name: "大新银行", englishName: "Dah Sing Bank" },
  { id: "dbs", name: "星展银行", englishName: "DBS Bank (Hong Kong)" },
  { id: "fubon", name: "富邦银行（香港）", englishName: "Fubon Bank (Hong Kong)" },
  { id: "hangseng", name: "恒生银行", englishName: "Hang Seng Bank" },
  { id: "hkbea", name: "东亚银行", englishName: "The Bank of East Asia" },
  { id: "hsbc", name: "汇丰银行", englishName: "HSBC Hong Kong" },
  { id: "icbc", name: "工银亚洲", englishName: "ICBC (Asia)" },
  { id: "ncb", name: "南洋商业银行", englishName: "Nanyang Commercial Bank" },
  { id: "ocbc", name: "华侨银行（香港）", englishName: "OCBC Bank (Hong Kong)" },
  { id: "publicbank", name: "大众银行（香港）", englishName: "Public Bank (Hong Kong)" },
  { id: "shacom", name: "上海商业银行", englishName: "Shanghai Commercial Bank" },
] as const;

export type HongKongBankId = (typeof HONG_KONG_BANKS)[number]["id"];

export interface BankTtLeg {
  bankId: HongKongBankId;
  currency: CurrencyCode;
  ttBuyHkd: number | null;
  ttSellHkd: number | null;
  observedAt: number;
  sourceUrl: string;
}

export interface HongKongBankQuote {
  id: HongKongBankId;
  name: string;
  englishName: string;
  status: "available" | "unavailable";
  rate: number | null;
  differenceFromMarketPct: number | null;
  observedAt: number | null;
  basis: string | null;
  source: "YoYoRate" | "HSBC Hong Kong";
  sourceUrl: string;
  reason: string | null;
  baseTtBuyHkd: number | null;
  quoteTtSellHkd: number | null;
}

export interface ArchivedHongKongBankPair {
  base: CurrencyCode;
  quote: CurrencyCode;
  bank: HongKongBankQuote;
}

const BANK_BY_ID = new Map(HONG_KONG_BANKS.map((bank) => [bank.id, bank] as const));

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function bankSourceUrl(currency: CurrencyCode): string {
  if (currency === "HKD") return "https://yoyorate.com/";
  return `${YOYO_RATE_BASE_URL}${currency.toLowerCase()}`;
}

export function parseYoYoRateTtPage(
  html: string,
  currency: CurrencyCode,
  observedAt = Math.floor(Date.now() / 1000),
): Map<HongKongBankId, BankTtLeg> {
  const result = new Map<HongKongBankId, BankTtLeg>();
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;

  for (const rowMatch of html.matchAll(rowPattern)) {
    const row = rowMatch[1] ?? "";
    const bankMatch = row.match(/href=["']\/store\/hk\/([^/"']+)\/hkd["']/i);
    if (!bankMatch) continue;
    const bankId = bankMatch[1] as HongKongBankId;
    if (!BANK_BY_ID.has(bankId)) continue;

    const values = [...row.matchAll(/data-selected-rate=["']([^"']+)["']/gi)].map(
      (match) => parsePublishedRate(match[1]),
    );
    result.set(bankId, {
      bankId,
      currency,
      ttBuyHkd: values[0] ?? null,
      ttSellHkd: values[1] ?? null,
      observedAt,
      sourceUrl: bankSourceUrl(currency),
    });
  }

  return result;
}

export async function fetchHongKongBankLegs(
  currency: CurrencyCode,
  fetcher: typeof fetch = fetch,
): Promise<Map<HongKongBankId, BankTtLeg>> {
  if (currency === "HKD") return new Map();
  const url = bankSourceUrl(currency);
  const response = await fetcher(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-HK,zh;q=0.9,en;q=0.7",
    },
    cf: { cacheEverything: true, cacheTtl: 300 },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Hong Kong bank rate source returned ${response.status}`);
  const rows = parseYoYoRateTtPage(await response.text(), currency);
  if (rows.size < 8) throw new Error(`Hong Kong bank rate source omitted ${currency}`);
  return rows;
}

export async function fetchHongKongBankPair(
  base: CurrencyCode,
  quote: CurrencyCode,
  marketRate: number,
  fetcher: typeof fetch = fetch,
): Promise<{ banks: HongKongBankQuote[]; warnings: string[] }> {
  if (base === quote) throw new Error("Base and quote must be different");
  const neededCurrencies = [...new Set([base, quote].filter((code) => code !== "HKD"))];
  const settled = await Promise.allSettled(
    neededCurrencies.map((currency) => fetchHongKongBankLegs(currency, fetcher)),
  );
  const legs = new Map<CurrencyCode, Map<HongKongBankId, BankTtLeg>>();
  const warnings: string[] = [];

  settled.forEach((result, index) => {
    const currency = neededCurrencies[index];
    if (!currency) return;
    if (result.status === "fulfilled") legs.set(currency, result.value);
    else warnings.push(`${currency} 牌价页暂时不可用`);
  });

  const banks = HONG_KONG_BANKS.map((bank) => {
    const baseLeg = base === "HKD" ? null : legs.get(base)?.get(bank.id) ?? null;
    const quoteLeg = quote === "HKD" ? null : legs.get(quote)?.get(bank.id) ?? null;
    return deriveHongKongBankPair(bank, base, quote, baseLeg, quoteLeg, marketRate);
  }).sort(compareBankQuotes);

  return { banks, warnings };
}

export async function collectHongKongBankPairs(
  fetcher: typeof fetch = fetch,
): Promise<ArchivedHongKongBankPair[]> {
  const currencies = ALL_BANK_CURRENCIES;
  const legResults = await Promise.all(
    currencies.map((currency) => fetchHongKongBankLegs(currency, fetcher)),
  );
  const legs = new Map(
    currencies.map((currency, index) => [currency, legResults[index]] as const),
  );
  const pairs: ArchivedHongKongBankPair[] = [];

  for (const base of ALL_SUPPORTED_CURRENCIES) {
    for (const quote of ALL_SUPPORTED_CURRENCIES) {
      if (base === quote) continue;
      for (const bank of HONG_KONG_BANKS) {
        const baseLeg = base === "HKD" ? null : legs.get(base)?.get(bank.id) ?? null;
        const quoteLeg = quote === "HKD" ? null : legs.get(quote)?.get(bank.id) ?? null;
        const derived = deriveHongKongBankPair(
          bank,
          base,
          quote,
          baseLeg,
          quoteLeg,
          Number.NaN,
        );
        if (derived.rate !== null) pairs.push({ base, quote, bank: derived });
      }
    }
  }
  return pairs;
}

export function deriveHongKongBankPair(
  bank: (typeof HONG_KONG_BANKS)[number],
  base: CurrencyCode,
  quote: CurrencyCode,
  baseLeg: BankTtLeg | null,
  quoteLeg: BankTtLeg | null,
  marketRate: number,
): HongKongBankQuote {
  const baseTtBuyHkd = base === "HKD" ? 1 : baseLeg?.ttBuyHkd ?? null;
  const quoteTtSellHkd = quote === "HKD" ? 1 : quoteLeg?.ttSellHkd ?? null;
  const observedAtValues = [baseLeg?.observedAt, quoteLeg?.observedAt].filter(
    (value): value is number => typeof value === "number",
  );
  const observedAt = observedAtValues.length ? Math.min(...observedAtValues) : null;
  const sourceUrl = quote === "HKD" ? bankSourceUrl(base) : bankSourceUrl(quote);

  if (!isPositiveFinite(baseTtBuyHkd) || !isPositiveFinite(quoteTtSellHkd)) {
    const missing = [
      !isPositiveFinite(baseTtBuyHkd) ? `${base} TT 买入价` : null,
      !isPositiveFinite(quoteTtSellHkd) ? `${quote} TT 卖出价` : null,
    ].filter((value): value is string => Boolean(value));
    return {
      id: bank.id,
      name: bank.name,
      englishName: bank.englishName,
      status: "unavailable",
      rate: null,
      differenceFromMarketPct: null,
      observedAt,
      basis: null,
      source: "YoYoRate",
      sourceUrl,
      reason: `缺少${missing.join("及")}`,
      baseTtBuyHkd: isPositiveFinite(baseTtBuyHkd) ? baseTtBuyHkd : null,
      quoteTtSellHkd: isPositiveFinite(quoteTtSellHkd) ? quoteTtSellHkd : null,
    };
  }

  const rate = baseTtBuyHkd / quoteTtSellHkd;
  return {
    id: bank.id,
    name: bank.name,
    englishName: bank.englishName,
    status: "available",
    rate,
    differenceFromMarketPct:
      isPositiveFinite(marketRate) ? ((rate - marketRate) / marketRate) * 100 : null,
    observedAt,
    basis: bankCalculationLabel(base, quote),
    source: "YoYoRate",
    sourceUrl,
    reason: null,
    baseTtBuyHkd,
    quoteTtSellHkd,
  };
}

export function compareBankQuotes(a: HongKongBankQuote, b: HongKongBankQuote): number {
  if (a.rate !== null && b.rate !== null) return b.rate - a.rate;
  if (a.rate !== null) return -1;
  if (b.rate !== null) return 1;
  return a.name.localeCompare(b.name, "zh-Hans");
}

function parsePublishedRate(value: string | undefined): number | null {
  const parsed = Number(value);
  return isPositiveFinite(parsed) && parsed < 1_000_000 ? parsed : null;
}

function bankCalculationLabel(base: CurrencyCode, quote: CurrencyCode): string {
  if (base === "HKD") return `1 ÷ ${quote} TT 卖出`;
  if (quote === "HKD") return `${base} TT 买入`;
  return `${base} TT 买入 ÷ ${quote} TT 卖出`;
}
