import {
  CURRENCIES,
  CURRENCY_CODES,
  defaultQuote,
  formatRate,
  type CurrencyCode,
} from "./currencies";
import type { CurrentSnapshot } from "./rates";

interface PageOptions {
  origin: string;
  base: CurrencyCode;
  quote: CurrencyCode;
  snapshot: CurrentSnapshot | null;
}

export function renderPage({ origin, base, quote, snapshot }: PageOptions): string {
  const baseMeta = CURRENCIES[base];
  const quoteMeta = CURRENCIES[quote];
  const canonicalPath = `/rates/${base.toLowerCase()}/${quote.toLowerCase()}`;
  const canonical = `${origin}${canonicalPath}`;
  const title = `${base}/${quote} 汇率与历史走势｜FXPulse`;
  const description = `查看 ${baseMeta.name}（${base}）兑${quoteMeta.name}（${quote}）最新市场参考汇率，以及过去 7、15、30、90、365 天走势。`;
  const initialData = escapeScriptJson(
    JSON.stringify({ base, quote, snapshot, generatedAt: new Date().toISOString() }),
  );
  const updatedText = snapshot
    ? new Date(snapshot.sourceUpdatedAt * 1000).toLocaleString("zh-CN", {
        timeZone: "Asia/Hong_Kong",
        hour12: false,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "数据连接中";

  return `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="theme-color" content="#071a16">
  <meta name="color-scheme" content="dark">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="stylesheet" href="/styles.css">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="FXPulse">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${canonical}">
  <meta name="twitter:card" content="summary_large_image">
  ${renderStructuredData({ origin, base, quote, title, description, canonical })}
</head>
<body>
  <a class="skip-link" href="#main">跳至主要内容</a>
  <div class="ambient ambient-one" aria-hidden="true"></div>
  <div class="ambient ambient-two" aria-hidden="true"></div>

  <header class="site-header">
    <a class="brand" href="/" aria-label="FXPulse 首页">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>FX<span>Pulse</span></span>
    </a>
    <nav aria-label="主要导航">
      <a href="#rates">汇率</a>
      <a href="#trend">趋势</a>
      <a href="#methodology">数据说明</a>
    </nav>
    <span class="market-pill"><span></span>市场参考价</span>
  </header>

  <main id="main">
    <section class="hero" aria-labelledby="hero-title">
      <div class="eyebrow"><span>FX</span> 为香港外币用户而做</div>
      <h1 id="hero-title">外汇变化，<em>一眼看清。</em></h1>
      <p>聚合汇丰香港 Deposit Plus 涉及的 11 种主要币种，快速比较当前市场参考价与近期趋势。</p>
      <div class="hero-meta">
        <span><b id="status-dot" class="status-dot ${snapshot ? "" : "pending"}"></b><span id="data-status">${snapshot ? "数据源正常" : "正在连接数据源"}</span></span>
        <span>提供方更新：<time id="source-updated">${updatedText}</time> HKT</span>
      </div>
    </section>

    <section class="control-panel" aria-label="汇率换算控制">
      <div class="control-group">
        <label for="base-currency">我的基准币种</label>
        <div class="select-wrap">
          <span id="base-flag" aria-hidden="true">${baseMeta.flag}</span>
          <select id="base-currency" aria-label="选择基准币种">
            ${currencyOptions(base)}
          </select>
        </div>
      </div>
      <div class="divider" aria-hidden="true"></div>
      <div class="control-group amount-group">
        <label for="base-amount">换算金额</label>
        <div class="amount-wrap">
          <span id="base-symbol">${baseMeta.symbol}</span>
          <input id="base-amount" inputmode="decimal" type="number" min="0" step="any" value="10000" aria-label="换算金额">
          <strong id="base-code">${base}</strong>
        </div>
      </div>
      <div class="control-summary">
        <span>覆盖币种</span>
        <strong>11</strong>
      </div>
    </section>

    <section id="rates" class="section rates-section" aria-labelledby="rates-title">
      <div class="section-heading">
        <div>
          <span class="section-kicker">LATEST REFERENCE</span>
          <h2 id="rates-title">1 ${base} 可以兑换</h2>
        </div>
        <p id="rates-caption">点击任一币种，查看历史走势</p>
      </div>
      <div id="rate-grid" class="rate-grid" aria-live="polite">
        ${renderRateCards(base, quote, snapshot)}
      </div>
      <p id="rate-error" class="inline-error" role="alert" hidden></p>
    </section>

    <section id="trend" class="trend-layout" aria-labelledby="trend-title">
      <div class="chart-card">
        <div class="chart-header">
          <div>
            <span class="section-kicker">PAIR TREND</span>
            <h2 id="trend-title"><span id="pair-base">${base}</span> / <span id="pair-quote">${quote}</span></h2>
            <p><span id="pair-base-name">${baseMeta.name}</span>兑<span id="pair-quote-name">${quoteMeta.name}</span></p>
          </div>
          <div class="range-switcher" role="group" aria-label="历史周期">
            ${[7, 15, 30, 90, 365].map((days) => `<button type="button" data-days="${days}" class="${days === 30 ? "active" : ""}" aria-pressed="${days === 30}">${days === 365 ? "1年" : `${days}天`}</button>`).join("")}
          </div>
        </div>
        <div id="chart-wrap" class="chart-wrap" aria-live="polite">
          <div class="chart-loading"><span></span>正在加载历史数据</div>
        </div>
        <p id="history-source" class="chart-source">历史数据加载中</p>
      </div>

      <aside class="pair-summary" aria-label="币种对区间统计">
        <span class="section-kicker">RANGE SNAPSHOT</span>
        <h2>区间概览</h2>
        <div class="current-rate">
          <span>当前参考价</span>
          <strong id="stat-current">—</strong>
          <small id="stat-pair">${quote} / ${base}</small>
        </div>
        <dl>
          <div><dt>区间高点</dt><dd id="stat-high">—</dd></div>
          <div><dt>区间低点</dt><dd id="stat-low">—</dd></div>
          <div><dt>区间变化</dt><dd id="stat-change">—</dd></div>
          <div><dt>兑换估算</dt><dd id="stat-converted">—</dd></div>
        </dl>
        <p>历史走势为参考汇率变化，不代表汇丰实际成交价、目标转换价或产品回报。</p>
      </aside>
    </section>

    <section id="methodology" class="methodology" aria-labelledby="method-title">
      <div>
        <span class="section-kicker">CLEAR BY DESIGN</span>
        <h2 id="method-title">先看清数据，再做决定。</h2>
        <p>当前报价来自 ExchangeRate-API；较长周期历史由 Frankfurter 的机构参考数据补齐。数据可能存在延迟，也不包含汇丰点差、费用、个性化利率或转换价。</p>
      </div>
      <div class="method-grid">
        <article><span>01</span><h3>不是银行报价</h3><p>页面只展示第三方市场参考价，交易前请以汇丰香港官方渠道为准。</p></article>
        <article><span>02</span><h3>保留原始时间</h3><p>更新时间来自数据提供方，不使用访问页面的时间冒充行情时间。</p></article>
        <article><span>03</span><h3>不做投资建议</h3><p>FXPulse 不预测收益、不推荐币种，也不代替产品文件或专业意见。</p></article>
      </div>
    </section>

    <section class="risk-note" aria-label="风险提示">
      <span aria-hidden="true">!</span>
      <div>
        <h2>重要风险提示</h2>
        <p>Deposit Plus 是涉及外汇期权的结构性投资产品，不是定期存款，不受香港存款保障计划保障，亦非保本产品。汇率波动可能抵销利息，并造成本金损失。</p>
      </div>
      <a href="https://www.hsbc.com.hk/investments/products/structured/deposit-plus/" target="_blank" rel="noopener noreferrer">查看官方产品说明 <span aria-hidden="true">↗</span></a>
    </section>
  </main>

  <footer>
    <a class="brand footer-brand" href="/"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>FX<span>Pulse</span></span></a>
    <p>独立汇率信息工具 · 与 HSBC/汇丰无隶属或合作关系</p>
    <p>© ${new Date().getUTCFullYear()} FXPulse</p>
  </footer>

  <script id="fxpulse-data" type="application/json">${initialData}</script>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

function currencyOptions(selected: CurrencyCode): string {
  return CURRENCY_CODES.map((code) => {
    const meta = CURRENCIES[code];
    return `<option value="${code}" ${code === selected ? "selected" : ""}>${code} · ${meta.name}</option>`;
  }).join("");
}

function renderRateCards(
  base: CurrencyCode,
  activeQuote: CurrencyCode,
  snapshot: CurrentSnapshot | null,
): string {
  return CURRENCY_CODES.filter((code) => code !== base)
    .map((code) => {
      const meta = CURRENCIES[code];
      const rate = snapshot?.rates[code];
      const inverse = rate ? 1 / rate : null;
      return `<button type="button" class="rate-card ${code === activeQuote ? "active" : ""}" data-currency="${code}" aria-label="查看 ${base} 兑 ${code} 历史走势">
        <span class="flag" aria-hidden="true">${meta.flag}</span>
        <span class="currency-id"><strong>${code}</strong><small>${meta.name}</small></span>
        <span class="rate-value"><strong data-rate>${rate ? formatRate(rate, code) : "—"}</strong><small>1 ${base} = <span data-rate-label>${rate ? formatRate(rate, code) : "—"}</span> ${code}</small></span>
        <span class="inverse">1 ${code} = <b data-inverse>${inverse ? formatRate(inverse, base) : "—"}</b> ${base}</span>
        <span class="card-arrow" aria-hidden="true">↗</span>
      </button>`;
    })
    .join("");
}

function renderStructuredData(input: {
  origin: string;
  base: CurrencyCode;
  quote: CurrencyCode;
  title: string;
  description: string;
  canonical: string;
}): string {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name: "FXPulse",
        url: input.origin,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        description: "多币种市场参考汇率与历史趋势工具",
        inLanguage: "zh-Hans",
        offers: { "@type": "Offer", price: "0", priceCurrency: "HKD" },
      },
      {
        "@type": "Dataset",
        name: `${input.base}/${input.quote} 市场参考汇率`,
        description: input.description,
        url: input.canonical,
        temporalCoverage: "P1Y",
        creator: { "@type": "Organization", name: "FXPulse" },
        isAccessibleForFree: true,
        license: "https://www.exchangerate-api.com/terms",
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "FXPulse 显示的是汇丰香港实际报价吗？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "不是。FXPulse 展示第三方市场参考汇率，实际交易价、利率及转换价请以汇丰香港官方渠道为准。",
            },
          },
          {
            "@type": "Question",
            name: "汇率数据多久更新一次？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "页面保留并展示数据提供方的更新时间。FXPulse 的 Cloudflare 定时任务每 15 分钟检查并保存一次最新快照。",
            },
          },
        ],
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "FXPulse", item: input.origin },
          { "@type": "ListItem", position: 2, name: input.title, item: input.canonical },
        ],
      },
    ],
  };
  return `<script type="application/ld+json">${escapeScriptJson(JSON.stringify(graph))}</script>`;
}

export function renderSitemap(origin: string): string {
  const urls = [`${origin}/`];
  for (const base of CURRENCY_CODES) {
    for (const quote of CURRENCY_CODES) {
      if (base !== quote) urls.push(`${origin}/rates/${base.toLowerCase()}/${quote.toLowerCase()}`);
    }
  }
  const updated = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((url) => `  <url><loc>${url}</loc><lastmod>${updated}</lastmod><changefreq>${url === `${origin}/` ? "hourly" : "daily"}</changefreq></url>`)
    .join("\n")}\n</urlset>`;
}

export function renderLlmsTxt(origin: string): string {
  const defaultPair = defaultQuote("HKD");
  return `# FXPulse\n\n> FXPulse is an independent exchange-rate reference tool for the 11 currencies available in HSBC Hong Kong Deposit Plus. It is not affiliated with HSBC.\n\n## What the site provides\n- Latest third-party market reference rates for AUD, CAD, CHF, CNY, EUR, GBP, HKD, JPY, NZD, SGD and USD.\n- Historical trend windows of 7, 15, 30, 90 and 365 days.\n- Amount conversion estimates and period high, low and change statistics.\n\n## Important interpretation\n- Values are reference rates, not HSBC quotes, bid/ask prices, Deposit Plus conversion rates or investment advice.\n- Source timestamps are shown on the page.\n- Deposit Plus is a structured investment product, not a time deposit, is not protected by Hong Kong's Deposit Protection Scheme and is not principal protected.\n\n## Key pages\n- Home: ${origin}/\n- Default pair: ${origin}/rates/hkd/${defaultPair.toLowerCase()}\n- Sitemap: ${origin}/sitemap.xml\n- Product requirements: https://github.com/wxywizard/FXPulse/blob/main/docs/PRD.md\n\n## Sources\n- Current reference rates: https://www.exchangerate-api.com/\n- Historical institutional reference rates: https://frankfurter.dev/\n- Deposit Plus product facts and risk disclosure: https://www.hsbc.com.hk/investments/products/structured/deposit-plus/\n`;
}

function escapeScriptJson(value: string): string {
  return value.replaceAll("<", "\\u003c");
}
