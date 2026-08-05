import { CURRENCY_CODES, type CurrencyCode } from "./currencies";

const WISE_PUBLIC_RATES_ENDPOINT = "https://wise.com/rates/live";
const HSBC_PUBLIC_RATES_ENDPOINT =
  "https://rbwm-api.hsbc.com.hk/digital-pws-tools-investments-eapi-prod-proxy/v1/investments/exchange-rate";

export type ProviderId = "wise" | "hsbc_public";
export type ProviderRateType = "mid_market" | "public_tt_rate";

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

interface WisePublicRateResponse {
  source: string;
  target: string;
  value: number;
  time: number;
}

export interface HsbcPublicRateDetail {
  lastUpdateDate: string;
  ccy: string;
  ttBuyRt: string;
  ttSelRt: string;
  bankBuyRt?: string;
  bankSellRt?: string;
  ccyName?: string;
}

export interface HsbcPublicRateResponse {
  detailRates: HsbcPublicRateDetail[];
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export async function fetchWisePair(
  base: CurrencyCode,
  quote: CurrencyCode,
  fetcher: typeof fetch = fetch,
): Promise<ProviderRateQuote> {
  const query = new URLSearchParams({ source: base, target: quote });
  const response = await fetcher(`${WISE_PUBLIC_RATES_ENDPOINT}?${query.toString()}`, {
    headers: { accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 60 },
  });

  if (!response.ok) throw new Error(`Wise public rate provider returned ${response.status}`);
  const item = (await response.json()) as WisePublicRateResponse;
  if (
    item?.source?.toUpperCase() !== base ||
    item?.target?.toUpperCase() !== quote ||
    !isPositiveFinite(item.value)
  ) {
    throw new Error(`Wise public rate provider omitted ${base}/${quote}`);
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  const sourceUpdatedAt = normalizeEpoch(item.time, nowEpoch);
  return {
    provider: "wise",
    base,
    quote,
    rate: item.value,
    rateType: "mid_market",
    observedAt: nowEpoch,
    sourceUpdatedAt,
    metadata: { calculation: "Wise 公开货币转换器中间价" },
  };
}

export async function fetchHsbcPublicPair(
  base: CurrencyCode,
  quote: CurrencyCode,
  fetcher: typeof fetch = fetch,
): Promise<ProviderRateQuote> {
  const response = await fetcher(`${HSBC_PUBLIC_RATES_ENDPOINT}?locale=zh_HK`, {
    headers: { accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 300 },
  });
  if (!response.ok) throw new Error(`HSBC public rate provider returned ${response.status}`);
  const payload = (await response.json()) as HsbcPublicRateResponse;
  return deriveHsbcPublicPair(payload, base, quote);
}

export function deriveHsbcPublicPair(
  payload: HsbcPublicRateResponse,
  base: CurrencyCode,
  quote: CurrencyCode,
  nowEpoch = Math.floor(Date.now() / 1000),
): ProviderRateQuote {
  if (!Array.isArray(payload?.detailRates)) {
    throw new Error("HSBC public rate provider returned an invalid payload");
  }
  if (base === quote) throw new Error("Base and quote must be different");

  const details = new Map(
    payload.detailRates.map((detail) => [detail.ccy?.toUpperCase(), detail] as const),
  );
  const baseDetail = base === "HKD" ? null : details.get(base);
  const quoteDetail = quote === "HKD" ? null : details.get(quote);
  const baseTtBuyHkd = base === "HKD" ? 1 : parsePositiveRate(baseDetail?.ttBuyRt, base);
  const quoteTtSellHkd = quote === "HKD" ? 1 : parsePositiveRate(quoteDetail?.ttSelRt, quote);
  const timestamps = [baseDetail, quoteDetail]
    .filter((detail): detail is HsbcPublicRateDetail => Boolean(detail))
    .map((detail) => parseHsbcTimestamp(detail.lastUpdateDate))
    .filter((timestamp): timestamp is number => timestamp !== null);
  const sourceUpdatedAt = timestamps.length ? Math.min(...timestamps) : nowEpoch;

  return {
    provider: "hsbc_public",
    base,
    quote,
    rate: baseTtBuyHkd / quoteTtSellHkd,
    rateType: "public_tt_rate",
    observedAt: nowEpoch,
    sourceUpdatedAt,
    metadata: {
      baseTtBuyHkd,
      quoteTtSellHkd,
      calculation: hsbcCalculationLabel(base, quote),
      priceSide: "客户卖出基准币种并买入目标币种",
    },
  };
}

export async function collectWiseUsdQuotes(
  fetcher: typeof fetch = fetch,
): Promise<ProviderRateQuote[]> {
  const results = await Promise.allSettled(
    CURRENCY_CODES.filter((currency) => currency !== "USD").flatMap((currency) => [
      fetchWisePair("USD", currency, fetcher),
      fetchWisePair(currency, "USD", fetcher),
    ]),
  );
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export async function collectHsbcPublicQuotes(
  fetcher: typeof fetch = fetch,
): Promise<ProviderRateQuote[]> {
  const response = await fetcher(`${HSBC_PUBLIC_RATES_ENDPOINT}?locale=zh_HK`, {
    headers: { accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 300 },
  });
  if (!response.ok) throw new Error(`HSBC public rate provider returned ${response.status}`);
  const payload = (await response.json()) as HsbcPublicRateResponse;
  return CURRENCY_CODES.flatMap((base) =>
    CURRENCY_CODES.filter((quote) => quote !== base).map((quote) =>
      deriveHsbcPublicPair(payload, base, quote),
    ),
  );
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
  const direct = await readProviderRow(db, provider, base, quote);
  if (direct) return rowToQuote(direct, base, quote, false);

  // A Wise mid-market rate can safely use the inverse as an archive fallback.
  // HSBC TT buy/sell rates are directional and must never be inverted.
  if (provider !== "wise") return null;
  const reverse = await readProviderRow(db, provider, quote, base);
  return reverse ? rowToQuote(reverse, base, quote, true) : null;
}

export function percentDifference(rate: number | null, marketRate: number): number | null {
  if (!isPositiveFinite(rate) || !isPositiveFinite(marketRate)) return null;
  return ((rate - marketRate) / marketRate) * 100;
}

async function readProviderRow(
  db: D1Database,
  provider: ProviderId,
  base: CurrencyCode,
  quote: CurrencyCode,
): Promise<ProviderRateRow | null> {
  return db
    .prepare(
      `SELECT provider, base, quote, rate, rate_type, observed_at, source_updated_at, metadata_json
       FROM provider_rate_snapshots
       WHERE provider = ?1 AND base = ?2 AND quote = ?3
       ORDER BY source_updated_at DESC, observed_at DESC
       LIMIT 1`,
    )
    .bind(provider, base, quote)
    .first<ProviderRateRow>();
}

function rowToQuote(
  row: ProviderRateRow,
  base: CurrencyCode,
  quote: CurrencyCode,
  invert: boolean,
): ProviderRateQuote | null {
  if (!isPositiveFinite(row.rate)) return null;
  return {
    provider: row.provider,
    base,
    quote,
    rate: invert ? 1 / row.rate : row.rate,
    rateType: row.rate_type,
    observedAt: row.observed_at,
    sourceUpdatedAt: row.source_updated_at,
    metadata: parseMetadata(row.metadata_json),
  };
}

function parsePositiveRate(value: string | undefined, currency: CurrencyCode): number {
  const parsed = Number(value);
  if (!isPositiveFinite(parsed)) throw new Error(`HSBC public rate omitted ${currency}`);
  return parsed;
}

function parseHsbcTimestamp(value: string): number | null {
  const match = value?.match(
    /^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s([+-]\d{2})(\d{2})$/,
  );
  const normalized = match ? `${match[1]}T${match[2]}${match[3]}:${match[4]}` : value;
  const parsed = Math.floor(Date.parse(normalized) / 1000);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEpoch(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function hsbcCalculationLabel(base: CurrencyCode, quote: CurrencyCode): string {
  if (base === "HKD") return `1 ÷ ${quote} TT Sell`;
  if (quote === "HKD") return `${base} TT Buy`;
  return `${base} TT Buy ÷ ${quote} TT Sell`;
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
