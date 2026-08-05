import {
  CURRENCIES,
  CURRENCY_CODES,
  defaultQuote,
  formatRate,
  type CurrencyCode,
} from "./currencies";
import type { CurrentSnapshot } from "./rates";
import { HONG_KONG_BANKS } from "./bank-rates";

const ASSET_VERSION = "20260805-chart-history-v1";

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
  const description = `比较 ${baseMeta.name}（${base}）兑${quoteMeta.name}（${quote}）公共市场、Wise 与当前已接入的 18 家香港银行公开 TT 牌价，并查看 7、15、30、90、365 天走势。`;
  const initialData = escapeScriptJson(
    JSON.stringify({
      base,
      quote,
      snapshot,
      sourceCatalog: overviewSourceCatalog(),
      generatedAt: new Date().toISOString(),
    }),
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
      <a href="#banks">来源对比</a>
      <a href="#rates">币种总览</a>
      <a href="#trend">趋势</a>
      <a href="#methodology">数据说明</a>
    </nav>
    <span class="market-pill"><span></span>18 家银行牌价</span>
  </header>

  <main id="main">
    <section class="hero" aria-labelledby="hero-title">
      <div class="eyebrow"><span>FX</span> 为香港外币用户而做</div>
      <h1 id="hero-title">外汇变化，<em>一眼看清。</em></h1>
      <p>同一币种方向，对比公共市场、Wise 与当前已接入的 18 家香港银行 TT 汇率；汇丰一行使用官网匿名接口校准。</p>
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
        <button id="swap-pair" class="swap-button" type="button" aria-label="反转 ${base}/${quote} 为 ${quote}/${base}">
          <span class="swap-icon" aria-hidden="true">⇄</span>
          <span class="swap-copy"><small>一键反转</small><b id="swap-label">${base} / ${quote}</b></span>
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
      <div class="calculator-source-row">
        <label class="calculator-source-field" for="calculator-source">
          <span>计算汇率来源</span>
          <select id="calculator-source" aria-describedby="calculator-source-note">
            ${calculatorSourceOptions()}
          </select>
        </label>
        <p id="calculator-source-note">默认使用公共市场参考价；可切换 Wise、汇丰或其他香港银行公开 TT 牌价。</p>
      </div>
      <p class="calculator-rate"><span id="calculator-rate-source">公共市场参考价</span> · <span id="calculator-rate">1 ${base} = — ${quote}</span></p>
    </section>

    <section id="banks" class="section bank-section" aria-labelledby="banks-title">
      <div class="section-heading bank-heading">
        <div>
          <span class="section-kicker">ALL CONNECTED RATE SOURCES</span>
          <h2 id="banks-title"><span id="banks-base">${base}</span>/<span id="banks-quote">${quote}</span> 汇率来源对比</h2>
        </div>
        <p>公共市场与 Wise 固定置顶，银行按客户卖出 <span id="banks-sell">${base}</span>、买入 <span id="banks-buy">${quote}</span> 排序</p>
      </div>
      <div class="bank-summary" aria-live="polite">
        <div><span>当前方向</span><strong id="bank-direction">卖出 ${base} → 买入 ${quote}</strong></div>
        <div><span>最佳银行牌价</span><strong id="bank-best">正在加载</strong></div>
        <div><span>可用银行</span><strong id="bank-available">— / 18</strong></div>
      </div>
      <p id="bank-error" class="inline-error" role="alert" hidden></p>
      <div class="bank-table-wrap">
        <table class="bank-table">
          <thead>
            <tr><th>排名</th><th>来源</th><th>类型</th><th id="bank-rate-column">1 ${base} 可得 ${quote}</th><th>较市场价</th><th>报价口径</th><th>采集时间</th></tr>
          </thead>
          <tbody id="bank-table-body">
            ${renderBankPlaceholders()}
          </tbody>
        </table>
      </div>
      <div class="bank-table-note">
        <p id="bank-note">正在读取公共市场、Wise 与公开银行牌价。数值越高，代表同样 1 ${base} 可换得更多 ${quote}。</p>
        <a href="https://yoyorate.com/" target="_blank" rel="noopener noreferrer">查看聚合来源 <span aria-hidden="true">↗</span></a>
      </div>
    </section>

    <section id="rates" class="section rates-section" aria-labelledby="rates-title">
      <div class="section-heading overview-heading">
        <div>
          <span class="section-kicker">MARKET OVERVIEW</span>
          <h2 id="rates-title">1 ${base} 兑换其他币种 · 可配置多源报价</h2>
        </div>
        <div class="overview-heading-actions">
          <p id="rates-caption">公共市场和 Wise 默认展示；全局最多增加 5 个来源，每张卡可独立覆盖</p>
          <button id="overview-swap" class="overview-swap" type="button" aria-label="反转 ${base}/${quote} 为 ${quote}/${base}">
            <span aria-hidden="true">⇄</span>
            <span>反转为 <b id="overview-swap-label">${quote}/${base}</b></span>
          </button>
        </div>
      </div>
      <div class="overview-config-row">
        <div id="overview-legend" class="overview-legend" aria-label="全局报价来源图例">
          <span class="legend-market"><i></i>公共市场</span>
          <span class="legend-wise"><i></i>Wise 中间价</span>
        </div>
        <details id="overview-global-config" class="overview-source-config">
          <summary>配置全局来源 <b id="overview-global-count">0 / 5</b></summary>
          <div class="overview-config-panel">
            <strong>附加数据源（最多 5 个）</strong>
            <p>公共市场和 Wise 始终展示，不占 5 个附加名额。</p>
            <div id="overview-global-options" class="overview-config-options">
              ${overviewSourceCheckboxes("global")}
            </div>
            <small id="overview-global-note">当前使用默认配置。</small>
          </div>
        </details>
      </div>
      <p id="overview-error" class="inline-error" role="alert" hidden></p>
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
          <div class="chart-header-controls">
            <div class="chart-type-switcher" role="group" aria-label="图表类型">
              <button type="button" data-chart-type="line" class="active" aria-pressed="true">折线图</button>
              <button type="button" data-chart-type="bar" aria-pressed="false">柱状图</button>
            </div>
            <div class="range-switcher" role="group" aria-label="历史周期">
              ${[7, 15, 30, 90, 365].map((days) => `<button type="button" data-days="${days}" class="${days === 30 ? "active" : ""}" aria-pressed="${days === 30}">${days === 365 ? "1年" : `${days}天`}</button>`).join("")}
            </div>
          </div>
        </div>
        <div id="chart-source-picker" class="chart-source-picker">
          <span class="chart-source-title">历史数据源（可多选）</span>
          <div class="chart-core-sources">
            ${historySourceCheckbox("market", "公共市场", true)}
            ${historySourceCheckbox("wise", "Wise 中间价")}
            ${historySourceCheckbox("hsbc_public", "汇丰公开 TT")}
          </div>
          <details class="chart-bank-picker">
            <summary>其他香港银行 <b id="chart-bank-count">0</b> / ${HONG_KONG_BANKS.length - 1}</summary>
            <div class="chart-bank-options">
              ${HONG_KONG_BANKS.filter((bank) => bank.id !== "hsbc").map((bank) => historySourceCheckbox(`bank_${bank.id}`, bank.name)).join("")}
            </div>
          </details>
          <p id="chart-selection-note">已选择 1 个数据源。柱状图按香港日期共用一个柱位并以颜色叠层区分；银行历史不足时会明确标注。</p>
        </div>
        <div id="chart-legend" class="chart-legend" aria-live="polite"></div>
        <div id="chart-wrap" class="chart-wrap" aria-live="polite">
          <div class="chart-loading"><span></span>正在加载历史数据</div>
        </div>
        <p id="history-source" class="chart-source">历史数据加载中</p>
      </div>

      <aside class="pair-summary" aria-label="币种对区间统计">
        <span class="section-kicker">RANGE SNAPSHOT</span>
        <h2>区间概览</h2>
        <div class="current-rate">
          <span id="stat-source">公共市场 · 当前值</span>
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
        <p>公共市场价用于建立统一基准；Wise 读取公开中间价；汇丰读取香港官网 TT 牌价；其他已接入香港银行通过公开聚合页读取 TT Buy / TT Sell，并按同一兑换方向经 HKD 计算交叉汇率。仅能登录后查看或没有可靠第三方实时来源的银行不会接入。</p>
      </div>
      <div class="method-grid">
        <article><span>01</span><h3>同方向再比较</h3><p>切换或反转币种后，所有来源统一换算为“1 基准币种 = x 目标币种”。</p></article>
        <article><span>02</span><h3>保留买卖价差</h3><p>18 家银行正反向分别按 TT Buy 与 TT Sell 计算，不用简单倒数掩盖银行买卖价差。</p></article>
        <article><span>03</span><h3>报价不是建议</h3><p>FXPulse 不预测收益、不推荐币种，也不代替产品文件或专业意见。</p></article>
      </div>
    </section>

    <section class="risk-note" aria-label="风险提示">
      <span aria-hidden="true">!</span>
      <div>
        <h2>重要风险提示</h2>
        <p>银行列表是公开指示性 TT 牌价，不是登录后优惠价或保证成交价；聚合数据与银行官网可能存在几分钟时间差。实际交易以相应银行确认页面为准。</p>
      </div>
      <a href="https://yoyorate.com/" target="_blank" rel="noopener noreferrer">查看数据来源 <span aria-hidden="true">↗</span></a>
    </section>

    <section class="authorization-note" aria-labelledby="authorization-title">
      <span class="section-kicker">DATA USE &amp; AUTHORIZATION</span>
      <h2 id="authorization-title">本站数据须经书面授权方可使用</h2>
      <p>未经 FXPulse 权利方书面授权，不得抓取、复制、镜像、转载、分发、转售、商业使用本站数据或整理结果；未经授权使用将被视为侵权。获得授权后仍必须在显著位置标注数据来自 FXPulse。</p>
    </section>
  </main>

  <footer>
    <a class="brand footer-brand" href="/"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>FX<span>Pulse</span></span></a>
    <p>独立汇率信息工具 · 与所列银行及 Wise 无隶属或合作关系</p>
    <p>© ${new Date().getUTCFullYear()} FXPulse · All rights reserved</p>
  </footer>

  <script id="fxpulse-data" type="application/json">${initialData}</script>
  <script src="/app.js?v=${ASSET_VERSION}" defer></script>
</body>
</html>`;
}

function renderBankPlaceholders(): string {
  return Array.from(
    { length: 6 },
    (_, index) => `<tr class="bank-row bank-row-loading">
      <td class="bank-rank">${index + 1}</td>
      <td class="bank-name"><strong>银行牌价加载中</strong><small>正在确认可用币种</small></td>
      <td class="bank-type">银行 TT</td>
      <td class="bank-rate">—</td>
      <td class="bank-diff">—</td>
      <td class="bank-basis">—</td>
      <td class="bank-updated">—</td>
    </tr>`,
  ).join("");
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
  return orderedQuoteCodes(base, activeQuote)
    .map((code) => {
      const meta = CURRENCIES[code];
      const rate = snapshot?.rates[code];
      return `<article class="rate-card ${code === activeQuote ? "active" : ""}" data-currency="${code}">
        <button type="button" class="rate-card-select" data-select-currency aria-label="比较 ${base} 兑 ${code} 多来源汇率并查看走势">
        <span class="rate-card-header">
          <span class="flag" aria-hidden="true">${meta.flag}</span>
          <span class="currency-id"><strong>${code}</strong><small>${meta.name}</small></span>
          <span class="pair-direction">${code === activeQuote ? "当前目标 · " : ""}1 ${base} → ${code}</span>
          <span class="card-arrow" aria-hidden="true">↗</span>
        </span>
        <span class="provider-rate-list">
          <span class="provider-rate provider-market available">
            <span class="provider-label"><i></i>公共市场</span>
            <strong data-overview-rate="market">${rate ? formatRate(rate, code) : "—"}<em>${code}</em></strong>
            <small data-overview-diff="market">基准</small>
          </span>
          <span class="provider-rate provider-wise loading">
            <span class="provider-label"><i></i>Wise</span>
            <strong data-overview-rate="wise">—<em>${code}</em></strong>
            <small data-overview-diff="wise">加载中</small>
          </span>
        </span>
        <span class="card-footer">选择 ${code} 查看详细对比与走势 <b>查看</b></span>
        </button>
        ${renderCardSourceConfig(code)}
      </article>`;
    })
    .join("");
}

function orderedQuoteCodes(base: CurrencyCode, activeQuote: CurrencyCode): CurrencyCode[] {
  return [
    activeQuote,
    ...CURRENCY_CODES.filter((code) => code !== base && code !== activeQuote),
  ];
}

function calculatorSourceOptions(): string {
  return `<optgroup label="市场与公开来源">
    <option value="market" selected>公共市场参考价（默认）</option>
    <option value="wise">Wise 公开中间价</option>
    <option value="hsbc_public">汇丰公开 TT</option>
  </optgroup>
  <optgroup label="香港银行公开 TT">
    ${HONG_KONG_BANKS.filter((bank) => bank.id !== "hsbc").map((bank) => `<option value="bank_${bank.id}">${bank.name}</option>`).join("")}
  </optgroup>`;
}

function overviewSourceCatalog(): Array<{ id: string; label: string; group: string }> {
  return [
    { id: "hsbc_public", label: "汇丰公开 TT", group: "官方公开牌价" },
    ...HONG_KONG_BANKS.filter((bank) => bank.id !== "hsbc").map((bank) => ({
      id: `bank_${bank.id}`,
      label: bank.name,
      group: "香港银行公开 TT",
    })),
  ];
}

function overviewSourceCheckboxes(scope: "global" | "card"): string {
  return overviewSourceCatalog()
    .map((source) => `<label class="overview-source-option"><input type="checkbox" value="${source.id}" data-overview-${scope}-source ${scope === "card" ? "disabled" : ""}><span><i></i>${source.label}</span></label>`)
    .join("");
}

function renderCardSourceConfig(code: CurrencyCode): string {
  return `<details class="card-source-config" data-card-source-config>
    <summary>卡片数据源 <b data-card-source-mode>跟随全局</b></summary>
    <div class="card-config-panel">
      <label class="card-follow-option"><input type="checkbox" data-card-follow-global checked><span>跟随全局配置</span></label>
      <p>取消跟随后，可为 ${code} 单独选择最多 5 个附加来源。</p>
      <div class="overview-config-options card-config-options">${overviewSourceCheckboxes("card")}</div>
      <div class="card-config-footer"><small data-card-config-note>当前跟随全局配置。</small><button type="button" data-card-config-reset>恢复全局</button></div>
    </div>
  </details>`;
}

function historySourceCheckbox(id: string, label: string, checked = false): string {
  return `<label class="chart-source-option"><input type="checkbox" value="${id}" data-history-source ${checked ? "checked" : ""}><span><i></i>${label}</span></label>`;
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
        description: "公共市场、Wise 与当前已接入 18 家香港银行公开 TT 牌价的比较及历史趋势工具",
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
        isAccessibleForFree: false,
        license: "https://github.com/wxywizard/FXPulse/blob/main/LICENSE",
        conditionsOfAccess:
          "Viewing is public. Reuse requires prior written authorization, prominent FXPulse attribution, and a link to the FXPulse repository.",
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "FXPulse 的汇丰列是什么报价？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "汇丰列显示香港官网公开 TT 牌价。客户卖出基准币种使用 TT Buy，买入目标币种使用 TT Sell；外币交叉盘经 HKD 计算。它不等于登录后优惠价或保证成交价。",
            },
          },
          {
            "@type": "Question",
            name: "汇率数据多久更新一次？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "页面按配置读取匿名公开来源并显示各自更新时间；Cloudflare Cron 定时归档公共市场、Wise、汇丰及当前已接入银行报价作为历史与故障降级。",
            },
          },
          {
            "@type": "Question",
            name: "FXPulse 包含哪些香港银行牌价？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "银行列表覆盖当前可从匿名公开来源取得同口径电汇买卖价的 18 家香港零售银行。需要登录且没有可靠第三方实时源的银行不接入。所有银行统一按客户卖出基准币种、买入目标币种计算。",
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
  return `# FXPulse\n\n> FXPulse is an independent exchange-rate comparison tool for 11 currencies and 18 Hong Kong retail banks. It is not affiliated with any bank or Wise.\n\n## What the site provides\n- Same-direction comparison of a public market reference rate, Wise's public mid-market rate, and Hong Kong bank public TT board rates.\n- A ranked table of public TT customer exchange rates from 18 Hong Kong retail banks.\n- Reversible directed pairs, a selectable-source calculator, and multi-source line or layered bar charts.\n- Base and quote currency selectors plus 7, 15, 30, 90 and 365 day trend windows.\n\n## Important interpretation\n- Bank cross-rates are calculated through HKD: the base leg uses TT Buy and the quote leg uses TT Sell.\n- Public board rates are indicative and are not logged-in preferential rates or guaranteed transaction prices.\n- Aggregated bank data can lag official bank pages by several minutes; HSBC is verified against its official public endpoint.\n- Source timestamps and provider status are shown separately.\n\n## Data-use authorization\n- The repository is source-visible but is not open-source software. All rights are reserved.\n- Viewing and search indexing are permitted. Scraping, copying, redistributing, commercial use, dataset creation, model training, or API mirroring requires prior written authorization.\n- Every authorized use must prominently attribute FXPulse and link to https://github.com/wxywizard/FXPulse.\n- Full private-use terms: https://github.com/wxywizard/FXPulse/blob/main/LICENSE\n\n## Key pages\n- Home: ${origin}/\n- Default pair: ${origin}/rates/hkd/${defaultPair.toLowerCase()}\n- Sitemap: ${origin}/sitemap.xml\n- Product requirements: https://github.com/wxywizard/FXPulse/blob/main/docs/PRD.md\n- Data collection: https://github.com/wxywizard/FXPulse/blob/main/docs/DATA_COLLECTION.md\n\n## Sources\n- Public market reference rates: https://www.exchangerate-api.com/\n- Wise public currency converter: https://wise.com/gb/currency-converter/\n- HSBC Hong Kong public currency rates: https://www.hsbc.com.hk/investments/products/foreign-exchange/currency-rate/\n- Hong Kong bank TT rate aggregation: https://yoyorate.com/\n- Historical institutional reference rates: https://frankfurter.dev/\n`;
}

function escapeScriptJson(value: string): string {
  return value.replaceAll("<", "\\u003c");
}
