import { describe, expect, it } from "vitest";
import { isCurrencyCode, isHistoryWindow, normalizeCurrency } from "../src/currencies";
import {
  HONG_KONG_BANKS,
  collectHongKongBankPairs,
  deriveHongKongBankPair,
  parseYoYoRateTtPage,
} from "../src/bank-rates";
import { deriveCrossRate, fetchCurrentSnapshot, fetchReferenceHistory } from "../src/rates";
import {
  deriveHsbcPublicPair,
  fetchWisePair,
  percentDifference,
  readProviderHistory,
} from "../src/provider-rates";
import { renderPage, renderSitemap } from "../src/template";
import { handleHistory } from "../src/index";

describe("currency validation", () => {
  it("accepts supported codes case-insensitively", () => {
    expect(isCurrencyCode("hkd")).toBe(true);
    expect(normalizeCurrency("hkd")).toBe("HKD");
    expect(isCurrencyCode("THB")).toBe(false);
  });

  it("limits supported history windows", () => {
    expect(isHistoryWindow(15)).toBe(true);
    expect(isHistoryWindow(14)).toBe(false);
  });
});

describe("cross rates", () => {
  it("derives a pair from a USD-anchored table", () => {
    const rate = deriveCrossRate({ HKD: 7.8, AUD: 1.5 }, "HKD", "AUD");
    expect(rate).toBeCloseTo(1.5 / 7.8, 10);
  });

  it("handles USD as either side", () => {
    expect(deriveCrossRate({ HKD: 7.8 }, "USD", "HKD")).toBe(7.8);
    expect(deriveCrossRate({ HKD: 7.8 }, "HKD", "USD")).toBeCloseTo(1 / 7.8, 10);
  });
});

describe("provider adapters", () => {
  it("collects all available directed bank pairs from ten currency pages", async () => {
    const rows = HONG_KONG_BANKS.map(
      (bank, index) => `<tr>
        <td><a href="/store/hk/${bank.id}/hkd">${bank.name}</a></td>
        <td data-selected-rate="${(5 + index * 0.01).toFixed(5)}"></td>
        <td data-selected-rate="${(5.08 + index * 0.01).toFixed(5)}"></td>
      </tr>`,
    ).join("");
    const requested: string[] = [];
    const pairs = await collectHongKongBankPairs(async (input) => {
      requested.push(String(input));
      return new Response(`<table>${rows}</table>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    expect(requested).toHaveLength(10);
    expect(pairs).toHaveLength(11 * 10 * HONG_KONG_BANKS.length);
    expect(
      pairs.filter(({ base, quote }) => base === "USD" && quote === "AUD"),
    ).toHaveLength(18);
  });

  it("reads directional provider history and only inverts when explicitly allowed", async () => {
    const rows = [
      {
        provider: "wise",
        base: "USD",
        quote: "AUD",
        rate: 1.42,
        rate_type: "mid_market",
        observed_at: 1_785_846_600,
        source_updated_at: 1_785_846_590,
        metadata_json: "{}",
      },
      {
        provider: "wise",
        base: "USD",
        quote: "AUD",
        rate: 1.43,
        rate_type: "mid_market",
        observed_at: 1_785_850_200,
        source_updated_at: 1_785_850_190,
        metadata_json: "{}",
      },
    ];
    const db = {
      prepare: () => ({
        bind: (_provider: string, base: string, quote: string) => ({
          all: async () => ({ results: base === "USD" && quote === "AUD" ? rows : [] }),
        }),
      }),
    } as never;

    const inverted = await readProviderHistory(
      db,
      "wise",
      "AUD",
      "USD",
      30,
      true,
      1_785_850_300,
    );
    expect(inverted).toHaveLength(2);
    expect(inverted[0]?.rate).toBeCloseTo(1 / 1.42, 10);

    const directionalOnly = await readProviderHistory(
      db,
      "hsbc_public",
      "AUD",
      "USD",
      30,
      false,
      1_785_850_300,
    );
    expect(directionalOnly).toHaveLength(0);
  });

  it("parses published TT buy and sell rates for known Hong Kong banks", () => {
    const html = `
      <table>
        <tr>
          <td><a href="/store/hk/hsbc/hkd">HSBC</a></td>
          <td data-selected-rate="5.48660"></td>
          <td data-selected-rate="5.56470"></td>
          <td data-selected-rate="5.50000"></td>
        </tr>
        <tr>
          <td><a href="/store/hk/boc/hkd">BOC</a></td>
          <td data-selected-rate="5.49000"></td>
          <td data-selected-rate="10000000"></td>
        </tr>
        <tr>
          <td><a href="/store/hk/not-supported/hkd">Unknown</a></td>
          <td data-selected-rate="9.99"></td>
          <td data-selected-rate="10.01"></td>
        </tr>
      </table>`;

    const legs = parseYoYoRateTtPage(html, "AUD", 1_785_915_000);
    expect(legs).toHaveLength(2);
    expect(legs.get("hsbc")).toMatchObject({
      currency: "AUD",
      ttBuyHkd: 5.4866,
      ttSellHkd: 5.5647,
      observedAt: 1_785_915_000,
    });
    expect(legs.get("boc")?.ttSellHkd).toBeNull();
  });

  it("derives directional TT cross-rates for every bank without taking reciprocals", () => {
    const bank = HONG_KONG_BANKS.find(({ id }) => id === "boc");
    expect(bank).toBeDefined();
    const audLeg = {
      bankId: "boc" as const,
      currency: "AUD" as const,
      ttBuyHkd: 5.48,
      ttSellHkd: 5.56,
      observedAt: 1_785_915_000,
      sourceUrl: "https://example.com/aud",
    };
    const usdLeg = {
      bankId: "boc" as const,
      currency: "USD" as const,
      ttBuyHkd: 7.81,
      ttSellHkd: 7.88,
      observedAt: 1_785_914_000,
      sourceUrl: "https://example.com/usd",
    };

    const audUsd = deriveHongKongBankPair(bank!, "AUD", "USD", audLeg, usdLeg, 0.704);
    const usdAud = deriveHongKongBankPair(bank!, "USD", "AUD", usdLeg, audLeg, 1.42);
    expect(audUsd.rate).toBeCloseTo(5.48 / 7.88, 10);
    expect(usdAud.rate).toBeCloseTo(7.81 / 5.56, 10);
    expect((audUsd.rate ?? 0) * (usdAud.rate ?? 0)).toBeLessThan(1);
    expect(audUsd.basis).toBe("AUD TT 买入 ÷ USD TT 卖出");
    expect(audUsd.observedAt).toBe(1_785_914_000);
  });

  it("keeps banks visible when one published TT leg is unavailable", () => {
    const bank = HONG_KONG_BANKS.find(({ id }) => id === "boc");
    expect(bank).toBeDefined();
    const quote = deriveHongKongBankPair(bank!, "AUD", "USD", null, null, 0.704);
    expect(quote.status).toBe("unavailable");
    expect(quote.rate).toBeNull();
    expect(quote.reason).toContain("AUD TT 买入价");
    expect(quote.reason).toContain("USD TT 卖出价");
  });

  it("normalizes the current-rate payload", async () => {
    const rates = Object.fromEntries(
      ["AUD", "CAD", "CHF", "CNY", "EUR", "GBP", "HKD", "JPY", "NZD", "SGD", "USD"].map(
        (code) => [code, 1],
      ),
    );
    rates.AUD = 1.5;
    rates.HKD = 7.8;
    const fetcher = async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/latest/USD");
      return Response.json({
        result: "success",
        time_last_update_unix: 1_700_000_000,
        base_code: "USD",
        rates,
      });
    };

    const snapshot = await fetchCurrentSnapshot("HKD", fetcher as typeof fetch);
    expect(snapshot.base).toBe("HKD");
    expect(snapshot.rates.HKD).toBe(1);
    expect(snapshot.rates.USD).toBeCloseTo(1 / 7.8, 10);
    expect(snapshot.rates.AUD).toBeCloseTo(1.5 / 7.8, 10);
    expect(snapshot.sourceUpdatedAt).toBe(1_700_000_000);
  });

  it("normalizes Frankfurter v2 rows", async () => {
    const fetcher = async () =>
      Response.json([
        { date: "2026-08-01", base: "HKD", quote: "USD", rate: 0.127 },
        { date: "2026-08-02", base: "HKD", quote: "USD", rate: 0.128 },
      ]);
    const history = await fetchReferenceHistory(
      "HKD",
      "USD",
      7,
      fetcher as typeof fetch,
      new Date("2026-08-04T00:00:00Z"),
    );
    expect(history.frequency).toBe("daily");
    expect(history.points).toHaveLength(2);
    expect(history.points[1]?.rate).toBe(0.128);
  });

  it("normalizes the anonymous Wise public pair response", async () => {
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toContain("wise.com/rates/live?source=AUD&target=USD");
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      return Response.json({
        source: "AUD",
        target: "USD",
        value: 0.70435,
        time: 1_785_914_423_771,
      });
    };
    const quote = await fetchWisePair("AUD", "USD", fetcher as typeof fetch);
    expect(quote.provider).toBe("wise");
    expect(quote.rateType).toBe("mid_market");
    expect(quote.rate).toBe(0.70435);
    expect(quote.sourceUpdatedAt).toBe(1_785_914_423);
  });

  it("derives directional HSBC TT cross-rates through HKD", () => {
    const payload = {
      detailRates: [
        {
          lastUpdateDate: "2026-08-05 15:14:42 +0800",
          ccy: "USD",
          ttBuyRt: "7.81110",
          ttSelRt: "7.87570",
        },
        {
          lastUpdateDate: "2026-08-05 15:14:42 +0800",
          ccy: "AUD",
          ttBuyRt: "5.48660",
          ttSelRt: "5.56470",
        },
      ],
    };
    const usdAud = deriveHsbcPublicPair(payload, "USD", "AUD", 1_785_915_000);
    const audUsd = deriveHsbcPublicPair(payload, "AUD", "USD", 1_785_915_000);
    expect(usdAud.provider).toBe("hsbc_public");
    expect(usdAud.rateType).toBe("public_tt_rate");
    expect(usdAud.rate).toBeCloseTo(7.8111 / 5.5647, 10);
    expect(audUsd.rate).toBeCloseTo(5.4866 / 7.8757, 10);
    expect(usdAud.rate * audUsd.rate).toBeLessThan(1);
    expect(usdAud.metadata.calculation).toBe("USD TT Buy ÷ AUD TT Sell");
    expect(usdAud.sourceUpdatedAt).toBe(
      Math.floor(Date.parse("2026-08-05T15:14:42+08:00") / 1000),
    );
  });

  it("uses the correct HSBC TT side when HKD is one leg", () => {
    const payload = {
      detailRates: [
        {
          lastUpdateDate: "2026-08-05 15:14:42 +0800",
          ccy: "AUD",
          ttBuyRt: "5.48660",
          ttSelRt: "5.56470",
        },
      ],
    };
    expect(deriveHsbcPublicPair(payload, "AUD", "HKD").rate).toBe(5.4866);
    expect(deriveHsbcPublicPair(payload, "HKD", "AUD").rate).toBeCloseTo(1 / 5.5647, 10);
  });

  it("calculates provider differences against one market direction", () => {
    expect(percentDifference(0.7044, 0.703706)).toBeCloseTo(0.09862, 4);
    expect(percentDifference(null, 0.703706)).toBeNull();
  });
});

describe("search surfaces", () => {
  it("publishes the homepage and all 110 directed currency pairs", () => {
    const sitemap = renderSitemap("https://fxpulse.example");
    expect(sitemap.match(/<url>/g)).toHaveLength(111);
    expect(sitemap).toContain("/rates/hkd/usd");
    expect(sitemap).not.toContain("/rates/hkd/hkd");
  });

  it("renders the standalone calculator, labelled reversal and three-source overview", () => {
    const html = renderPage({
      origin: "https://fxpulse.example",
      base: "AUD",
      quote: "USD",
      snapshot: {
        base: "AUD",
        provider: "ExchangeRate-API",
        providerUrl: "https://www.exchangerate-api.com/",
        sourceUpdatedAt: 1_785_846_600,
        fetchedAt: 1_785_846_700,
        rates: Object.fromEntries(
          ["AUD", "CAD", "CHF", "CNY", "EUR", "GBP", "HKD", "JPY", "NZD", "SGD", "USD"].map(
            (code, index) => [code, index + 1],
          ),
        ) as never,
      },
    });
    expect(html).toContain('id="base-amount"');
    expect(html).toContain('id="quote-currency"');
    expect(html).toContain('id="converted-amount"');
    expect(html).toContain('id="calculator-source"');
    expect(html).toContain('<option value="market" selected>公共市场参考价（默认）</option>');
    expect(html.match(/<option value="bank_[a-z0-9]+">/g)).toHaveLength(18);
    expect(html).toContain('id="swap-pair"');
    expect(html).toContain('id="swap-label">AUD / USD');
    expect(html).toContain('id="overview-swap"');
    expect(html).toContain('id="overview-swap-label">USD/AUD');
    const overview = html.slice(html.indexOf('id="rate-grid"'));
    expect(overview.indexOf('data-currency="USD"')).toBeLessThan(
      overview.indexOf('data-currency="CAD"'),
    );
    expect(overview).toContain("当前目标 · 1 AUD → USD");
    expect(html).toContain('id="comparison-grid"');
    expect(html).toContain('data-source="wise"');
    expect(html).toContain('data-source="hsbc_public"');
    expect(html).toContain('id="banks"');
    expect(html).toContain('id="bank-table-body"');
    expect(html).toContain('id="bank-best"');
    expect(html).toContain("18 家银行牌价");
    expect(html.match(/data-overview-rate="market"/g)).toHaveLength(10);
    expect(html.match(/data-overview-rate="wise"/g)).toHaveLength(10);
    expect(html.match(/data-overview-rate="hsbc_public"/g)).toHaveLength(10);
    expect(html).toContain("1 AUD 兑换其他币种 · 三源报价");
    expect(html).toContain("金额只用于本计算器");
    expect(html).toContain("汇丰公开牌价（TT）");
    expect(html).toContain('data-chart-type="line"');
    expect(html).toContain('data-chart-type="bar"');
    expect(html.match(/data-history-source/g)).toHaveLength(21);
    expect(html).toContain("历史数据源（可多选）");
    expect(html).toContain("本站数据须经书面授权方可使用");
    expect(html).toContain("未经授权使用将被视为侵权");
    expect(html).toContain("https://github.com/wxywizard/FXPulse");
  });
});

describe("multi-source history API", () => {
  it("returns independent market, Wise and bank series without substituting missing banks", async () => {
    const timestamps = [1_785_830_000, 1_785_833_600, 1_785_837_200, 1_785_840_800];
    const marketRows = timestamps.flatMap((observed_at, index) => [
      { quote: "AUD", rate: 1.42 + index * 0.001, observed_at },
      { quote: "USD", rate: 1, observed_at },
    ]);
    const providerRows = (provider: string, rate: number) =>
      timestamps.slice(0, 2).map((observed_at, index) => ({
        provider,
        base: "AUD",
        quote: "USD",
        rate: rate + index * 0.0001,
        rate_type: provider === "wise" ? "mid_market" : "public_tt_rate",
        observed_at,
        source_updated_at: observed_at,
        metadata_json: "{}",
      }));
    const db = {
      prepare: (query: string) => ({
        bind: (...args: unknown[]) => ({
          all: async () => {
            if (query.includes("FROM rate_snapshots")) return { results: marketRows };
            const provider = String(args[0]);
            if (provider === "wise") return { results: providerRows("wise", 0.704) };
            if (provider === "hsbc_public") {
              return { results: providerRows("hsbc_public", 0.696) };
            }
            return { results: [] };
          },
        }),
      }),
    } as never;

    const response = await handleHistory(
      new URL(
        "https://fxpulse.example/api/history?base=AUD&quote=USD&days=30&sources=market,wise,hsbc_public,bank_boc",
      ),
      { DB: db } as never,
    );
    const payload = (await response.json()) as {
      series: Array<{ id: string; status: string; points: unknown[]; reason: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(payload.series).toHaveLength(4);
    expect(payload.series.find((series) => series.id === "market")?.points).toHaveLength(4);
    expect(payload.series.find((series) => series.id === "wise")?.status).toBe("available");
    expect(payload.series.find((series) => series.id === "hsbc_public")?.status).toBe(
      "available",
    );
    const bank = payload.series.find((series) => series.id === "bank_boc");
    expect(bank?.status).toBe("unavailable");
    expect(bank?.points).toHaveLength(0);
    expect(bank?.reason).toContain("真实历史快照仍在积累");
  });

  it("rejects unknown history sources", async () => {
    const response = await handleHistory(
      new URL(
        "https://fxpulse.example/api/history?base=AUD&quote=USD&days=30&sources=market,bank_unknown",
      ),
      { DB: {} } as never,
    );
    expect(response.status).toBe(400);
  });
});
