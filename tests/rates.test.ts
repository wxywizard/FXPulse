import { describe, expect, it } from "vitest";
import { isCurrencyCode, isHistoryWindow, normalizeCurrency } from "../src/currencies";
import { deriveCrossRate, fetchCurrentSnapshot, fetchReferenceHistory } from "../src/rates";
import {
  deriveHsbcPublicPair,
  fetchWisePair,
  percentDifference,
} from "../src/provider-rates";
import { renderPage, renderSitemap } from "../src/template";

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

  it("renders the standalone calculator, pair reversal and three-source comparison", () => {
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
    expect(html).toContain('id="swap-pair"');
    expect(html).toContain('id="comparison-grid"');
    expect(html).toContain('data-source="wise"');
    expect(html).toContain('data-source="hsbc_public"');
    expect(html).toContain("金额只用于本计算器");
    expect(html).toContain("汇丰公开牌价（TT）");
  });
});
