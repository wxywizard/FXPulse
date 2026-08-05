import { describe, expect, it } from "vitest";
import { isCurrencyCode, isHistoryWindow, normalizeCurrency } from "../src/currencies";
import { deriveCrossRate, fetchCurrentSnapshot, fetchReferenceHistory } from "../src/rates";
import { renderSitemap } from "../src/template";

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
});

describe("search surfaces", () => {
  it("publishes the homepage and all 110 directed currency pairs", () => {
    const sitemap = renderSitemap("https://fxpulse.example");
    expect(sitemap.match(/<url>/g)).toHaveLength(111);
    expect(sitemap).toContain("/rates/hkd/usd");
    expect(sitemap).not.toContain("/rates/hkd/hkd");
  });
});
