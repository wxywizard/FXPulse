const CURRENCIES = {
  AUD: { name: "澳元", symbol: "A$", flag: "🇦🇺" },
  CAD: { name: "加拿大元", symbol: "C$", flag: "🇨🇦" },
  CHF: { name: "瑞士法郎", symbol: "CHF", flag: "🇨🇭" },
  CNY: { name: "人民币", symbol: "¥", flag: "🇨🇳" },
  EUR: { name: "欧元", symbol: "€", flag: "🇪🇺" },
  GBP: { name: "英镑", symbol: "£", flag: "🇬🇧" },
  HKD: { name: "港元", symbol: "HK$", flag: "🇭🇰" },
  JPY: { name: "日元", symbol: "¥", flag: "🇯🇵" },
  NZD: { name: "新西兰元", symbol: "NZ$", flag: "🇳🇿" },
  SGD: { name: "新加坡元", symbol: "S$", flag: "🇸🇬" },
  USD: { name: "美元", symbol: "$", flag: "🇺🇸" },
};

const CODES = Object.keys(CURRENCIES);
const initial = JSON.parse(document.querySelector("#fxpulse-data").textContent);
const state = {
  base: initial.base,
  quote: initial.quote,
  days: 30,
  snapshot: initial.snapshot,
  comparison: null,
  historyController: null,
  comparisonController: null,
};

const elements = {
  baseSelect: document.querySelector("#base-currency"),
  quoteSelect: document.querySelector("#quote-currency"),
  amount: document.querySelector("#base-amount"),
  convertedAmount: document.querySelector("#converted-amount"),
  calculatorRate: document.querySelector("#calculator-rate"),
  swapPair: document.querySelector("#swap-pair"),
  grid: document.querySelector("#rate-grid"),
  rateError: document.querySelector("#rate-error"),
  comparisonGrid: document.querySelector("#comparison-grid"),
  comparisonNote: document.querySelector("#comparison-note"),
  chart: document.querySelector("#chart-wrap"),
  historySource: document.querySelector("#history-source"),
  sourceUpdated: document.querySelector("#source-updated"),
};

function init() {
  bindEvents();
  updateBaseChrome();
  if (state.snapshot) {
    renderRates();
    updateSourceTime(state.snapshot.sourceUpdatedAt);
  } else {
    loadCurrentRates();
  }
  loadHistory();
  loadComparison();
}

function bindEvents() {
  elements.baseSelect.addEventListener("change", async (event) => {
    const nextBase = event.target.value;
    if (!CURRENCIES[nextBase]) return;
    state.base = nextBase;
    if (state.quote === state.base) state.quote = state.base === "USD" ? "HKD" : "USD";
    state.snapshot = null;
    updateBaseChrome();
    updatePairChrome();
    updateUrl();
    await Promise.all([loadCurrentRates(), loadHistory(), loadComparison()]);
  });

  elements.amount.addEventListener("input", updateConversion);

  elements.quoteSelect.addEventListener("change", (event) => {
    const nextQuote = event.target.value;
    if (!CURRENCIES[nextQuote] || nextQuote === state.base) {
      elements.quoteSelect.value = state.quote;
      return;
    }
    state.quote = nextQuote;
    updatePairChrome();
    updateUrl();
    Promise.all([loadHistory(), loadComparison()]);
  });

  elements.swapPair.addEventListener("click", async () => {
    const previousBase = state.base;
    state.base = state.quote;
    state.quote = previousBase;
    state.snapshot = null;
    updateBaseChrome();
    updatePairChrome();
    updateUrl();
    await Promise.all([loadCurrentRates(), loadHistory(), loadComparison()]);
  });

  elements.grid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-currency]");
    if (!card) return;
    state.quote = card.dataset.currency;
    updateActiveCard();
    updatePairChrome();
    updateUrl();
    Promise.all([loadHistory(), loadComparison()]);
    document.querySelector("#trend").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelector(".range-switcher").addEventListener("click", (event) => {
    const button = event.target.closest("[data-days]");
    if (!button) return;
    state.days = Number(button.dataset.days);
    document.querySelectorAll("[data-days]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    loadHistory();
  });

  window.addEventListener("popstate", () => {
    const match = location.pathname.match(/^\/rates\/([a-z]{3})\/([a-z]{3})\/?$/i);
    if (!match) return;
    const nextBase = match[1].toUpperCase();
    const nextQuote = match[2].toUpperCase();
    if (!CURRENCIES[nextBase] || !CURRENCIES[nextQuote] || nextBase === nextQuote) return;
    const baseChanged = nextBase !== state.base;
    state.base = nextBase;
    state.quote = nextQuote;
    if (baseChanged) state.snapshot = null;
    elements.baseSelect.value = state.base;
    elements.quoteSelect.value = state.quote;
    updateBaseChrome();
    updatePairChrome();
    if (baseChanged) loadCurrentRates();
    else updateActiveCard();
    loadHistory();
    loadComparison();
  });
}

async function loadCurrentRates() {
  elements.grid.classList.add("loading");
  elements.rateError.hidden = true;
  setDataStatus("正在连接数据源", "pending");
  try {
    const response = await fetch(`/api/rates?base=${state.base}`, { headers: { accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "汇率暂时不可用");
    state.snapshot = payload;
    renderRates();
    updateSourceTime(payload.sourceUpdatedAt);
    setDataStatus("数据源正常", "ok");
  } catch (error) {
    elements.rateError.textContent = `${error.message}。请稍后重试。`;
    elements.rateError.hidden = false;
    setDataStatus("参考价暂时不可用", "error");
  } finally {
    elements.grid.classList.remove("loading");
  }
}

async function loadComparison() {
  if (state.comparisonController) state.comparisonController.abort();
  state.comparisonController = new AbortController();
  elements.comparisonGrid.classList.add("loading");
  elements.comparisonNote.textContent = "正在加载各来源的可用报价与更新时间。";

  try {
    const query = new URLSearchParams({ base: state.base, quote: state.quote });
    const response = await fetch(`/api/compare?${query}`, {
      headers: { accept: "application/json" },
      signal: state.comparisonController.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "三源报价暂时不可用");
    state.comparison = payload;
    renderComparison(payload);
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.comparisonGrid.innerHTML = `<div class="comparison-error"><strong>暂时无法加载三源对比</strong><span>${escapeHtml(error.message)}</span><button type="button" id="retry-comparison">重试</button></div>`;
    elements.comparisonNote.textContent = "没有使用其他来源补造 Wise 或汇丰报价。";
    document.querySelector("#retry-comparison")?.addEventListener("click", loadComparison);
  } finally {
    elements.comparisonGrid.classList.remove("loading");
  }
}

async function loadHistory() {
  if (state.historyController) state.historyController.abort();
  state.historyController = new AbortController();
  elements.chart.innerHTML = '<div class="chart-loading"><span></span>正在加载历史数据</div>';
  elements.historySource.textContent = "历史数据加载中";

  try {
    const query = new URLSearchParams({ base: state.base, quote: state.quote, days: String(state.days) });
    const response = await fetch(`/api/history?${query}`, {
      headers: { accept: "application/json" },
      signal: state.historyController.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "历史数据暂时不可用");
    renderChart(payload.points);
    updateStats(payload.points);
    elements.historySource.textContent = `来源：${payload.provider} · ${payload.frequency === "intraday" ? "盘中快照" : "日频参考价"}`;
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.chart.innerHTML = `<div class="chart-error"><strong>暂时无法加载走势图</strong><span>${escapeHtml(error.message)}</span><button type="button" id="retry-history">重试</button></div>`;
    elements.historySource.textContent = "没有使用模拟或补造数据";
    document.querySelector("#retry-history")?.addEventListener("click", loadHistory);
  }
}

function renderRates() {
  elements.grid.innerHTML = CODES.filter((code) => code !== state.base)
    .map((code) => {
      const meta = CURRENCIES[code];
      const rate = state.snapshot?.rates?.[code] ?? null;
      const inverse = rate ? 1 / rate : null;
      return `<button type="button" class="rate-card ${code === state.quote ? "active" : ""}" data-currency="${code}" aria-label="查看 ${state.base} 兑 ${code} 历史走势">
        <span class="flag" aria-hidden="true">${meta.flag}</span>
        <span class="currency-id"><strong>${code}</strong><small>${meta.name}</small></span>
        <span class="rate-value"><strong data-rate>${rate ? formatRate(rate, code) : "—"}</strong><small>1 ${state.base} = <span>${rate ? formatRate(rate, code) : "—"}</span> ${code}</small></span>
        <span class="inverse">1 ${code} = <b>${inverse ? formatRate(inverse, state.base) : "—"}</b> ${state.base}</span>
        <span class="card-arrow" aria-hidden="true">↗</span>
      </button>`;
    })
    .join("");
  document.querySelector("#rates-title").textContent = `1 ${state.base} 的公共市场参考价`;
  updateConversion();
}

function renderComparison(payload) {
  elements.comparisonGrid.innerHTML = payload.sources
    .map((source) => {
      const available = typeof source.rate === "number" && Number.isFinite(source.rate);
      const statusLabel = source.status === "available" ? "可用" : source.status === "stale" ? "需更新" : "待接入";
      const difference = typeof source.differenceFromMarketPct === "number"
        ? source.id === "market"
          ? "比较基准"
          : `较公共市场价 ${source.differenceFromMarketPct >= 0 ? "+" : ""}${source.differenceFromMarketPct.toFixed(3)}%`
        : source.reason || "当前没有可验证报价";
      const rateText = available
        ? `1 ${state.base} = ${formatRate(source.rate, state.quote)} ${state.quote}`
        : "暂无报价";
      const updated = source.sourceUpdatedAt ? formatSourceTime(source.sourceUpdatedAt) : "—";
      return `<article class="source-card source-${escapeHtml(source.id)} ${escapeHtml(source.status)}">
        <div class="source-card-head"><span>${escapeHtml(source.label)}</span><b>${statusLabel}</b></div>
        <strong>${rateText}</strong>
        <p>${escapeHtml(difference)}</p>
        <small>更新时间：${escapeHtml(updated)}</small>
        <a href="${escapeHtml(source.providerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.provider)} <span aria-hidden="true">↗</span></a>
      </article>`;
    })
    .join("");
  elements.comparisonNote.textContent = payload.interpretation;
}

function renderChart(points) {
  if (!Array.isArray(points) || points.length < 2) throw new Error("历史数据点不足");
  const width = Math.max(360, Math.round(elements.chart.clientWidth || 960));
  const height = window.innerWidth <= 720 ? 300 : 340;
  const padding = { top: 24, right: 28, bottom: 42, left: 74 };
  const values = points.map((point) => Number(point.rate));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = rawMax - rawMin || Math.max(rawMax * 0.01, 0.0001);
  const min = rawMin - spread * 0.12;
  const max = rawMax + spread * 0.12;
  const x = (index) => padding.left + (index / (points.length - 1)) * (width - padding.left - padding.right);
  const y = (value) => padding.top + ((max - value) / (max - min)) * (height - padding.top - padding.bottom);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(2)},${y(point.rate).toFixed(2)}`).join(" ");
  const area = `${path} L${x(points.length - 1)},${height - padding.bottom} L${x(0)},${height - padding.bottom} Z`;

  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const value = min + ((max - min) * index) / 4;
    const posY = y(value);
    return `<g><line x1="${padding.left}" x2="${width - padding.right}" y1="${posY}" y2="${posY}"/><text x="${padding.left - 14}" y="${posY + 4}">${formatRate(value, state.quote)}</text></g>`;
  }).join("");

  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 3), Math.floor(((points.length - 1) * 2) / 3), points.length - 1])];
  const labels = labelIndexes.map((index) => `<text x="${x(index)}" y="${height - 12}" text-anchor="middle">${formatDate(points[index].date)}</text>`).join("");
  const lastPoint = points.at(-1);

  elements.chart.innerHTML = `<figure class="rate-chart">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-desc" preserveAspectRatio="none">
      <title id="chart-title">${state.base} 兑 ${state.quote} 过去 ${state.days} 天参考汇率走势</title>
      <desc id="chart-desc">区间最低 ${formatRate(rawMin, state.quote)}，最高 ${formatRate(rawMax, state.quote)}，最新 ${formatRate(lastPoint.rate, state.quote)}。</desc>
      <defs><linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ce6a1" stop-opacity=".28"/><stop offset="1" stop-color="#3ce6a1" stop-opacity="0"/></linearGradient></defs>
      <g class="chart-grid">${gridLines}${labels}</g>
      <path class="chart-area" d="${area}"/>
      <path class="chart-line-glow" d="${path}"/>
      <path class="chart-line" d="${path}"/>
      <line class="chart-cursor" x1="0" x2="0" y1="${padding.top}" y2="${height - padding.bottom}" hidden/>
      <circle class="chart-point" cx="${x(points.length - 1)}" cy="${y(lastPoint.rate)}" r="5"/>
      <rect class="chart-hit" x="${padding.left}" y="${padding.top}" width="${width - padding.left - padding.right}" height="${height - padding.top - padding.bottom}" fill="transparent"/>
    </svg>
    <div class="chart-tooltip" hidden><span></span><strong></strong><small></small></div>
  </figure>`;

  const figure = elements.chart.querySelector("figure");
  const svg = figure.querySelector("svg");
  const hit = svg.querySelector(".chart-hit");
  const cursor = svg.querySelector(".chart-cursor");
  const point = svg.querySelector(".chart-point");
  const tooltip = figure.querySelector(".chart-tooltip");

  hit.addEventListener("pointermove", (event) => {
    const rect = svg.getBoundingClientRect();
    const relative = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const viewX = relative * width;
    const index = Math.max(0, Math.min(points.length - 1, Math.round(((viewX - padding.left) / (width - padding.left - padding.right)) * (points.length - 1))));
    const item = points[index];
    const itemX = x(index);
    const itemY = y(item.rate);
    cursor.hidden = false;
    cursor.setAttribute("x1", itemX);
    cursor.setAttribute("x2", itemX);
    point.setAttribute("cx", itemX);
    point.setAttribute("cy", itemY);
    tooltip.hidden = false;
    tooltip.querySelector("span").textContent = formatDateTime(item.date);
    tooltip.querySelector("strong").textContent = formatRate(item.rate, state.quote);
    tooltip.querySelector("small").textContent = `${state.quote} / 1 ${state.base}`;
    tooltip.style.left = `${Math.max(68, Math.min(rect.width - 68, (itemX / width) * rect.width))}px`;
    tooltip.style.top = `${Math.max(8, (itemY / height) * rect.height - 92)}px`;
  });

  hit.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
    cursor.hidden = true;
    point.setAttribute("cx", x(points.length - 1));
    point.setAttribute("cy", y(lastPoint.rate));
  });
}

function updateStats(points) {
  const values = points.map((point) => Number(point.rate));
  const first = values[0];
  const current = values.at(-1);
  const change = ((current - first) / first) * 100;
  setText("#stat-current", formatRate(current, state.quote));
  setText("#stat-high", formatRate(Math.max(...values), state.quote));
  setText("#stat-low", formatRate(Math.min(...values), state.quote));
  const changeElement = document.querySelector("#stat-change");
  changeElement.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  changeElement.classList.toggle("positive", change >= 0);
  changeElement.classList.toggle("negative", change < 0);
  setText("#stat-pair", `${state.quote} / ${state.base}`);
}

function updateConversion() {
  if (!state.snapshot?.rates) {
    elements.convertedAmount.textContent = "—";
    elements.calculatorRate.textContent = `1 ${state.base} = — ${state.quote}`;
    return;
  }
  const amount = Math.max(0, Number(elements.amount.value) || 0);
  const rate = state.snapshot.rates[state.quote];
  elements.convertedAmount.textContent = formatAmount(amount * rate, state.quote);
  elements.calculatorRate.textContent = `1 ${state.base} = ${formatRate(rate, state.quote)} ${state.quote}`;
}

function updateBaseChrome() {
  const meta = CURRENCIES[state.base];
  elements.baseSelect.value = state.base;
  setText("#base-flag", meta.flag);
  renderRates();
  updatePairChrome();
}

function updatePairChrome() {
  setText("#pair-base", state.base);
  setText("#pair-quote", state.quote);
  setText("#pair-base-name", CURRENCIES[state.base].name);
  setText("#pair-quote-name", CURRENCIES[state.quote].name);
  setText("#quote-flag", CURRENCIES[state.quote].flag);
  elements.quoteSelect.value = state.quote;
  Array.from(elements.quoteSelect.options).forEach((option) => {
    option.disabled = option.value === state.base;
  });
  setText("#comparison-base", state.base);
  setText("#comparison-quote", state.quote);
  setText("#comparison-unit-base", state.base);
  setText("#comparison-unit-quote", state.quote);
  setText("#stat-pair", `${state.quote} / ${state.base}`);
  elements.swapPair.setAttribute("aria-label", `反转 ${state.base}/${state.quote} 为 ${state.quote}/${state.base}`);
  updateActiveCard();
  updateConversion();
}

function updateActiveCard() {
  elements.grid.querySelectorAll("[data-currency]").forEach((card) => card.classList.toggle("active", card.dataset.currency === state.quote));
}

function updateUrl() {
  const path = `/rates/${state.base.toLowerCase()}/${state.quote.toLowerCase()}`;
  if (location.pathname !== path) history.pushState({}, "", path);
  const title = `${state.base}/${state.quote} 汇率与历史走势｜FXPulse`;
  document.title = title;
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", `${location.origin}${path}`);
}

function updateSourceTime(value) {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  elements.sourceUpdated.textContent = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Hong_Kong",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function setDataStatus(label, status) {
  setText("#data-status", label);
  const dot = document.querySelector("#status-dot");
  if (dot) dot.className = `status-dot ${status}`;
}

function formatRate(value, quote) {
  const max = quote === "JPY" ? 3 : value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: Math.min(2, max), maximumFractionDigits: max }).format(value);
}

function formatAmount(value, quote) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: quote === "JPY" ? 0 : 2 }).format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function formatDateTime(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: value.includes("T") && value.length > 10 ? "2-digit" : undefined,
    minute: value.includes("T") && value.length > 10 ? "2-digit" : undefined,
    hour12: false,
    timeZone: "Asia/Hong_Kong",
  }).format(date);
}

function formatSourceTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Hong_Kong",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

init();
