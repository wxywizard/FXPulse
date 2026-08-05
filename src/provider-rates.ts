import { CURRENCY_CODES, isCurrencyCode, normalizeCurrency, type CurrencyCode } from "./currencies";

const WISE_RATES_ENDPOINT = "https://api.wise.com/v1/rates";

export type ProviderId = "wise" | "hsbc_deposit_plus";
export type ProviderRateType = "mid_market" | "deposit_plus_spot";

export interface ProviderRateQuote {
  provider: ProviderId;
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: number;
  rateType: ProviderRateType;
  observedAt: number;
  sourceUpdatedAt: number;
  metadata: Record<string, string | number | null>;
}

interface ProviderRateRow {
  provider: ProviderId;
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: number;
  rate_type: ProviderRateType;
  observed_at: number;
  source_updated_at: number;
  metadata_json: string;
}

interface WiseRateResponse {
  rate: number;
  source: string;
  target: string;
  time: string;
}

export interface HsbcDepositPlusInput {
  base: CurrencyCode;
  quote: CurrencyCode;
  exchangeSpotRate: number;
  capturedAt?: string | number;
  exchangeBreakEvenRate?: number;
  conversionRate?: number;
  interestRate?: number;
  depositPeriod?: string;
  currencyPairSymbolText?: string;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export async function fetchWisePair(
  base: CurrencyCode,
  quote: CurrencyCode,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderRateQuote> {
  const query = new URLSearchParams({ source: base, target: quote });
  const response = await fetcher(`${WISE_RATES_ENDPOINT}?${query.toString()}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) throw new Error(`Wise rate provider returned ${response.status}`);
  const payload = (await response.json()) as WiseRateResponse[];
  if (!Array.isArray(payload)) throw new Error("Wise rate provider returned an invalid payload");

  const item = payload.find(
    (row) => row.source?.toUpperCase() === base && row.target?.toUpperCase() === quote,
  );
  if (!item || !isPositiveFinite(item.rate)) {
    throw new Error(`Wise rate provider omitted ${base}/${quote}`);
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  const parsedTimestamp = Math.floor(Date.parse(item.time) / 1000);
  return {
    provider: "wise",
    base,
    quote,
    rate: item.rate,
    rateType: "mid_market",
    observedAt: nowEpoch,
    sourceUpdatedAt: Number.isFinite(parsedTimestamp) ? parsedTimestamp : nowEpoch,
    metadata: {},
  };
}

export async function collectWiseUsdQuotes(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderRateQuote[]> {
  const results = await Promise.allSettled(
    CURRENCY_CODES.filter((quote) => quote !== "USD").map((quote) =>
      fetchWisePair("USD", quote, token, fetcher),
    ),
  );
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export async function storeProviderQuote(
  db: D1Database,
  quote: ProviderRateQuote,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO provider_rate_snapshots
        (provider, base, quote, rate, rate_type, observed_at, source_updated_at, metadata_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      quote.provider,
      quote.base,
      quote.quote,
      quote.rate,
      quote.rateType,
      quote.observedAt,
      quote.sourceUpdatedAt,
      JSON.stringify(quote.metadata),
    )
    .run();
}

export async function storeProviderQuotes(
  db: D1Database,
  quotes: ProviderRateQuote[],
): Promise<void> {
  if (quotes.length === 0) return;
  const statements = quotes.map((quote) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO provider_rate_snapshots
          (provider, base, quote, rate, rate_type, observed_at, source_updated_at, metadata_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        quote.provider,
        quote.base,
        quote.quote,
        quote.rate,
        quote.rateType,
        quote.observedAt,
        quote.sourceUpdatedAt,
        JSON.stringify(quote.metadata),
      ),
  );
  await db.batch(statements);
}

export async function readLatestProviderQuote(
  db: D1Database,
  provider: ProviderId,
  base: CurrencyCode,
  quote: CurrencyCode,
): Promise<ProviderRateQuote | null> {
  const row = await db
    .prepare(
      `SELECT provider, base, quote, rate, rate_type, observed_at, source_updated_at, metadata_json
       FROM provider_rate_snapshots
       WHERE provider = ?1
         AND ((base = ?2 AND quote = ?3) OR (base = ?3 AND quote = ?2))
       ORDER BY source_updated_at DESC, observed_at DESC
       LIMIT 1`,
    )
    .bind(provider, base, quote)
    .first<ProviderRateRow>();

  if (!row || !isPositiveFinite(row.rate)) return null;
  const isDirect = row.base === base && row.quote === quote;
  return {
    provider: row.provider,
    base,
    quote,
    rate: isDirect ? row.rate : 1 / row.rate,
    rateType: row.rate_type,
    observedAt: row.observed_at,
    sourceUpdatedAt: row.source_updated_at,
    metadata: parseMetadata(row.metadata_json),
  };
}

export function parseHsbcDepositPlusInput(
  value: unknown,
  nowEpoch = Math.floor(Date.now() / 1000),
): ProviderRateQuote {
  if (!value || typeof value !== "object") throw new Error("Invalid JSON payload");
  const input = value as Record<string, unknown>;
  const rawBase = typeof input.base === "string" ? input.base : null;
  const rawQuote = typeof input.quote === "string" ? input.quote : null;
  if (!isCurrencyCode(rawBase) || !isCurrencyCode(rawQuote)) {
    throw new Error("Unsupported currency pair");
  }
  const base = normalizeCurrency(rawBase);
  const quote = normalizeCurrency(rawQuote);
  if (base === quote) throw new Error("Base and quote must be different");
  if (!isPositiveFinite(input.exchangeSpotRate)) {
    throw new Error("exchangeSpotRate must be a positive number");
  }

  const capturedAt = parseCapturedAt(input.capturedAt, nowEpoch);
  if (capturedAt > nowEpoch + 600 || capturedAt < nowEpoch - 7 * 86_400) {
    throw new Error("capturedAt must be within the last 7 days");
  }

  const metadata: ProviderRateQuote["metadata"] = {};
  for (const field of ["exchangeBreakEvenRate", "conversionRate", "interestRate"] as const) {
    const fieldValue = input[field];
    if (fieldValue !== undefined) {
      if (!isPositiveFinite(fieldValue)) throw new Error(`${field} must be a positive number`);
      metadata[field] = fieldValue;
    }
  }
  for (const field of ["depositPeriod", "currencyPairSymbolText"] as const) {
    const fieldValue = input[field];
    if (fieldValue !== undefined) {
      if (typeof fieldValue !== "string" || fieldValue.length > 80) {
        throw new Error(`${field} must be a short string`);
      }
      metadata[field] = fieldValue;
    }
  }

  return {
    provider: "hsbc_deposit_plus",
    base,
    quote,
    rate: input.exchangeSpotRate,
    rateType: "deposit_plus_spot",
    observedAt: nowEpoch,
    sourceUpdatedAt: capturedAt,
    metadata,
  };
}

export function percentDifference(rate: number | null, marketRate: number): number | null {
  if (!isPositiveFinite(rate) || !isPositiveFinite(marketRate)) return null;
  return ((rate - marketRate) / marketRate) * 100;
}

function parseCapturedAt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Math.floor(Date.parse(value) / 1000);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error("capturedAt must be an ISO timestamp or Unix timestamp");
}

function parseMetadata(value: string): ProviderRateQuote["metadata"] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as ProviderRateQuote["metadata"])
      : {};
  } catch {
    return {};
  }
}
