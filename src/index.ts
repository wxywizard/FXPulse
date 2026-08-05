import {
  CURRENCIES,
  CURRENCY_CODES,
  defaultQuote,
  isCurrencyCode,
  isHistoryWindow,
  normalizeCurrency,
  type CurrencyCode,
} from "./currencies";
import {
  cleanupMarketHistory,
  fetchCurrentSnapshot,
  fetchReferenceHistory,
  readD1History,
  storeSnapshot,
} from "./rates";
import {
  bucketProviderQuotes,
  collectHsbcPublicQuotes,
  collectWiseUsdQuotes,
  compactProviderHistory,
  fetchHsbcPublicPair,
  fetchWisePair,
  percentDifference,
  readLatestProviderQuote,
  readProviderHistory,
  storeProviderQuotes,
  type ArchivedProviderId,
  type ProviderId,
  type ProviderRateQuote,
} from "./provider-rates";
import {
  HONG_KONG_BANKS,
  collectHongKongBankPairs,
  compareBankQuotes,
  fetchHongKongBankPair,
  type HongKongBankQuote,
} from "./bank-rates";
import { withEdgeCache } from "./cache";
import { renderLlmsTxt, renderPage, renderSitemap } from "./template";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
}

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ status: "ok", service: "fxpulse", time: new Date().toISOString() });
    }

    if (url.pathname === "/api/currencies") {
      return json({ currencies: CURRENCY_CODES.map((code) => CURRENCIES[code]) }, 200, 86_400);
    }

    if (url.pathname === "/api/rates") {
      return withEdgeCache(
        request,
        ctx,
        { freshSeconds: 300, staleSeconds: 1_800 },
        () => handleCurrentRates(url),
      );
    }

    if (url.pathname === "/api/compare") {
      return withEdgeCache(
        request,
        ctx,
        { freshSeconds: 60, staleSeconds: 600 },
        () => handleComparison(url, env),
      );
    }

    if (url.pathname === "/api/overview") {
      return withEdgeCache(
        request,
        ctx,
        { freshSeconds: 60, staleSeconds: 600 },
        () => handleOverview(url, env, ctx),
      );
    }

    if (url.pathname === "/api/banks") {
      return withEdgeCache(
        request,
        ctx,
        { freshSeconds: 300, staleSeconds: 1_800 },
        () => handleBankComparison(url, env, ctx),
      );
    }

    if (url.pathname === "/api/history") {
      return withEdgeCache(
        request,
        ctx,
        { freshSeconds: 900, staleSeconds: 86_400 },
        () => handleHistory(url, env),
      );
    }

    const origin = url.origin;
    if (url.pathname === "/sitemap.xml") {
      return textResponse(renderSitemap(origin), "application/xml; charset=utf-8", 86_400);
    }
    if (url.pathname === "/robots.txt") {
      return textResponse(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`, "text/plain; charset=utf-8", 86_400);
    }
    if (url.pathname === "/llms.txt") {
      return textResponse(renderLlmsTxt(origin), "text/plain; charset=utf-8", 86_400);
    }

    const pair = parsePagePair(url.pathname);
    if (pair) {
      const canonicalPath = `/rates/${pair.base.toLowerCase()}/${pair.quote.toLowerCase()}`;
      if (url.pathname !== "/" && url.pathname !== canonicalPath) {
        return secure(Response.redirect(`${url.origin}${canonicalPath}`, 308));
      }
      let snapshot = null;
      try {
        snapshot = await fetchCurrentSnapshot(pair.base);
      } catch (error) {
        console.error("Initial current-rate fetch failed", error);
      }
      const response = new Response(renderPage({ origin, ...pair, snapshot }), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=1800",
        },
      });
      return secure(response);
    }

    if (url.pathname.startsWith("/rates/")) {
      return secure(new Response("未找到该币种对", { status: 404 }));
    }

    const assetResponse = await env.ASSETS.fetch(request);
    ctx.waitUntil(Promise.resolve());
    return secure(assetResponse);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const scheduledEpoch = Math.floor(controller.scheduledTime / 1000);
        const observedAt = Math.floor(scheduledEpoch / 3_600) * 3_600;
        const utcHour = new Date(controller.scheduledTime).getUTCHours();
        const collectBanks = shouldCollectBankArchive(controller.scheduledTime);
        const snapshot = await fetchCurrentSnapshot("USD");
        await storeSnapshot(env.DB, snapshot);
        console.log("Stored FX snapshot", {
          fetchedAt: snapshot.fetchedAt,
          sourceUpdatedAt: snapshot.sourceUpdatedAt,
          currencies: CURRENCY_CODES.length,
        });

        const [hsbcQuotes, wiseQuotes, bankPairs] = await Promise.all([
          collectHsbcPublicQuotes().catch((error) => {
            console.warn("HSBC public snapshot collection skipped", error);
            return [];
          }),
          collectWiseUsdQuotes().catch((error) => {
            console.warn("Wise public snapshot collection skipped", error);
            return [];
          }),
          collectBanks
            ? collectHongKongBankPairs().catch((error) => {
                console.warn("Hong Kong bank snapshot collection skipped", error);
                return [];
              })
            : Promise.resolve([]),
        ]);
        const bankQuotes: ProviderRateQuote[] = bankPairs.map(({ base, quote, bank }) => ({
          provider: bankProviderId(bank.id),
          base,
          quote,
          rate: bank.rate as number,
          rateType: "public_tt_rate",
          observedAt,
          sourceUpdatedAt: bank.observedAt ?? observedAt,
          metadata: {
            bankName: bank.name,
            calculation: bank.basis,
            source: bank.source,
          },
        }));
        try {
          await storeProviderQuotes(
            env.DB,
            bucketProviderQuotes([...hsbcQuotes, ...wiseQuotes, ...bankQuotes], observedAt),
          );
          console.log("Stored provider snapshots", {
            hsbc: hsbcQuotes.length,
            wise: wiseQuotes.length,
            banks: bankQuotes.length,
          });
        } catch (error) {
          console.warn("Provider snapshot storage skipped", error);
        }

        if (utcHour === 0) {
          try {
            await compactProviderHistory(env.DB, scheduledEpoch);
            await cleanupMarketHistory(env.DB, scheduledEpoch);
          } catch (error) {
            console.warn("Daily history compaction skipped", error);
          }
        }
      })(),
    );
  },
};

async function handleCurrentRates(url: URL): Promise<Response> {
  const rawBase = url.searchParams.get("base") ?? "HKD";
  if (!isCurrencyCode(rawBase)) return json({ error: "Unsupported base currency" }, 400);
  const base = normalizeCurrency(rawBase);

  try {
    const snapshot = await fetchCurrentSnapshot(base);
    return json(
      {
        marketType: "reference",
        disclaimer: "Third-party market reference rate; not an HSBC quote.",
        ...snapshot,
        sourceUpdatedAt: new Date(snapshot.sourceUpdatedAt * 1000).toISOString(),
        fetchedAt: new Date(snapshot.fetchedAt * 1000).toISOString(),
      },
      200,
      300,
    );
  } catch (error) {
    console.error("Current-rate API failed", error);
    return json({ error: "Current reference rates are temporarily unavailable" }, 503, 30);
  }
}

async function handleComparison(url: URL, env: Env): Promise<Response> {
  const pair = parseApiPair(url);
  if (pair instanceof Response) return pair;
  const { base, quote } = pair;

  try {
    const liveWisePromise = fetchWisePair(base, quote).catch((error) => {
      console.warn("Wise public quote unavailable; using archive when possible", error);
      return null;
    });
    const liveHsbcPromise = fetchHsbcPublicPair(base, quote).catch((error) => {
      console.warn("HSBC public quote unavailable; using archive when possible", error);
      return null;
    });
    const [marketSnapshot, storedWise, storedHsbc, liveWise, liveHsbc] = await Promise.all([
      fetchCurrentSnapshot(base),
      safeReadProviderQuote(env.DB, "wise", base, quote),
      safeReadProviderQuote(env.DB, "hsbc_public", base, quote),
      liveWisePromise,
      liveHsbcPromise,
    ]);
    const marketRate = marketSnapshot.rates[quote];

    const wise = liveWise ?? storedWise;
    const hsbc = liveHsbc ?? storedHsbc;
    const sources = [
      {
        id: "market",
        label: "公共市场参考价",
        rateType: "reference",
        status: "available",
        rate: marketRate,
        differenceFromMarketPct: 0,
        sourceUpdatedAt: new Date(marketSnapshot.sourceUpdatedAt * 1000).toISOString(),
        observedAt: new Date(marketSnapshot.fetchedAt * 1000).toISOString(),
        provider: marketSnapshot.provider,
        providerUrl: marketSnapshot.providerUrl,
        reason: null,
      },
      serializeProviderSource(
        "wise",
        wise,
        marketRate,
        "Wise 公开中间价",
        "https://wise.com/gb/currency-converter/",
        "Wise 公开汇率接口暂时不可用，且没有可用归档",
      ),
      serializeProviderSource(
        "hsbc_public",
        hsbc,
        marketRate,
        "汇丰公开牌价（TT）",
        "https://www.hsbc.com.hk/investments/products/foreign-exchange/currency-rate/",
        "汇丰香港公开牌价接口暂时不可用，且没有可用归档",
      ),
    ];

    return json(
      {
        base,
        quote,
        unit: 1,
        direction: `1 ${base} = x ${quote}`,
        sources,
        interpretation:
          `三列均按“卖出 ${base}、买入 ${quote}”比较。汇丰公开牌价按 TT Buy / TT Sell 经 HKD 交叉计算，已包含银行买卖价差，因此反转币种后不会简单取倒数；它不是登录后优惠价或保证成交价。`,
      },
      200,
      60,
    );
  } catch (error) {
    console.error("Rate comparison API failed", error);
    return json({ error: "Rate comparison is temporarily unavailable" }, 503, 30);
  }
}

export async function handleOverview(
  url: URL,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const rawBase = url.searchParams.get("base") ?? "HKD";
  if (!isCurrencyCode(rawBase)) return json({ error: "Unsupported base currency" }, 400);
  const base = normalizeCurrency(rawBase);
  const targets = CURRENCY_CODES.filter((currency) => currency !== base);
  const requestedExtras = parseOverviewSourceIds(url);
  if (requestedExtras instanceof Response) return requestedExtras;
  const wantsHsbc = requestedExtras.includes("hsbc_public");
  const requestedBankIds = requestedExtras.flatMap((id) => {
    const bankId = id.match(/^bank_([a-z0-9]+)$/)?.[1];
    return bankId ? [bankId] : [];
  });

  try {
    const wisePromise = Promise.all(
      targets.map((quote) =>
        fetchWisePair(base, quote).catch((error) => {
          console.warn(`Wise public overview quote unavailable for ${base}/${quote}`, error);
          return null;
        }),
      ),
    );
    const hsbcPromise = wantsHsbc
      ? collectHsbcPublicQuotes()
          .then((quotes) => quotes.filter((quote) => quote.base === base))
          .catch((error) => {
            console.warn(`HSBC public overview quotes unavailable for ${base}`, error);
            return [];
          })
      : Promise.resolve([]);
    const bankPromise = requestedBankIds.length
      ? collectHongKongBankPairs().catch((error) => {
          console.warn(`Hong Kong bank overview quotes unavailable for ${base}`, error);
          return [];
        })
      : Promise.resolve([]);
    const [marketSnapshot, liveWiseQuotes, liveHsbcQuotes, liveBankPairs] = await Promise.all([
      fetchCurrentSnapshot(base),
      wisePromise,
      hsbcPromise,
      bankPromise,
    ]);

    const liveWise = new Map(
      liveWiseQuotes
        .filter((quote): quote is ProviderRateQuote => quote !== null)
        .map((quote) => [quote.quote, quote]),
    );
    const liveHsbc = new Map(liveHsbcQuotes.map((quote) => [quote.quote, quote]));
    const liveBankQuotes = liveBankPairs
      .filter(
        (pair) =>
          pair.base === base &&
          requestedBankIds.includes(pair.bank.id) &&
          typeof pair.bank.rate === "number",
      )
      .map(({ quote, bank }) => ({
        provider: bankProviderId(bank.id),
        base,
        quote,
        rate: bank.rate as number,
        rateType: "public_tt_rate" as const,
        observedAt: bank.observedAt ?? Math.floor(Date.now() / 1000),
        sourceUpdatedAt: bank.observedAt ?? Math.floor(Date.now() / 1000),
        metadata: {
          bankName: bank.name,
          calculation: bank.basis,
          source: bank.source,
          sourceUrl: bank.sourceUrl,
        },
      }));
    const liveBanks = new Map(
      liveBankQuotes.map((quote) => [`${quote.provider}:${quote.quote}`, quote] as const),
    );

    const missingWise = targets.filter((quote) => !liveWise.has(quote));
    const missingHsbc = wantsHsbc ? targets.filter((quote) => !liveHsbc.has(quote)) : [];
    const missingBankKeys = requestedBankIds.flatMap((bankId) =>
      targets.flatMap((quote) => {
        const provider = bankProviderId(bankId);
        return liveBanks.has(`${provider}:${quote}`) ? [] : [{ provider, quote }];
      }),
    );
    const [storedWiseQuotes, storedHsbcQuotes, storedBankQuotes] = await Promise.all([
      Promise.all(missingWise.map((quote) => safeReadProviderQuote(env.DB, "wise", base, quote))),
      Promise.all(
        missingHsbc.map((quote) => safeReadProviderQuote(env.DB, "hsbc_public", base, quote)),
      ),
      Promise.all(
        missingBankKeys.map(({ provider, quote }) =>
          safeReadProviderQuote(env.DB, provider, base, quote),
        ),
      ),
    ]);
    const storedWise = new Map(
      storedWiseQuotes
        .filter((quote): quote is ProviderRateQuote => quote !== null)
        .map((quote) => [quote.quote, quote]),
    );
    const storedHsbc = new Map(
      storedHsbcQuotes
        .filter((quote): quote is ProviderRateQuote => quote !== null)
        .map((quote) => [quote.quote, quote]),
    );
    const storedBanks = new Map(
      storedBankQuotes
        .filter((quote): quote is ProviderRateQuote => quote !== null)
        .map((quote) => [`${quote.provider}:${quote.quote}`, quote] as const),
    );

    const pairs = targets.map((quote) => {
      const marketRate = marketSnapshot.rates[quote];
      return {
        quote,
        direction: `1 ${base} = x ${quote}`,
        sources: [
          serializeMarketSource(marketSnapshot, quote),
          serializeProviderSource(
            "wise",
            liveWise.get(quote) ?? storedWise.get(quote) ?? null,
            marketRate,
            "Wise",
            "https://wise.com/gb/currency-converter/",
            "Wise 公开汇率暂不可用",
          ),
          ...requestedExtras.map((sourceId) => {
            if (sourceId === "hsbc_public") {
              return serializeProviderSource(
                "hsbc_public",
                liveHsbc.get(quote) ?? storedHsbc.get(quote) ?? null,
                marketRate,
                "汇丰 TT",
                "https://www.hsbc.com.hk/investments/products/foreign-exchange/currency-rate/",
                "汇丰公开牌价暂不可用",
              );
            }
            const bankId = sourceId.match(/^bank_([a-z0-9]+)$/)?.[1] ?? "";
            const bank = HONG_KONG_BANKS.find((item) => item.id === bankId);
            const provider = bankProviderId(bankId);
            return serializeBankOverviewSource(
              sourceId,
              bank?.name ?? sourceId,
              liveBanks.get(`${provider}:${quote}`) ??
                storedBanks.get(`${provider}:${quote}`) ??
                null,
              marketRate,
            );
          }),
        ],
      };
    });

    return json(
      {
        base,
        unit: 1,
        sources: ["market", "wise", ...requestedExtras],
        pairs,
        interpretation:
          "公共市场和 Wise 为固定来源；附加来源由全局或单卡片配置决定，银行 TT 报价包含买卖价差。",
      },
      200,
      60,
    );
  } catch (error) {
    console.error("Market overview API failed", error);
    return json({ error: "Market overview is temporarily unavailable" }, 503, 30);
  }
}

async function handleBankComparison(
  url: URL,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const pair = parseApiPair(url);
  if (pair instanceof Response) return pair;
  const { base, quote } = pair;

  try {
    const [marketSnapshot, bankResult, officialHsbc] = await Promise.all([
      fetchCurrentSnapshot(base),
      fetchHongKongBankPair(base, quote, Number.NaN),
      fetchHsbcPublicPair(base, quote).catch((error) => {
        console.warn("Official HSBC quote unavailable in bank comparison", error);
        return null;
      }),
    ]);
    const marketRate = marketSnapshot.rates[quote];
    const banks = bankResult.banks
      .map((bank): HongKongBankQuote => {
        if (bank.id === "hsbc" && officialHsbc) {
          return {
            ...bank,
            status: "available",
            rate: officialHsbc.rate,
            differenceFromMarketPct: percentDifference(officialHsbc.rate, marketRate),
            observedAt: officialHsbc.observedAt,
            basis: String(officialHsbc.metadata.calculation ?? "汇丰官方 TT 牌价"),
            source: "HSBC Hong Kong",
            sourceUrl:
              "https://www.hsbc.com.hk/investments/products/foreign-exchange/currency-rate/",
            reason: null,
            baseTtBuyHkd: numberMetadata(officialHsbc.metadata.baseTtBuyHkd),
            quoteTtSellHkd: numberMetadata(officialHsbc.metadata.quoteTtSellHkd),
          };
        }
        return {
          ...bank,
          differenceFromMarketPct:
            bank.rate === null ? null : percentDifference(bank.rate, marketRate),
        };
      })
      .sort(compareBankQuotes);
    const availableBanks = banks.filter((bank) => bank.rate !== null);
    const bestBank = availableBanks[0] ?? null;

    return json(
      {
        base,
        quote,
        unit: 1,
        direction: `卖出 ${base}，买入 ${quote}`,
        marketRate,
        availableBankCount: availableBanks.length,
        totalBankCount: banks.length,
        bestBank: bestBank
          ? { id: bestBank.id, name: bestBank.name, rate: bestBank.rate }
          : null,
        banks: banks.map((bank, index) => ({
          ...bank,
          rank: bank.rate === null ? null : index + 1,
          observedAt:
            bank.observedAt === null ? null : new Date(bank.observedAt * 1000).toISOString(),
        })),
        warnings: bankResult.warnings,
        source: {
          provider: "YoYoRate",
          providerUrl: "https://yoyorate.com/",
          note: "聚合香港银行公开电汇买卖价；汇丰一行由汇丰香港官方公开接口校准。仅收录无需登录且具有可靠匿名来源的报价，登录后专属报价不会进入配置。",
        },
        interpretation: `全部银行统一按“卖出 ${base}、买入 ${quote}”计算；外币交叉盘使用 BASE TT 买入 ÷ QUOTE TT 卖出，因此反向不会简单互为倒数。数值越高，表示 1 ${base} 可换得的 ${quote} 越多。`,
      },
      200,
      300,
    );
  } catch (error) {
    console.error("Hong Kong bank comparison API failed", error);
    return json({ error: "Hong Kong bank rates are temporarily unavailable" }, 503, 30);
  }
}

export async function handleHistory(url: URL, env: Env): Promise<Response> {
  const rawBase = url.searchParams.get("base") ?? "HKD";
  const rawQuote = url.searchParams.get("quote") ?? "USD";
  const rawDays = Number(url.searchParams.get("days") ?? "30");
  if (!isCurrencyCode(rawBase) || !isCurrencyCode(rawQuote)) {
    return json({ error: "Unsupported currency pair" }, 400);
  }
  if (!isHistoryWindow(rawDays)) return json({ error: "Unsupported history window" }, 400);
  const base = normalizeCurrency(rawBase);
  const quote = normalizeCurrency(rawQuote);
  if (base === quote) return json({ error: "Base and quote must be different" }, 400);

  const requestedSourceIds = parseHistorySourceIds(url);
  if (requestedSourceIds instanceof Response) return requestedSourceIds;
  const sourceMetadata = requestedSourceIds.map(historySourceMetadata);

  try {
    const series = await Promise.all(
      sourceMetadata.map(async (source) => {
        if (!source) throw new Error("Unsupported history source");
        if (source.id === "market") {
          let marketSeries = null;
          let archivedMarketSeries = null;
          let reason = null;
          try {
            archivedMarketSeries = await readD1History(env.DB, base, quote, rawDays);
            marketSeries = archivedMarketSeries;
            if (marketSeries && !coversRequestedHistoryWindow(marketSeries.points, rawDays)) {
              marketSeries = null;
            }
          } catch (error) {
            console.warn("D1 history unavailable; falling back to reference history", error);
          }
          if (!marketSeries) {
            try {
              marketSeries = await fetchReferenceHistory(base, quote, rawDays);
            } catch (error) {
              if (!archivedMarketSeries) throw error;
              console.warn("Reference history unavailable; using partial D1 history", error);
              marketSeries = archivedMarketSeries;
              reason = "外部历史源暂不可用，当前展示已有归档";
            }
          }
          return {
            id: source.id,
            label: source.label,
            status: "available",
            provider: marketSeries.provider,
            frequency: marketSeries.frequency,
            points: marketSeries.points,
            reason,
          };
        }

        try {
          const points = await readProviderHistory(
            env.DB,
            source.provider,
            base,
            quote,
            rawDays,
            source.allowInverse,
          );
          if (points.length < 2) {
            return {
              id: source.id,
              label: source.label,
              status: "unavailable",
              provider: source.providerLabel,
              frequency: "intraday",
              points: [],
              reason: "真实历史快照仍在积累，至少需要两个数据点",
            };
          }
          return {
            id: source.id,
            label: source.label,
            status: "available",
            provider: source.providerLabel,
            frequency: "intraday",
            points,
            reason: null,
          };
        } catch (error) {
          console.warn(`History source ${source.id} unavailable`, error);
          return {
            id: source.id,
            label: source.label,
            status: "unavailable",
            provider: source.providerLabel,
            frequency: "intraday",
            points: [],
            reason: "历史归档暂不可用",
          };
        }
      }),
    );
    const marketSeries = series.find((item) => item.id === "market" && item.status === "available");
    return json(
      {
        marketType: "reference",
        disclaimer: "Historical public and bank rates are indicative, not guaranteed transaction prices.",
        base,
        quote,
        days: rawDays,
        series,
        points: marketSeries?.points ?? [],
        provider: marketSeries?.provider ?? "Multiple FXPulse sources",
        frequency: marketSeries?.frequency ?? "intraday",
      },
      200,
      300,
    );
  } catch (error) {
    console.error("History API failed", error);
    return json({ error: "Historical reference rates are temporarily unavailable" }, 503, 30);
  }
}

export function coversRequestedHistoryWindow(
  points: Array<{ timestamp: number }>,
  days: number,
  nowEpoch = Math.floor(Date.now() / 1000),
): boolean {
  const daySeconds = 86_400;
  const hongKongOffsetSeconds = 8 * 3_600;
  const validTimestamps = points
    .map((point) => Number(point.timestamp))
    .filter(Number.isFinite);
  const hongKongDays = new Set(
    validTimestamps.map((timestamp) =>
      Math.floor((timestamp + hongKongOffsetSeconds) / daySeconds)
    ),
  );
  if (hongKongDays.size < 2) return false;

  const earliestTimestamp = Math.min(...validTimestamps);
  const requestedStart = nowEpoch - days * daySeconds;
  const coverageTolerance = Math.min(2, Math.max(1, Math.floor(days * 0.15))) * daySeconds;
  return earliestTimestamp <= requestedStart + coverageTolerance;
}

export function shouldCollectBankArchive(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCHours() % 8 === 0;
}

interface HistorySourceMetadata {
  id: string;
  label: string;
  provider: ArchivedProviderId;
  providerLabel: string;
  allowInverse: boolean;
}

function historySourceMetadata(id: string): HistorySourceMetadata | null {
  if (id === "market") {
    return {
      id,
      label: "公共市场",
      provider: "wise",
      providerLabel: "ExchangeRate-API / Frankfurter",
      allowInverse: true,
    };
  }
  if (id === "wise") {
    return {
      id,
      label: "Wise 中间价",
      provider: "wise",
      providerLabel: "FXPulse archive · Wise",
      allowInverse: true,
    };
  }
  if (id === "hsbc_public") {
    return {
      id,
      label: "汇丰公开 TT",
      provider: "hsbc_public",
      providerLabel: "FXPulse archive · HSBC Hong Kong",
      allowInverse: false,
    };
  }
  const bankId = id.match(/^bank_([a-z0-9]+)$/)?.[1];
  const bank = HONG_KONG_BANKS.find((item) => item.id === bankId);
  if (!bank) return null;
  return {
    id,
    label: bank.name,
    provider: bankProviderId(bank.id),
    providerLabel: `FXPulse archive · ${bank.name}`,
    allowInverse: false,
  };
}

function bankProviderId(id: string): ArchivedProviderId {
  return `bank_${id}`;
}

function parsePagePair(pathname: string): { base: CurrencyCode; quote: CurrencyCode } | null {
  if (pathname === "/" || pathname === "") return { base: "HKD", quote: "USD" };
  const match = pathname.match(/^\/rates\/([a-zA-Z]{3})\/([a-zA-Z]{3})\/?$/);
  if (!match) return null;
  const rawBase = match[1];
  const rawQuote = match[2];
  if (!isCurrencyCode(rawBase) || !isCurrencyCode(rawQuote)) return null;
  const base = normalizeCurrency(rawBase);
  const quote = normalizeCurrency(rawQuote);
  if (base === quote) return { base, quote: defaultQuote(base) };
  return { base, quote };
}

function parseApiPair(url: URL): { base: CurrencyCode; quote: CurrencyCode } | Response {
  const rawBase = url.searchParams.get("base") ?? "HKD";
  const rawQuote = url.searchParams.get("quote") ?? "USD";
  if (!isCurrencyCode(rawBase) || !isCurrencyCode(rawQuote)) {
    return json({ error: "Unsupported currency pair" }, 400);
  }
  const base = normalizeCurrency(rawBase);
  const quote = normalizeCurrency(rawQuote);
  if (base === quote) return json({ error: "Base and quote must be different" }, 400);
  return { base, quote };
}

export function parseOverviewSourceIds(url: URL): string[] | Response {
  const ids = [
    ...new Set(
      (url.searchParams.get("sources") ?? "")
        .split(",")
        .map((source) => source.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length > HONG_KONG_BANKS.length) {
    return json({ error: "Too many overview sources" }, 400);
  }
  for (const id of ids) {
    if (id === "hsbc_public") continue;
    const bankId = id.match(/^bank_([a-z0-9]+)$/)?.[1];
    if (!bankId || bankId === "hsbc" || !HONG_KONG_BANKS.some((bank) => bank.id === bankId)) {
      return json({ error: "Unsupported overview source" }, 400);
    }
  }
  return ids;
}

export function parseHistorySourceIds(url: URL): string[] | Response {
  const fixedSourceIds = ["market", "wise"];
  const requestedIds = [
    ...new Set(
      (url.searchParams.get("sources") ?? "")
        .split(",")
        .map((source) => source.trim())
        .filter(Boolean),
    ),
  ];
  const extras = requestedIds.filter((id) => !fixedSourceIds.includes(id));
  if (extras.length > 5) return json({ error: "Too many history sources" }, 400);
  if (requestedIds.some((id) => historySourceMetadata(id) === null)) {
    return json({ error: "Unsupported history source" }, 400);
  }
  return [...fixedSourceIds, ...extras];
}

async function safeReadProviderQuote(
  db: D1Database,
  provider: ArchivedProviderId,
  base: CurrencyCode,
  quote: CurrencyCode,
): Promise<ProviderRateQuote | null> {
  try {
    return await readLatestProviderQuote(db, provider, base, quote);
  } catch (error) {
    console.warn(`Stored ${provider} quote unavailable`, error);
    return null;
  }
}

function serializeBankOverviewSource(
  id: string,
  label: string,
  quote: ProviderRateQuote | null,
  marketRate: number,
): Record<string, unknown> {
  if (!quote) {
    return {
      id,
      label,
      rateType: "public_tt_rate",
      status: "unavailable",
      rate: null,
      differenceFromMarketPct: null,
      sourceUpdatedAt: null,
      observedAt: null,
      provider: "Hong Kong bank public TT aggregation",
      providerUrl: "https://yoyorate.com/",
      reason: "当前币种方向没有可验证的完整 TT 买入及卖出价",
      basis: null,
    };
  }

  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - quote.observedAt);
  const sourceUrl = typeof quote.metadata.sourceUrl === "string"
    ? quote.metadata.sourceUrl
    : "https://yoyorate.com/";
  return {
    id,
    label,
    rateType: quote.rateType,
    status: ageSeconds <= 7_200 ? "available" : "stale",
    rate: quote.rate,
    differenceFromMarketPct: percentDifference(quote.rate, marketRate),
    sourceUpdatedAt: new Date(quote.sourceUpdatedAt * 1000).toISOString(),
    observedAt: new Date(quote.observedAt * 1000).toISOString(),
    provider: String(quote.metadata.source ?? "YoYoRate"),
    providerUrl: sourceUrl,
    reason: ageSeconds <= 7_200 ? null : "实时聚合暂不可用，当前显示最近一次归档",
    basis: quote.metadata.calculation ?? null,
  };
}

function serializeProviderSource(
  id: ProviderId,
  quote: ProviderRateQuote | null,
  marketRate: number,
  label: string,
  providerUrl: string,
  unavailableReason: string,
): Record<string, unknown> {
  if (!quote) {
    return {
      id,
      label,
      rateType: id === "wise" ? "mid_market" : "public_tt_rate",
      status: "unavailable",
      rate: null,
      differenceFromMarketPct: null,
      sourceUpdatedAt: null,
      observedAt: null,
      provider: id === "wise" ? "Wise" : "HSBC Hong Kong",
      providerUrl,
      reason: unavailableReason,
      basis: null,
    };
  }

  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - quote.observedAt);
  return {
    id: quote.provider,
    label,
    rateType: quote.rateType,
    status: ageSeconds <= 1800 ? "available" : "stale",
    rate: quote.rate,
    differenceFromMarketPct: percentDifference(quote.rate, marketRate),
    sourceUpdatedAt: new Date(quote.sourceUpdatedAt * 1000).toISOString(),
    observedAt: new Date(quote.observedAt * 1000).toISOString(),
    provider: quote.provider === "wise" ? "Wise" : "HSBC Hong Kong",
    providerUrl,
    reason: ageSeconds <= 1800 ? null : "实时接口暂不可用，当前显示最近一次归档",
    basis: quote.metadata.calculation ?? null,
  };
}

function serializeMarketSource(
  marketSnapshot: Awaited<ReturnType<typeof fetchCurrentSnapshot>>,
  quote: CurrencyCode,
): Record<string, unknown> {
  return {
    id: "market",
    label: "公共市场",
    rateType: "reference",
    status: "available",
    rate: marketSnapshot.rates[quote],
    differenceFromMarketPct: 0,
    sourceUpdatedAt: new Date(marketSnapshot.sourceUpdatedAt * 1000).toISOString(),
    observedAt: new Date(marketSnapshot.fetchedAt * 1000).toISOString(),
    provider: marketSnapshot.provider,
    providerUrl: marketSnapshot.providerUrl,
    reason: null,
  };
}

function numberMetadata(value: string | number | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function json(payload: unknown, status = 200, maxAge = 0): Response {
  return secure(
    Response.json(payload, {
      status,
      headers: {
        "cache-control": maxAge
          ? `public, max-age=30, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`
          : "no-store",
      },
    }),
  );
}

function textResponse(body: string, contentType: string, maxAge: number): Response {
  return secure(
    new Response(body, {
      headers: {
        "content-type": contentType,
        "cache-control": `public, max-age=3600, s-maxage=${maxAge}`,
      },
    }),
  );
}

function secure(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  return secured;
}
