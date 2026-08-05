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

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const snapshot = await fetchCurrentSnapshot("USD");
        await storeSnapshot(env.DB, snapshot);
        console.log("Stored FX snapshot", {
          fetchedAt: snapshot.fetchedAt,
          sourceUpdatedAt: snapshot.sourceUpdatedAt,
          currencies: CURRENCY_CODES.length,
        });
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

async function handleHistory(url: URL, env: Env): Promise<Response> {
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

  try {
    let series = null;
    try {
      series = await readD1History(env.DB, base, quote, rawDays);
    } catch (error) {
      console.warn("D1 history unavailable; falling back to reference history", error);
    }
    series ??= await fetchReferenceHistory(base, quote, rawDays);
    return json(
      {
        marketType: "reference",
        disclaimer: "Historical reference rates; not HSBC transaction prices.",
        ...series,
      },
      200,
      series.frequency === "intraday" ? 300 : 3600,
    );
  } catch (error) {
    console.error("History API failed", error);
    return json({ error: "Historical reference rates are temporarily unavailable" }, 503, 30);
  }
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
