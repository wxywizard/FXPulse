import {
  CURRENCIES,
  CURRENCY_CODES,
  defaultQuote,
  formatRate,
  type CurrencyCode,
} from "./currencies";
import type { CurrentSnapshot } from "./rates";

const ASSET_VERSION = "20260805-comparison-v1";

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
  const description = `比较 ${baseMeta.name}（${base}）兑${quoteMeta.name}（${quote}）公共市场、Wise 与汇丰 Deposit Plus 报价，并查看 7、15、30、90、365 天走势。`;
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
  <link rel="stylesheet" href="/styles.css?v=${ASSET_VERSION}">
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
      <a href="#compare">三源对比</a>
      <a href="#rates">币种总览</a>
      <a href="#trend">趋势</a>
      <a href="#methodology">数据说明</a>
    </nav>
    <span class="market-pill"><span></span>三源报价对比</span>
  </header>

  <main id="main">
    <section class="hero" aria-labelledby="hero-title">
      <div class="eyebrow"><span>FX</span> 为香港外币用户而做</div>
      <h1 id="hero-title">外汇变化，<em>一眼看清。</em></h1>
      <p>同一币种方向，对比公共市场、Wise 与汇丰 Deposit Plus 报价，再结合近期走势判断差异。</p>
      <div class="hero-meta">
        <span><b id="status-dot" class="status-dot ${snapshot ? "" : "pending"}"></b><span id="data-status">${snapshot ? "数据源正常" : "正在连接数据源"}</span></span>
        <span>提供方更新：<time id="source-updated">${updatedText}</time> HKT</span>
      </div>
    </section>

    <section class="converter" aria-labelledby="converter-title">
      <div class="converter-heading">
        <div>
          <span class="section-kicker">CURRENCY CALCULATOR</span>
          <h2 id="converter-title">金额换算器</h2>
        </div>
        <p>金额只用于本计算器，下方汇率始终按 1 个单位展示。</p>
      </div>
      <div class="converter-grid">
        <div class="money-field">
          <label for="base-amount">你有</label>
          <div class="money-input">
            <input id="base-amount" inputmode="decimal" type="number" min="0" step="any" value="1000" aria-label="输入换算金额">
            <span class="currency-select">
              <span id="base-flag" aria-hidden="true">${baseMeta.flag}</span>
              <select id="base-currency" aria-label="选择换出币种">${currencyOptions(base)}</select>
            </span>
          </div>
        </div>
        <button id="swap-pair" class="swap-button" type="button" aria-label="反转 ${base}/${quote} 为 ${quote}/${base}" title="反转币种方向">
          <span aria-hidden="true">⇄</span>
        </button>
        <div class="money-field result-field">
          <label for="quote-currency">预计可得</label>
          <div class="money-input result-input">
            <output id="converted-amount" for="base-amount">—</output>
            <span class="currency-select">
              <span id="quote-flag" aria-hidden="true">${quoteMeta.flag}</span>
              <select id="quote-currency" aria-label="选择换入币种">${currencyOptions(quote)}</select>
            </span>
          </div>
        </div>
      </div>
      <p class="calculator-rate">按公共市场参考价估算 · <span id="calculator-rate">1 ${base} = — ${quote}</span></p>
    </section>

    <section id="compare" class="section comparison-section" aria-labelledby="comparison-title">
      <div class="section-heading">
        <div>
          <span class="section-kicker">SAME PAIR · THREE SOURCES</span>
          <h2 id="comparison-title"><span id="comparison-base">${base}</span>/<span id="comparison-quote">${quote}</span> 三源对比</h2>
        </div>
        <p>统一按 1 <span id="comparison-unit-base">${base}</span> 兑换 <span id="comparison-unit-quote">${quote}</span> 展示</p>
      </div>
      <div id="comparison-grid" class="comparison-grid" aria-live="polite">
        ${renderComparisonPlaceholders(base, quote)}
      </div>
      <p id="comparison-note" class="comparison-note">正在加载各来源的可用报价与更新时间。</p>
    </section>

    <section id="rates" class="section rates-section" aria-labelledby="rates-title">
      <div class="section-heading">
        <div>
          <span class="section-kicker">MARKET OVERVIEW</span>
          <h2 id="rates-title">1 ${base} 的公共市场参考价</h2>
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
        </dl>
        <p>历史走势为参考汇率变化，不代表汇丰实际成交价、目标转换价或产品回报。</p>
      </aside>
    </section>

    <section id="methodology" class="methodology" aria-labelledby="method-title">
      <div>
        <span class="section-kicker">CLEAR BY DESIGN</span>
        <h2 id="method-title">先看清数据，再做决定。</h2>
        <p>公共市场价用于建立统一基准；Wise 通过官方 Rate API 接入；汇丰只接收安全采集并脱敏后的 Deposit Plus <code>exchangeSpotRate</code>。三者时间、口径和可获得性分别展示。</p>
      </div>
      <div class="method-grid">
        <article><span>01</span><h3>同方向再比较</h3><p>切换或反转币种后，所有来源统一换算为“1 基准币种 = x 目标币种”。</p></article>
        <article><span>02</span><h3>缺失就明确缺失</h3><p>没有官方凭据或最新采集时显示待接入/已过期，不使用其他来源冒充。</p></article>
        <article><span>03</span><h3>报价不是建议</h3><p>FXPulse 不预测收益、不推荐币种，也不代替产品文件或专业意见。</p></article>
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
  <script src="/app.js?v=${ASSET_VERSION}" defer></script>
</body>
</html>`;
}

function renderComparisonPlaceholders(base: CurrencyCode, quote: CurrencyCode): string {
  return [
    ["公共市场参考价", "market"],
    ["Wise 中间价", "wise"],
    ["汇丰 Deposit Plus", "hsbc_deposit_plus"],
  ]
    .map(
      ([label, id]) => `<article class="source-card loading" data-source="${id}">
        <div class="source-card-head"><span>${label}</span><b>连接中</b></div>
        <strong>1 ${base} = — ${quote}</strong>
        <p>正在确认该来源的报价状态</p>
        <small>更新时间：—</small>
      </article>`,
    )
    .join("");
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
        description: "公共市场、Wise 与汇丰 Deposit Plus 多来源汇率比较及历史趋势工具",
        inLanguage: "zh-Hans",
        offers: { "@type": "Offer", price: "0", priceCurrency: "HKD" },
      },
      {
        "@type": "Dataset",
        name: `${input.base}/${input.quote} 多来源汇率比较`,
        description: input.description,
        url: input.canonical,
        temporalCoverage: "P1Y",
        creator: { "@type": "Organization", name: "FXPulse" },
        isAccessibleForFree: true,
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "FXPulse 的汇丰列是什么报价？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "汇丰列只显示经安全采集的 Deposit Plus exchangeSpotRate，不等于 conversionRate、保证成交价或产品回报；实际交易以汇丰香港确认页面为准。",
            },
          },
          {
            "@type": "Question",
            name: "汇率数据多久更新一次？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "页面分别保留各提供方的更新时间。公共市场每 15 分钟检查归档；Wise 在有官方凭据时按需获取并每小时归档；汇丰取决于最近一次安全导入。",
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
  return `# FXPulse\n\n> FXPulse is an independent exchange-rate comparison tool for the 11 currencies available in HSBC Hong Kong Deposit Plus. It is not affiliated with HSBC or Wise.\n\n## What the site provides\n- Same-direction comparison of public market reference rates, Wise mid-market rates when official credentials are configured, and safely imported HSBC Deposit Plus exchangeSpotRate values.\n- Reversible directed pairs such as USD/AUD and AUD/USD.\n- A standalone amount calculator that does not change the unit rates below it.\n- Historical trend windows of 7, 15, 30, 90 and 365 days.\n\n## Important interpretation\n- A missing source is labelled unavailable or stale; FXPulse does not substitute another provider's value.\n- HSBC values are Deposit Plus spot reference rates, not conversion rates, guaranteed transaction rates or investment returns.\n- Source timestamps and provider status are shown separately.\n- Deposit Plus is a structured investment product, not a time deposit, is not protected by Hong Kong's Deposit Protection Scheme and is not principal protected.\n\n## Key pages\n- Home: ${origin}/\n- Default pair: ${origin}/rates/hkd/${defaultPair.toLowerCase()}\n- Sitemap: ${origin}/sitemap.xml\n- Product requirements: https://github.com/wxywizard/FXPulse/blob/main/docs/PRD.md\n- Data collection: https://github.com/wxywizard/FXPulse/blob/main/docs/DATA_COLLECTION.md\n\n## Sources\n- Public market reference rates: https://www.exchangerate-api.com/\n- Wise official Rate API: https://docs.wise.com/api-reference/rate/rateget\n- Historical institutional reference rates: https://frankfurter.dev/\n- Deposit Plus product facts and risk disclosure: https://www.hsbc.com.hk/investments/products/structured/deposit-plus/\n`;
}

function escapeScriptJson(value: string): string {
  return value.replaceAll("<", "\\u003c");
}
