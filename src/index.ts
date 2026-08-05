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
  fetchCurrentSnapshot,
  fetchReferenceHistory,
  readD1History,
  storeSnapshot,
} from "./rates";
import {
  collectHsbcPublicQuotes,
  collectWiseUsdQuotes,
  fetchHsbcPublicPair,
  fetchWisePair,
  percentDifference,
  readLatestProviderQuote,
  readProviderHistory,
  storeProviderQuote,
  storeProviderQuotes,
  type ArchivedProviderId,
  type ProviderId,
  type ProviderRateQuote,
} from "./provider-rates";
import {
  HONG_KONG_BANKS,
  compareBankQuotes,
  fetchHongKongBankPair,
  type HongKongBankQuote,
} from "./bank-rates";
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
      return handleCurrentRates(url);
    }

    if (url.pathname === "/api/compare") {
      return handleComparison(url, env, ctx);
    }

    if (url.pathname === "/api/overview") {
      return handleOverview(url, env, ctx);
    }

    if (url.pathname === "/api/banks") {
      return handleBankComparison(url, env, ctx);
    }

    if (url.pathname === "/api/history") {
      return handleHistory(url, env);
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
        const snapshot = await fetchCurrentSnapshot("USD");
        await storeSnapshot(env.DB, snapshot);
        console.log("Stored FX snapshot", {
          fetchedAt: snapshot.fetchedAt,
          sourceUpdatedAt: snapshot.sourceUpdatedAt,
          currencies: CURRENCY_CODES.length,
        });

        const hsbcQuotes = await collectHsbcPublicQuotes().catch((error) => {
          console.warn("HSBC public snapshot collection skipped", error);
          return [];
        });
        const wiseQuotes =
          new Date(controller.scheduledTime).getUTCMinutes() === 0
            ? await collectWiseUsdQuotes().catch((error) => {
                console.warn("Wise public snapshot collection skipped", error);
                return [];
              })
            : [];
        try {
          await storeProviderQuotes(env.DB, [...hsbcQuotes, ...wiseQuotes]);
          console.log("Stored provider snapshots", {
            hsbc: hsbcQuotes.length,
            wise: wiseQuotes.length,
          });
        } catch (error) {
          console.warn("Provider snapshot storage skipped", error);
        }

        const cutoff = snapshot.fetchedAt - 400 * 86_400;
        try {
          await env.DB
            .prepare("DELETE FROM provider_rate_snapshots WHERE observed_at < ?1")
            .bind(cutoff)
            .run();
        } catch (error) {
          console.warn("Provider snapshot cleanup skipped", error);
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

async function handleComparison(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
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
    if (liveWise) {
      ctx.waitUntil(
        storeProviderQuote(env.DB, liveWise).catch((error) =>
          console.warn("Wise snapshot store failed", error),
        ),
      );
    }
    if (liveHsbc) {
      ctx.waitUntil(
        storeProviderQuote(env.DB, liveHsbc).catch((error) =>
          console.warn("HSBC public snapshot store failed", error),
        ),
      );
    }

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

async function handleOverview(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const rawBase = url.searchParams.get("base") ?? "HKD";
  if (!isCurrencyCode(rawBase)) return json({ error: "Unsupported base currency" }, 400);
  const base = normalizeCurrency(rawBase);
  const targets = CURRENCY_CODES.filter((currency) => currency !== base);

  try {
    const wisePromise = Promise.all(
      targets.map((quote) =>
        fetchWisePair(base, quote).catch((error) => {
          console.warn(`Wise public overview quote unavailable for ${base}/${quote}`, error);
          return null;
        }),
      ),
    );
    const hsbcPromise = collectHsbcPublicQuotes()
      .then((quotes) => quotes.filter((quote) => quote.base === base))
      .catch((error) => {
        console.warn(`HSBC public overview quotes unavailable for ${base}`, error);
        return [];
      });
    const [marketSnapshot, liveWiseQuotes, liveHsbcQuotes] = await Promise.all([
      fetchCurrentSnapshot(base),
      wisePromise,
      hsbcPromise,
    ]);

    const liveWise = new Map(
      liveWiseQuotes
        .filter((quote): quote is ProviderRateQuote => quote !== null)
        .map((quote) => [quote.quote, quote]),
    );
    const liveHsbc = new Map(liveHsbcQuotes.map((quote) => [quote.quote, quote]));

    const missingWise = targets.filter((quote) => !liveWise.has(quote));
    const missingHsbc = targets.filter((quote) => !liveHsbc.has(quote));
    const [storedWiseQuotes, storedHsbcQuotes] = await Promise.all([
      Promise.all(missingWise.map((quote) => safeReadProviderQuote(env.DB, "wise", base, quote))),
      Promise.all(
        missingHsbc.map((quote) => safeReadProviderQuote(env.DB, "hsbc_public", base, quote)),
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

    const liveQuotes = [...liveWise.values(), ...liveHsbc.values()];
    if (liveQuotes.length > 0) {
      ctx.waitUntil(
        storeProviderQuotes(env.DB, liveQuotes).catch((error) =>
          console.warn("Overview provider snapshot store failed", error),
        ),
      );
    }

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
          serializeProviderSource(
            "hsbc_public",
            liveHsbc.get(quote) ?? storedHsbc.get(quote) ?? null,
            marketRate,
            "汇丰 TT",
            "https://www.hsbc.com.hk/investments/products/foreign-exchange/currency-rate/",
            "汇丰公开牌价暂不可用",
          ),
        ],
      };
    });

    return json(
      {
        base,
        unit: 1,
        sources: ["market", "wise", "hsbc_public"],
        pairs,
        interpretation:
          "每个币种均按同一方向并列公共市场、Wise 与汇丰公开 TT 牌价；汇丰包含买卖价差。",
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
  ctx: ExecutionContext,
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

    if (availableBanks.length > 0) {
      const currentEpoch = Math.floor(Date.now() / 1000);
      const observedAt = Math.floor(currentEpoch / 3_600) * 3_600;
      ctx.waitUntil(
        storeProviderQuotes(
          env.DB,
          availableBanks.map((bank) => ({
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
          })),
        ).catch((error) => console.warn("Bank snapshot storage skipped", error)),
      );
    }

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
          note: "聚合香港银行公开电汇买卖价；汇丰一行由汇丰香港官方公开接口校准。",
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

  const requestedSourceIds = [
    ...new Set(
      (url.searchParams.get("sources") ?? "market")
        .split(",")
        .map((source) => source.trim())
        .filter(Boolean),
    ),
  ];
  const sourceMetadata = requestedSourceIds.map(historySourceMetadata);
  if (sourceMetadata.some((source) => source === null)) {
    return json({ error: "Unsupported history source" }, 400);
  }

  try {
    const series = await Promise.all(
      sourceMetadata.map(async (source) => {
        if (!source) throw new Error("Unsupported history source");
        if (source.id === "market") {
          let marketSeries = null;
          try {
            marketSeries = await readD1History(env.DB, base, quote, rawDays);
          } catch (error) {
            console.warn("D1 history unavailable; falling back to reference history", error);
          }
          marketSeries ??= await fetchReferenceHistory(base, quote, rawDays);
          return {
            id: source.id,
            label: source.label,
            status: "available",
            provider: marketSeries.provider,
            frequency: marketSeries.frequency,
            points: marketSeries.points,
            reason: null,
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

async function safeReadProviderQuote(
  db: D1Database,
  provider: ProviderId,
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
