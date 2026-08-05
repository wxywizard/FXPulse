import { describe, expect, it } from "vitest";
import { isCurrencyCode, isHistoryWindow, normalizeCurrency } from "../src/currencies";
import { deriveCrossRate, fetchCurrentSnapshot, fetchReferenceHistory } from "../src/rates";
import {
  fetchWisePair,
  parseHsbcDepositPlusInput,
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
        (code, index) => [code, index + 1],
      ),
    );
    const fetcher = async () =>
      Response.json({
        result: "success",
        time_last_update_unix: 1_700_000_000,
        base_code: "HKD",
        rates,
      });

    const snapshot = await fetchCurrentSnapshot("HKD", fetcher as typeof fetch);
    expect(snapshot.base).toBe("HKD");
    expect(snapshot.rates.USD).toBe(11);
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

  it("normalizes an authenticated Wise pair response", async () => {
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer wise-test-token");
      return Response.json([
        { source: "AUD", target: "USD", rate: 0.7041, time: "2026-08-04T12:30:00+0000" },
      ]);
    };
    const quote = await fetchWisePair("AUD", "USD", "wise-test-token", fetcher as typeof fetch);
    expect(quote.provider).toBe("wise");
    expect(quote.rateType).toBe("mid_market");
    expect(quote.rate).toBe(0.7041);
    expect(quote.sourceUpdatedAt).toBe(1_785_846_600);
  });

  it("accepts only whitelisted HSBC Deposit Plus quote fields", () => {
    const quote = parseHsbcDepositPlusInput(
      {
        base: "aud",
        quote: "usd",
        exchangeSpotRate: 0.7044,
        conversionRate: 0.701,
        interestRate: 6.5,
        depositPeriod: "1W",
        dspSession: "must-not-be-stored",
        accountNumber: "must-not-be-stored",
      },
      1_785_888_000,
    );
    expect(quote.base).toBe("AUD");
    expect(quote.quote).toBe("USD");
    expect(quote.rate).toBe(0.7044);
    expect(quote.metadata).toEqual({ conversionRate: 0.701, interestRate: 6.5, depositPeriod: "1W" });
    expect(quote.metadata).not.toHaveProperty("dspSession");
    expect(quote.metadata).not.toHaveProperty("accountNumber");
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
    expect(html).toContain('data-source="hsbc_deposit_plus"');
    expect(html).toContain("金额只用于本计算器");
  });
});
