import {
  CURRENCY_CODES,
  type CurrencyCode,
  type HistoryWindow,
} from "./currencies";

const CURRENT_RATES_ENDPOINT = "https://open.er-api.com/v6/latest";
const HISTORY_RATES_ENDPOINT = "https://api.frankfurter.dev/v2/rates";
const CURRENT_PROVIDER = "ExchangeRate-API";
const HISTORY_PROVIDER = "Frankfurter institutional reference rates";

interface ExchangeRateApiResponse {
  result: string;
  provider?: string;
  time_last_update_unix: number;
  base_code: string;
  rates: Record<string, number>;
}

interface FrankfurterRate {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

export interface CurrentSnapshot {
  base: CurrencyCode;
  provider: string;
  providerUrl: string;
  sourceUpdatedAt: number;
  fetchedAt: number;
  rates: Record<CurrencyCode, number>;
}

export interface RatePoint {
  date: string;
  timestamp: number;
  rate: number;
}

export interface HistorySeries {
  base: CurrencyCode;
  quote: CurrencyCode;
  days: HistoryWindow;
  provider: string;
  frequency: "intraday" | "daily";
  points: RatePoint[];
}

export interface D1HistoryRow {
  quote: CurrencyCode;
  rate: number;
  observed_at: number;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function deriveCrossRate(
  usdRates: Partial<Record<CurrencyCode, number>>,
  base: CurrencyCode,
  quote: CurrencyCode,
): number {
  const baseRate = base === "USD" ? 1 : usdRates[base];
  const quoteRate = quote === "USD" ? 1 : usdRates[quote];
  if (!isPositiveFinite(baseRate) || !isPositiveFinite(quoteRate)) {
    throw new Error(`Missing rate for ${base}/${quote}`);
  }
  return quoteRate / baseRate;
}

export async function fetchCurrentSnapshot(
  base: CurrencyCode,
  fetcher: typeof fetch = fetch,
): Promise<CurrentSnapshot> {
  const response = await fetcher(`${CURRENT_RATES_ENDPOINT}/USD`, {
    headers: { accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 300 },
  });

  if (!response.ok) {
    throw new Error(`Current rate provider returned ${response.status}`);
  }

  const payload = (await response.json()) as ExchangeRateApiResponse;
  if (payload.result !== "success" || payload.base_code !== "USD") {
    throw new Error("Current rate provider returned an invalid payload");
  }

  const usdRates: Partial<Record<CurrencyCode, number>> = {};
  for (const code of CURRENCY_CODES) {
    const rate = payload.rates[code];
    if (!isPositiveFinite(rate)) {
      throw new Error(`Current rate provider omitted ${code}`);
    }
    usdRates[code] = rate;
  }

  const rates = {} as Record<CurrencyCode, number>;
  for (const code of CURRENCY_CODES) {
    rates[code] = code === base ? 1 : deriveCrossRate(usdRates, base, code);
  }

  return {
    base,
    provider: CURRENT_PROVIDER,
    providerUrl: "https://www.exchangerate-api.com/",
    sourceUpdatedAt: payload.time_last_update_unix,
    fetchedAt: Math.floor(Date.now() / 1000),
    rates,
  };
}

export async function fetchReferenceHistory(
  base: CurrencyCode,
  quote: CurrencyCode,
  days: HistoryWindow,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<HistorySeries> {
  const to = isoDate(now);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - days);
  const from = isoDate(fromDate);
  const query = new URLSearchParams({ base, quotes: quote, from, to });
  const response = await fetcher(`${HISTORY_RATES_ENDPOINT}?${query.toString()}`, {
    headers: { accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 3600 },
  });

  if (!response.ok) {
    throw new Error(`History rate provider returned ${response.status}`);
  }

  const payload = (await response.json()) as FrankfurterRate[];
  if (!Array.isArray(payload)) {
    throw new Error("History rate provider returned an invalid payload");
  }

  const points = payload
    .filter((row) => row.base === base && row.quote === quote && isPositiveFinite(row.rate))
    .map((row) => ({
      date: row.date,
      timestamp: Math.floor(Date.parse(`${row.date}T00:00:00Z`) / 1000),
      rate: row.rate,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (points.length < 2) {
    throw new Error(`Not enough historical data for ${base}/${quote}`);
  }

  return {
    base,
    quote,
    days,
    provider: HISTORY_PROVIDER,
    frequency: "daily",
    points,
  };
}

export async function readD1History(
  db: D1Database,
  base: CurrencyCode,
  quote: CurrencyCode,
  days: HistoryWindow,
  nowEpoch = Math.floor(Date.now() / 1000),
): Promise<HistorySeries | null> {
  const cutoff = nowEpoch - days * 86_400;
  const result = await db
    .prepare(
      `SELECT quote, rate, observed_at
       FROM rate_snapshots
       WHERE observed_at >= ?1 AND quote IN (?2, ?3)
       ORDER BY observed_at ASC`,
    )
    .bind(cutoff, base, quote)
    .all<D1HistoryRow>();

  const byTimestamp = new Map<number, Partial<Record<CurrencyCode, number>>>();
  for (const row of result.results) {
    const values = byTimestamp.get(row.observed_at) ?? {};
    values[row.quote] = row.rate;
    byTimestamp.set(row.observed_at, values);
  }

  const points: RatePoint[] = [];
  for (const [timestamp, usdRates] of byTimestamp) {
    try {
      points.push({
        date: new Date(timestamp * 1000).toISOString(),
        timestamp,
        rate: deriveCrossRate(usdRates, base, quote),
      });
    } catch {
      // A partially written timestamp is skipped instead of fabricating a value.
    }
  }

  if (points.length < 4) return null;
  return {
    base,
    quote,
    days,
    provider: "FXPulse archive · ExchangeRate-API",
    frequency: "intraday",
    points,
  };
}

export async function storeSnapshot(db: D1Database, snapshot: CurrentSnapshot): Promise<void> {
  if (snapshot.base !== "USD") {
    throw new Error("Scheduled snapshots must use USD as the base");
  }

  const statements = CURRENCY_CODES.map((quote) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO rate_snapshots
          (quote, rate, observed_at, source_updated_at, provider)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        quote,
        snapshot.rates[quote],
        snapshot.fetchedAt,
        snapshot.sourceUpdatedAt,
        snapshot.provider,
      ),
  );

  await db.batch(statements);
  const cutoff = snapshot.fetchedAt - 400 * 86_400;
  await db.prepare("DELETE FROM rate_snapshots WHERE observed_at < ?1").bind(cutoff).run();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
