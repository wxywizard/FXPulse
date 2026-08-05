import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Vite exposes public assets as raw strings to the test runner.
import appScript from "../public/app.js?raw";
import {
  CURRENCY_CODES,
  isCurrencyCode,
  isHistoryWindow,
  normalizeCurrency,
} from "../src/currencies";
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
import {
  coversRequestedHistoryWindow,
  handleHistory,
  handleOverview,
  parseHistorySourceIds,
  parseOverviewSourceIds,
} from "../src/index";

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

describe("overview source validation", () => {
  it("deduplicates connected anonymous sources and rejects unregistered banks", async () => {
    expect(
      parseOverviewSourceIds(
        new URL("https://fxpulse.example/api/overview?sources=hsbc_public,bank_boc,bank_boc"),
      ),
    ).toEqual(["hsbc_public", "bank_boc"]);

    const unsupported = parseOverviewSourceIds(
      new URL("https://fxpulse.example/api/overview?sources=bank_za"),
    );
    expect(unsupported).toBeInstanceOf(Response);
    expect((unsupported as Response).status).toBe(400);
    expect(await (unsupported as Response).json()).toEqual({ error: "Unsupported overview source" });
  });

  it("returns the two pinned sources plus only the requested connected extras", async () => {
    const usdRates = Object.fromEntries(
      CURRENCY_CODES.map((code, index) => [code, code === "USD" ? 1 : 0.75 + index * 0.21]),
    );
    const bankRows = HONG_KONG_BANKS.map(
      (bank, index) => `<tr>
        <td><a href="/store/hk/${bank.id}/hkd">${bank.name}</a></td>
        <td data-selected-rate="${(5 + index * 0.01).toFixed(5)}"></td>
        <td data-selected-rate="${(5.08 + index * 0.01).toFixed(5)}"></td>
      </tr>`,
    ).join("");
    const requestedUrls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedUrls.push(url.toString());
      if (url.hostname === "open.er-api.com") {
        return Response.json({
          result: "success",
          base_code: "USD",
          time_last_update_unix: 1_785_830_000,
          rates: usdRates,
        });
      }
      if (url.hostname === "wise.com") {
        const source = url.searchParams.get("source") ?? "";
        const target = url.searchParams.get("target") ?? "";
        return Response.json({
          source,
          target,
          value: Number(usdRates[target]) / Number(usdRates[source]),
          time: 1_785_830_000_000,
        });
      }
      if (url.hostname === "rbwm-api.hsbc.com.hk") {
        return Response.json({
          detailRates: CURRENCY_CODES.filter((code) => code !== "HKD").map((code, index) => ({
            ccy: code,
            ttBuyRt: String(5 + index * 0.1),
            ttSelRt: String(5.08 + index * 0.1),
            lastUpdateDate: "2026-08-05 17:00:00 +0800",
          })),
        });
      }
      if (url.hostname === "yoyorate.com") {
        return new Response(`<table>${bankRows}</table>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const stored: Promise<unknown>[] = [];
    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => null }),
      }),
      batch: async () => [],
    } as never;
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => stored.push(promise),
    } as unknown as ExecutionContext;

    try {
      const response = await handleOverview(
        new URL(
          "https://fxpulse.example/api/overview?base=AUD&sources=hsbc_public,bank_boc",
        ),
        { DB: db } as never,
        ctx,
      );
      const payload = (await response.json()) as {
        sources: string[];
        pairs: Array<{ sources: Array<{ id: string; status: string }> }>;
      };

      expect(response.status).toBe(200);
      expect(payload.sources).toEqual(["market", "wise", "hsbc_public", "bank_boc"]);
      expect(payload.pairs).toHaveLength(10);
      expect(payload.pairs.every((pair) =>
        pair.sources.map((source) => source.id).join(",") ===
          "market,wise,hsbc_public,bank_boc"
      )).toBe(true);
      expect(requestedUrls.filter((url) => url.includes("yoyorate.com/compare"))).toHaveLength(10);
      await Promise.all(stored);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("layered bar chart dates", () => {
  it("pins market and Wise while limiting all other chart sources to five", async () => {
    const fiveExtras = ["hsbc_public", ...HONG_KONG_BANKS.filter((bank) => bank.id !== "hsbc").slice(0, 4).map((bank) => `bank_${bank.id}`)];
    expect(
      parseHistorySourceIds(
        new URL(`https://fxpulse.example/api/history?sources=${fiveExtras.join(",")}`),
      ),
    ).toEqual(["market", "wise", ...fiveExtras]);

    const sixExtras = [...fiveExtras, `bank_${HONG_KONG_BANKS.filter((bank) => bank.id !== "hsbc")[4]?.id}`];
    const response = parseHistorySourceIds(
      new URL(`https://fxpulse.example/api/history?sources=${sixExtras.join(",")}`),
    );
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(400);
    expect(await (response as Response).json()).toEqual({ error: "Too many history sources" });
  });

  it("normalizes the browser selection to the two fixed sources plus five extras", () => {
    const helperStart = appScript.indexOf("function normalizeChartSourceIds");
    const helperEnd = appScript.indexOf("function readGlobalOverviewSources", helperStart);
    const normalizeChartSourceIds = new Function(
      "FIXED_CHART_SOURCE_IDS",
      "MAX_CHART_EXTRA_SOURCES",
      `${appScript.slice(helperStart, helperEnd)}; return normalizeChartSourceIds;`,
    )(["market", "wise"], 5) as (values: Iterable<string>) => string[];
    const extras = ["hsbc_public", "bank_boc", "bank_bea", "bank_dbs", "bank_hangseng", "bank_icbc"];

    expect(normalizeChartSourceIds(new Set(["wise", ...extras, "market"]))).toEqual([
      "market",
      "wise",
      ...extras.slice(0, 5),
    ]);
  });

  it("uses a saturated seven-color chart palette and opaque nested bars", () => {
    expect(appScript).toContain('const FIXED_CHART_SOURCE_IDS = ["market", "wise"]');
    expect(appScript).toContain("const MAX_CHART_EXTRA_SOURCES = 5");
    expect(appScript).toContain('"#ff4d57"');
    expect(appScript).toContain("layerProgress * 0.48");
  });

  it("switches to the bar renderer when the bar button is clicked", () => {
    const helperStart = appScript.indexOf("function bindChartTypeSwitcher");
    const helperEnd = appScript.indexOf("async function swapPair", helperStart);
    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const createBinding = new Function(
      "document",
      "state",
      "renderHistory",
      `${appScript.slice(helperStart, helperEnd)}; return bindChartTypeSwitcher;`,
    );
    const listeners = new Map<string, (event: unknown) => void>();
    const switcher = {
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    };
    const button = (chartType: "line" | "bar") => ({
      dataset: { chartType },
      classList: { toggle: vi.fn() },
      setAttribute: vi.fn(),
    });
    const lineButton = button("line");
    const barButton = button("bar");
    const documentStub = {
      querySelector: () => switcher,
      querySelectorAll: () => [lineButton, barButton],
    };
    const stateStub = { chartType: "line", history: { series: [] } };
    const renderHistory = vi.fn();

    createBinding(documentStub, stateStub, renderHistory)();
    listeners.get("click")?.({ target: { closest: () => barButton } });

    expect(stateStub.chartType).toBe("bar");
    expect(renderHistory).toHaveBeenCalledWith(stateStub.history);
    expect(barButton.classList.toggle).toHaveBeenCalledWith("active", true);
    expect(barButton.setAttribute).toHaveBeenCalledWith("aria-pressed", "true");
  });

  it("places different source timestamps from the same Hong Kong day on one bar position", () => {
    const helperStart = appScript.indexOf("function renderBarSeries");
    const helperEnd = appScript.indexOf("function downsamplePoints", helperStart);
    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helpers = appScript.slice(helperStart, helperEnd);
    const { normalizeBarSeriesByDay, renderBarSeries } = new Function(
      "sourceColor",
      "escapeHtml",
      "formatRate",
      "state",
      `${helpers}; return { normalizeBarSeriesByDay, renderBarSeries };`,
    )(
      (id: string) => id === "market" ? "#57efb3" : "#76c8ff",
      (value: string) => value,
      (value: number) => String(value),
      { quote: "USD" },
    ) as {
      normalizeBarSeriesByDay: (
        series: Array<{
          id: string;
          points: Array<{ timestamp: number; date: string; rate: number }>;
        }>,
        limit: number,
      ) => Array<{
        id: string;
        points: Array<{ timestamp: number; date: string; rate: number }>;
      }>;
      renderBarSeries: (
        series: Array<{
          id: string;
          label?: string;
          points: Array<{ timestamp: number; date: string; rate: number }>;
        }>,
        barDays: number[],
        x: (timestamp: number) => number,
        y: (rate: number) => number,
        height: number,
        padding: { left: number; right: number; bottom: number },
        width: number,
      ) => string;
    };

    const result = normalizeBarSeriesByDay(
      [
        {
          id: "market",
          points: [
            { timestamp: Date.parse("2026-08-04T16:30:00Z") / 1000, date: "2026-08-04T16:30:00Z", rate: 0.7037 },
            { timestamp: Date.parse("2026-08-05T08:00:00Z") / 1000, date: "2026-08-05T08:00:00Z", rate: 0.7041 },
            { timestamp: Date.parse("2026-08-05T16:15:00Z") / 1000, date: "2026-08-05T16:15:00Z", rate: 0.7043 },
          ],
        },
        {
          id: "wise",
          points: [
            { timestamp: Date.parse("2026-08-05T03:00:00Z") / 1000, date: "2026-08-05T03:00:00Z", rate: 0.7045 },
            { timestamp: Date.parse("2026-08-05T17:00:00Z") / 1000, date: "2026-08-05T17:00:00Z", rate: 0.7046 },
          ],
        },
      ],
      100,
    );

    expect(result[0]?.points).toHaveLength(2);
    expect(result[1]?.points).toHaveLength(2);
    expect(result[0]?.points[0]?.timestamp).toBe(result[1]?.points[0]?.timestamp);
    expect(result[0]?.points[1]?.timestamp).toBe(result[1]?.points[1]?.timestamp);
    expect(result[0]?.points[0]?.rate).toBe(0.7041);
    expect(result[0]?.points[0]?.date).toBe("2026-08-05T04:00:00.000Z");

    const barDays = [...new Set(result.flatMap((series) => series.points.map((point) => point.timestamp)))];
    const svg = renderBarSeries(
      result.map((series) => ({ ...series, label: series.id })),
      barDays,
      () => 100,
      (rate) => 260 - rate * 100,
      300,
      { left: 70, right: 20, bottom: 40 },
      500,
    );
    expect(svg.match(/class="chart-bar-day"/g)).toHaveLength(2);
    const firstDay = svg.slice(0, svg.indexOf("</g>") + 4);
    expect(firstDay).toContain('data-source="market"');
    expect(firstDay).toContain('data-source="wise"');
  });

  it("allows one Hong Kong day to render as a single bar", () => {
    expect(appScript).toContain('const minimumPoints = chartType === "bar" ? 1 : 2');
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

  it("renders the unified source table and configurable market overview", () => {
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
    expect(html.match(/<option value="bank_[a-z0-9]+">/g)).toHaveLength(17);
    expect(html).toContain('id="swap-pair"');
    expect(html).toContain('id="swap-label">AUD / USD');
    expect(html).toContain('id="overview-swap"');
    expect(html).toContain('id="overview-swap-label">USD/AUD');
    const overview = html.slice(html.indexOf('id="rate-grid"'));
    expect(overview.indexOf('data-currency="USD"')).toBeLessThan(
      overview.indexOf('data-currency="CAD"'),
    );
    expect(overview).toContain("当前目标 · 1 AUD → USD");
    expect(html).not.toContain('id="comparison-grid"');
    expect(html).not.toContain("SAME PAIR · THREE SOURCES");
    expect(html).toContain('id="banks"');
    expect(html).toContain('id="bank-table-body"');
    expect(html).toContain('id="bank-best"');
    expect(html).toContain("ALL CONNECTED RATE SOURCES");
    expect(html).toContain("公共市场与 Wise 固定置顶");
    expect(html).toContain("18 家银行牌价");
    expect(html.match(/data-overview-rate="market"/g)).toHaveLength(10);
    expect(html.match(/data-overview-rate="wise"/g)).toHaveLength(10);
    expect(html.match(/data-overview-rate="hsbc_public"/g)).toBeNull();
    expect(html).toContain("1 AUD 兑换其他币种 · 可配置多源报价");
    expect(html).toContain('id="overview-global-config"');
    expect(html).toContain('id="overview-global-count">0 / 5');
    expect(html.match(/data-overview-global-source/g)).toHaveLength(18);
    expect(html.match(/data-card-follow-global/g)).toHaveLength(10);
    expect(html.match(/data-card-source-config/g)).toHaveLength(10);
    expect(appScript).toContain("selected.length > 5");
    expect(appScript).toContain("openCardConfigs");
    expect(appScript).toContain("fxpulse.overview.global-sources.v1");
    expect(appScript).toContain("fxpulse.overview.card-sources.v1");
    expect(html).toContain("金额只用于本计算器");
    expect(html).toContain("汇丰公开 TT");
    expect(html).toContain('data-chart-type="line"');
    expect(html).toContain('data-chart-type="bar"');
    expect(html.match(/data-history-source/g)).toHaveLength(20);
    expect(html).toContain("历史数据源（固定 2 + 最多 5 个）");
    expect(html.match(/data-history-fixed/g)).toHaveLength(2);
    expect(html).toContain('id="chart-bank-count">0 / 5');
    expect(html).toContain("本站数据须经书面授权方可使用");
    expect(html).toContain("未经授权使用将被视为侵权");
    expect(html).not.toContain("并提供指向本项目公开仓库的可点击链接");
    expect(html).not.toContain(">https://github.com/wxywizard/FXPulse <span");
    expect(html).toContain("仅能登录后查看或没有可靠第三方实时来源的银行不会接入");
    expect(html).toContain("https://github.com/wxywizard/FXPulse");
  });
});

describe("multi-source history API", () => {
  it("requires D1 history to span the selected window and at least two Hong Kong days", () => {
    const now = Date.parse("2026-08-05T12:00:00Z") / 1000;
    const sameDay = [0, 1, 2, 3].map((hours) => ({
      timestamp: now - hours * 3_600,
    }));
    const covered = [
      { timestamp: now - 7 * 86_400 },
      { timestamp: now - 6 * 86_400 },
      { timestamp: now },
    ];
    expect(coversRequestedHistoryWindow(sameDay, 7, now)).toBe(false);
    expect(coversRequestedHistoryWindow(covered, 7, now)).toBe(true);
  });

  it("falls back to Frankfurter when D1 only contains intraday points", async () => {
    const now = Date.parse("2026-08-05T12:00:00Z") / 1000;
    const intradayTimestamps = [0, 1, 2, 3].map((hours) => now - hours * 3_600);
    const marketRows = intradayTimestamps.flatMap((observed_at, index) => [
      { quote: "AUD", rate: 1.42 + index * 0.001, observed_at },
      { quote: "USD", rate: 1, observed_at },
    ]);
    const db = {
      prepare: () => ({
        bind: () => ({ all: async () => ({ results: marketRows }) }),
      }),
    } as never;
    const fetcher = vi.fn(async () => Response.json([
      { date: "2026-07-30", base: "AUD", quote: "USD", rate: 0.702 },
      { date: "2026-08-01", base: "AUD", quote: "USD", rate: 0.703 },
      { date: "2026-08-04", base: "AUD", quote: "USD", rate: 0.704 },
    ]));
    vi.stubGlobal("fetch", fetcher);

    try {
      const response = await handleHistory(
        new URL("https://fxpulse.example/api/history?base=AUD&quote=USD&days=7&sources=market"),
        { DB: db } as never,
      );
      const payload = (await response.json()) as {
        series: Array<{ provider: string; frequency: string; points: unknown[] }>;
      };
      expect(response.status).toBe(200);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(payload.series[0]?.provider).toContain("Frankfurter");
      expect(payload.series[0]?.frequency).toBe("daily");
      expect(payload.series[0]?.points).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns independent market, Wise and bank series without substituting missing banks", async () => {
    const now = Math.floor(Date.now() / 1000);
    const timestamps = [
      now - 7 * 86_400,
      now - 5 * 86_400,
      now - 3 * 86_400,
      now,
    ];
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
        "https://fxpulse.example/api/history?base=AUD&quote=USD&days=7&sources=market,wise,hsbc_public,bank_boc",
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
