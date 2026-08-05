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
  bankComparison: null,
  overview: null,
  overviewError: null,
  calculatorSource: "market",
  chartType: "line",
  chartSources: new Set(["market"]),
  history: null,
  historyController: null,
  comparisonController: null,
  bankController: null,
  overviewController: null,
};

const elements = {
  baseSelect: document.querySelector("#base-currency"),
  quoteSelect: document.querySelector("#quote-currency"),
  amount: document.querySelector("#base-amount"),
  convertedAmount: document.querySelector("#converted-amount"),
  calculatorRate: document.querySelector("#calculator-rate"),
  calculatorRateSource: document.querySelector("#calculator-rate-source"),
  calculatorSource: document.querySelector("#calculator-source"),
  calculatorSourceNote: document.querySelector("#calculator-source-note"),
  swapPair: document.querySelector("#swap-pair"),
  overviewSwap: document.querySelector("#overview-swap"),
  grid: document.querySelector("#rate-grid"),
  rateError: document.querySelector("#rate-error"),
  overviewError: document.querySelector("#overview-error"),
  comparisonGrid: document.querySelector("#comparison-grid"),
  comparisonNote: document.querySelector("#comparison-note"),
  bankTableBody: document.querySelector("#bank-table-body"),
  bankTableWrap: document.querySelector(".bank-table-wrap"),
  bankError: document.querySelector("#bank-error"),
  bankBest: document.querySelector("#bank-best"),
  bankAvailable: document.querySelector("#bank-available"),
  bankNote: document.querySelector("#bank-note"),
  chart: document.querySelector("#chart-wrap"),
  chartLegend: document.querySelector("#chart-legend"),
  chartSourcePicker: document.querySelector("#chart-source-picker"),
  chartSelectionNote: document.querySelector("#chart-selection-note"),
  historySource: document.querySelector("#history-source"),
  sourceUpdated: document.querySelector("#source-updated"),
};

function init() {
  bindEvents();
  updateChartSelectionNote();
  refreshCalculatorSources();
  updateBaseChrome();
  if (state.snapshot) {
    renderRates();
    updateSourceTime(state.snapshot.sourceUpdatedAt);
  } else {
    loadCurrentRates();
  }
  loadHistory();
  loadComparison();
  loadBanks();
  loadOverview();
}

function bindEvents() {
  elements.baseSelect.addEventListener("change", async (event) => {
    const nextBase = event.target.value;
    if (!CURRENCIES[nextBase]) return;
    state.base = nextBase;
    if (state.quote === state.base) state.quote = state.base === "USD" ? "HKD" : "USD";
    resetPairData();
    state.snapshot = null;
    state.overview = null;
    updateBaseChrome();
    updatePairChrome();
    updateUrl();
    await Promise.all([loadCurrentRates(), loadHistory(), loadComparison(), loadBanks(), loadOverview()]);
  });

  elements.amount.addEventListener("input", updateConversion);
  elements.calculatorSource.addEventListener("change", (event) => {
    state.calculatorSource = event.target.value;
    updateConversion();
  });

  elements.quoteSelect.addEventListener("change", (event) => {
    const nextQuote = event.target.value;
    if (!CURRENCIES[nextQuote] || nextQuote === state.base) {
      elements.quoteSelect.value = state.quote;
      return;
    }
    state.quote = nextQuote;
    resetPairData();
    updatePairChrome();
    renderRates();
    updateUrl();
    Promise.all([loadHistory(), loadComparison(), loadBanks()]);
  });

  elements.swapPair.addEventListener("click", swapPair);
  elements.overviewSwap.addEventListener("click", swapPair);

  elements.grid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-currency]");
    if (!card) return;
    state.quote = card.dataset.currency;
    resetPairData();
    updatePairChrome();
    renderRates();
    updateUrl();
    Promise.all([loadHistory(), loadComparison(), loadBanks()]);
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

  document.querySelector(".chart-type-switcher").addEventListener("click", (event) => {
    const button = event.target.closest("[data-chart-type]");
    if (!button) return;
    state.chartType = button.dataset.chartType;
    document.querySelectorAll("[data-chart-type]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    if (state.history) renderHistory(state.history);
  });

  elements.chartSourcePicker.addEventListener("change", (event) => {
    const input = event.target.closest("[data-history-source]");
    if (!input) return;
    if (input.checked) state.chartSources.add(input.value);
    else state.chartSources.delete(input.value);
    if (state.chartSources.size === 0) {
      input.checked = true;
      state.chartSources.add(input.value);
    }
    updateChartSelectionNote();
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
    resetPairData();
    if (baseChanged) {
      state.snapshot = null;
      state.overview = null;
    }
    elements.baseSelect.value = state.base;
    elements.quoteSelect.value = state.quote;
    updateBaseChrome();
    updatePairChrome();
    if (baseChanged) {
      loadCurrentRates();
      loadOverview();
    }
    else renderRates();
    loadHistory();
    loadComparison();
    loadBanks();
  });
}

async function swapPair() {
  const previousBase = state.base;
  state.base = state.quote;
  state.quote = previousBase;
  resetPairData();
  state.snapshot = null;
  state.overview = null;
  updateBaseChrome();
  updatePairChrome();
  updateUrl();
  await Promise.all([loadCurrentRates(), loadHistory(), loadComparison(), loadBanks(), loadOverview()]);
}

function resetPairData() {
  state.comparison = null;
  state.bankComparison = null;
  state.history = null;
  state.calculatorSource = "market";
  elements.calculatorSource.value = "market";
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

async function loadBanks() {
  if (state.bankController) state.bankController.abort();
  state.bankController = new AbortController();
  elements.bankError.hidden = true;
  elements.bankTableWrap.classList.add("loading");
  elements.bankBest.textContent = "正在加载";
  elements.bankAvailable.textContent = "— / 18";

  try {
    const query = new URLSearchParams({ base: state.base, quote: state.quote });
    const response = await fetch(`/api/banks?${query}`, {
      headers: { accept: "application/json" },
      signal: state.bankController.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "香港银行牌价暂时不可用");
    state.bankComparison = payload;
    renderBanks(payload);
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.bankError.textContent = `${error.message}。公共市场、Wise 与汇丰官方三源仍可正常使用。`;
    elements.bankError.hidden = false;
    elements.bankBest.textContent = "暂不可用";
    elements.bankTableBody.innerHTML = `<tr class="bank-row bank-row-error"><td colspan="6"><strong>银行牌价加载失败</strong><button type="button" id="retry-banks">重试</button></td></tr>`;
    document.querySelector("#retry-banks")?.addEventListener("click", loadBanks);
  } finally {
    elements.bankTableWrap.classList.remove("loading");
  }
}

async function loadOverview() {
  if (state.overviewController) state.overviewController.abort();
  state.overviewController = new AbortController();
  state.overviewError = null;
  elements.overviewError.hidden = true;
  elements.grid.classList.add("provider-loading");

  try {
    const query = new URLSearchParams({ base: state.base });
    const response = await fetch(`/api/overview?${query}`, {
      headers: { accept: "application/json" },
      signal: state.overviewController.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "三源总览暂时不可用");
    state.overview = payload;
    renderRates();
  } catch (error) {
    if (error.name === "AbortError") return;
    state.overviewError = error.message;
    renderRates();
    elements.overviewError.textContent = `Wise 与汇丰总览暂时无法加载：${error.message}。公共市场参考价仍可使用。`;
    elements.overviewError.hidden = false;
  } finally {
    elements.grid.classList.remove("provider-loading");
  }
}

async function loadHistory() {
  if (state.historyController) state.historyController.abort();
  state.historyController = new AbortController();
  elements.chart.innerHTML = '<div class="chart-loading"><span></span>正在加载历史数据</div>';
  elements.historySource.textContent = "历史数据加载中";

  try {
    const query = new URLSearchParams({
      base: state.base,
      quote: state.quote,
      days: String(state.days),
      sources: [...state.chartSources].join(","),
    });
    const response = await fetch(`/api/history?${query}`, {
      headers: { accept: "application/json" },
      signal: state.historyController.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "历史数据暂时不可用");
    state.history = payload;
    renderHistory(payload);
  } catch (error) {
    if (error.name === "AbortError") return;
    elements.chart.innerHTML = `<div class="chart-error"><strong>暂时无法加载走势图</strong><span>${escapeHtml(error.message)}</span><button type="button" id="retry-history">重试</button></div>`;
    elements.historySource.textContent = "没有使用模拟或补造数据";
    document.querySelector("#retry-history")?.addEventListener("click", loadHistory);
  }
}

function renderHistory(payload) {
  const available = (payload.series ?? []).filter(
    (series) => series.status === "available" && Array.isArray(series.points) && series.points.length >= 2,
  );
  const unavailable = (payload.series ?? []).filter((series) => series.status !== "available");
  if (available.length === 0) {
    const reasons = unavailable.map((series) => `${series.label}：${series.reason}`).join("；");
    elements.chart.innerHTML = `<div class="chart-error"><strong>所选来源的历史数据仍在积累</strong><span>${escapeHtml(reasons || "至少需要两个真实快照")}</span></div>`;
    elements.chartLegend.innerHTML = "";
    elements.historySource.textContent = "没有使用其他数据源补造历史曲线";
    clearStats();
    return;
  }

  renderChart(available, state.chartType);
  updateStats(available[0]);
  renderChartLegend(available, unavailable);
  const availableProviders = available.map((series) => series.provider).join(" · ");
  const unavailableText = unavailable.length
    ? `；${unavailable.map((series) => `${series.label}历史积累中`).join("、")}`
    : "";
  elements.historySource.textContent = `来源：${availableProviders}${unavailableText}`;
}

function renderRates() {
  elements.grid.innerHTML = orderedQuoteCodes()
    .map((code) => {
      const meta = CURRENCIES[code];
      const pair = state.overview?.pairs?.find((item) => item.quote === code);
      const sources = new Map((pair?.sources ?? []).map((source) => [source.id, source]));
      const marketFallback = state.snapshot?.rates?.[code]
        ? {
            id: "market",
            status: "available",
            rate: state.snapshot.rates[code],
            differenceFromMarketPct: 0,
          }
        : null;
      return `<button type="button" class="rate-card ${code === state.quote ? "active" : ""}" data-currency="${code}" aria-label="比较 ${state.base} 兑 ${code} 三种来源汇率并查看走势">
        <span class="rate-card-header">
          <span class="flag" aria-hidden="true">${meta.flag}</span>
          <span class="currency-id"><strong>${code}</strong><small>${meta.name}</small></span>
          <span class="pair-direction">${code === state.quote ? "当前目标 · " : ""}1 ${state.base} → ${code}</span>
          <span class="card-arrow" aria-hidden="true">↗</span>
        </span>
        <span class="provider-rate-list">
          ${renderOverviewSource("market", "公共市场", sources.get("market") ?? marketFallback, code)}
          ${renderOverviewSource("wise", "Wise", sources.get("wise") ?? null, code)}
          ${renderOverviewSource("hsbc_public", "汇丰 TT", sources.get("hsbc_public") ?? null, code)}
        </span>
        <span class="card-footer">选择 ${code} 查看详细对比与走势 <b>查看</b></span>
      </button>`;
    })
    .join("");
  document.querySelector("#rates-title").textContent = `1 ${state.base} 兑换其他币种 · 三源报价`;
  refreshCalculatorSources();
  updateConversion();
}

function orderedQuoteCodes() {
  return [state.quote, ...CODES.filter((code) => code !== state.base && code !== state.quote)];
}

function renderOverviewSource(id, label, source, quote) {
  const available = typeof source?.rate === "number" && Number.isFinite(source.rate);
  const status = source?.status ?? (state.overviewError ? "unavailable" : "loading");
  let detail = "加载中";
  if (status === "unavailable") detail = "暂不可用";
  else if (available && id === "market") detail = "基准";
  else if (available && typeof source.differenceFromMarketPct === "number") {
    const difference = source.differenceFromMarketPct;
    detail = `${difference >= 0 ? "+" : ""}${difference.toFixed(3)}%`;
  } else if (status === "stale") detail = "最近归档";

  return `<span class="provider-rate provider-${escapeHtml(id)} ${escapeHtml(status)}">
    <span class="provider-label"><i></i>${escapeHtml(label)}</span>
    <strong data-overview-rate="${escapeHtml(id)}">${available ? formatRate(source.rate, quote) : "—"}<em>${quote}</em></strong>
    <small data-overview-diff="${escapeHtml(id)}">${escapeHtml(detail)}</small>
  </span>`;
}

function renderComparison(payload) {
  elements.comparisonGrid.innerHTML = payload.sources
    .map((source) => {
      const available = typeof source.rate === "number" && Number.isFinite(source.rate);
      const statusLabel = source.status === "available" ? "实时" : source.status === "stale" ? "归档" : "暂不可用";
      const difference = typeof source.differenceFromMarketPct === "number"
        ? source.id === "market"
          ? "比较基准"
          : `较公共市场价 ${source.differenceFromMarketPct >= 0 ? "+" : ""}${source.differenceFromMarketPct.toFixed(3)}%`
        : source.reason || "当前没有可验证报价";
      const rateText = available
        ? `1 ${state.base} = ${formatRate(source.rate, state.quote)} ${state.quote}`
        : "暂无报价";
      const updated = source.sourceUpdatedAt ? formatSourceTime(source.sourceUpdatedAt) : "—";
      const basis = source.basis
        ? `<small class="source-basis">口径：${escapeHtml(source.basis)}</small>`
        : "";
      const fallback = available && source.reason
        ? `<small class="source-warning">${escapeHtml(source.reason)}</small>`
        : "";
      return `<article class="source-card source-${escapeHtml(source.id)} ${escapeHtml(source.status)}">
        <div class="source-card-head"><span>${escapeHtml(source.label)}</span><b>${statusLabel}</b></div>
        <strong>${rateText}</strong>
        <p>${escapeHtml(difference)}</p>
        ${basis}${fallback}
        <small>更新时间：${escapeHtml(updated)}</small>
        <a href="${escapeHtml(source.providerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.provider)} <span aria-hidden="true">↗</span></a>
      </article>`;
    })
    .join("");
  elements.comparisonNote.textContent = payload.interpretation;
  refreshCalculatorSources();
  updateConversion();
}

function renderBanks(payload) {
  elements.bankTableBody.innerHTML = payload.banks
    .map((bank) => {
      const available = typeof bank.rate === "number" && Number.isFinite(bank.rate);
      const difference = typeof bank.differenceFromMarketPct === "number"
        ? `${bank.differenceFromMarketPct >= 0 ? "+" : ""}${bank.differenceFromMarketPct.toFixed(3)}%`
        : bank.reason || "暂不可用";
      const observed = bank.observedAt ? formatSourceTime(bank.observedAt) : "—";
      const sourceLabel = bank.source === "HSBC Hong Kong" ? "官方直连" : "公开聚合";
      return `<tr class="bank-row ${available ? "available" : "unavailable"} ${bank.rank === 1 ? "best" : ""}">
        <td class="bank-rank">${available ? `#${bank.rank}` : "—"}</td>
        <td class="bank-name">
          <a href="${escapeHtml(bank.sourceUrl)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(bank.name)}</strong><small>${escapeHtml(bank.englishName)}</small></a>
          <em>${escapeHtml(sourceLabel)}</em>
        </td>
        <td class="bank-rate">${available ? `<strong>${formatRate(bank.rate, state.quote)}</strong><small>${state.quote}</small>` : "—"}</td>
        <td class="bank-diff ${available && bank.differenceFromMarketPct >= 0 ? "positive" : "negative"}">${escapeHtml(difference)}</td>
        <td class="bank-basis">${escapeHtml(bank.basis || bank.reason || "该币种暂未公布")}</td>
        <td class="bank-updated">${escapeHtml(observed)}</td>
      </tr>`;
    })
    .join("");

  const best = payload.bestBank;
  elements.bankBest.textContent = best
    ? `${best.name} · ${formatRate(best.rate, state.quote)} ${state.quote}`
    : "暂无可用报价";
  elements.bankAvailable.textContent = `${payload.availableBankCount} / ${payload.totalBankCount}`;
  const warning = payload.warnings?.length ? ` 当前提示：${payload.warnings.join("；")}。` : "";
  elements.bankNote.textContent = `${payload.interpretation} ${payload.source.note}${warning}`;
  refreshCalculatorSources();
  updateConversion();
}

function renderChart(seriesList, chartType) {
  const plottedSeries = seriesList.map((series) => ({
    ...series,
    points: downsamplePoints(series.points, chartType === "bar" ? 100 : 260),
  }));
  const allPoints = plottedSeries.flatMap((series) => series.points);
  if (allPoints.length < 2) throw new Error("历史数据点不足");
  const width = Math.max(360, Math.round(elements.chart.clientWidth || 960));
  const height = window.innerWidth <= 720 ? 300 : 340;
  const padding = { top: 24, right: 28, bottom: 42, left: 74 };
  const values = allPoints.map((point) => Number(point.rate));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = rawMax - rawMin || Math.max(rawMax * 0.01, 0.0001);
  const min = rawMin - spread * 0.12;
  const max = rawMax + spread * 0.12;
  const minTimestamp = Math.min(...allPoints.map((point) => Number(point.timestamp)));
  const maxTimestamp = Math.max(...allPoints.map((point) => Number(point.timestamp)));
  const timeSpread = maxTimestamp - minTimestamp || 1;
  const x = (timestamp) => padding.left + ((timestamp - minTimestamp) / timeSpread) * (width - padding.left - padding.right);
  const y = (value) => padding.top + ((max - value) / (max - min)) * (height - padding.top - padding.bottom);

  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const value = min + ((max - min) * index) / 4;
    const posY = y(value);
    return `<g><line x1="${padding.left}" x2="${width - padding.right}" y1="${posY}" y2="${posY}"/><text x="${padding.left - 14}" y="${posY + 4}">${formatRate(value, state.quote)}</text></g>`;
  }).join("");
  const labels = [0, 1, 2, 3]
    .map((index) => minTimestamp + (timeSpread * index) / 3)
    .map((timestamp) => `<text x="${x(timestamp)}" y="${height - 12}" text-anchor="middle">${formatDate(new Date(timestamp * 1000).toISOString())}</text>`)
    .join("");
  const plot = chartType === "bar"
    ? renderBarSeries(plottedSeries, x, y, height, padding, width)
    : renderLineSeries(plottedSeries, x, y);
  const titleSources = plottedSeries.map((series) => series.label).join("、");

  elements.chart.innerHTML = `<figure class="rate-chart chart-${chartType}">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-desc" preserveAspectRatio="none">
      <title id="chart-title">${state.base} 兑 ${state.quote} 过去 ${state.days} 天${chartType === "bar" ? "柱状" : "折线"}走势：${escapeHtml(titleSources)}</title>
      <desc id="chart-desc">多来源区间最低 ${formatRate(rawMin, state.quote)}，最高 ${formatRate(rawMax, state.quote)}。柱状图使用颜色叠层区分来源，数值不相加。</desc>
      <g class="chart-grid">${gridLines}${labels}</g>
      <g class="chart-series">${plot}</g>
      <line class="chart-cursor" x1="0" x2="0" y1="${padding.top}" y2="${height - padding.bottom}" hidden/>
      <rect class="chart-hit" x="${padding.left}" y="${padding.top}" width="${width - padding.left - padding.right}" height="${height - padding.top - padding.bottom}" fill="transparent"/>
    </svg>
    <div class="chart-tooltip chart-tooltip-multi" hidden></div>
  </figure>`;

  const figure = elements.chart.querySelector("figure");
  const svg = figure.querySelector("svg");
  const hit = svg.querySelector(".chart-hit");
  const cursor = svg.querySelector(".chart-cursor");
  const tooltip = figure.querySelector(".chart-tooltip");

  hit.addEventListener("pointermove", (event) => {
    const rect = svg.getBoundingClientRect();
    const relative = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const targetTimestamp = minTimestamp + relative * timeSpread;
    const nearest = plottedSeries.map((series, index) => ({
      series,
      item: nearestPoint(series.points, targetTimestamp),
      color: sourceColor(series.id, index),
    }));
    const anchor = nearest[0]?.item;
    if (!anchor) return;
    const itemX = x(anchor.timestamp);
    cursor.hidden = false;
    cursor.setAttribute("x1", itemX);
    cursor.setAttribute("x2", itemX);
    tooltip.hidden = false;
    tooltip.innerHTML = `<span>${escapeHtml(formatDateTime(anchor.date))}</span>${nearest
      .map(({ series, item, color }) => `<strong><i style="background:${color}"></i><b>${escapeHtml(series.label)}</b><em>${formatRate(item.rate, state.quote)} ${state.quote}</em></strong>`)
      .join("")}<small>1 ${state.base} 可兑换的 ${state.quote}</small>`;
    tooltip.style.left = `${Math.max(105, Math.min(rect.width - 105, (itemX / width) * rect.width))}px`;
    tooltip.style.top = "10px";
  });

  hit.addEventListener("pointerleave", () => {
    tooltip.hidden = true;
    cursor.hidden = true;
  });
}

function renderLineSeries(seriesList, x, y) {
  return seriesList.map((series, index) => {
    const color = sourceColor(series.id, index);
    const path = series.points
      .map((point, pointIndex) => `${pointIndex ? "L" : "M"}${x(point.timestamp).toFixed(2)},${y(point.rate).toFixed(2)}`)
      .join(" ");
    const lastPoint = series.points.at(-1);
    return `<path class="chart-line-glow" d="${path}" style="stroke:${color}"/><path class="chart-line" d="${path}" style="stroke:${color}"/><circle class="chart-point" cx="${x(lastPoint.timestamp)}" cy="${y(lastPoint.rate)}" r="4.5" style="stroke:${color}"/>`;
  }).join("");
}

function renderBarSeries(seriesList, x, y, height, padding, width) {
  const maxPoints = Math.max(...seriesList.map((series) => series.points.length));
  const baseWidth = Math.max(1.5, Math.min(18, ((width - padding.left - padding.right) / Math.max(2, maxPoints)) * 0.72));
  const bottom = height - padding.bottom;
  return seriesList.map((series, index) => {
    const color = sourceColor(series.id, index);
    const barWidth = Math.max(1.2, baseWidth * (1 - (index / Math.max(6, seriesList.length)) * 0.35));
    return series.points.map((point) => {
      const top = y(point.rate);
      return `<rect class="chart-bar" x="${(x(point.timestamp) - barWidth / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(1, bottom - top).toFixed(2)}" rx="${Math.min(2, barWidth / 3).toFixed(2)}" style="fill:${color}"/>`;
    }).join("");
  }).join("");
}

function downsamplePoints(points, limit) {
  if (points.length <= limit) return points;
  const sampled = [];
  const step = (points.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) sampled.push(points[Math.round(index * step)]);
  return sampled;
}

function nearestPoint(points, timestamp) {
  return points.reduce((nearest, point) =>
    Math.abs(point.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp) ? point : nearest,
  points[0]);
}

function sourceColor(id, index = 0) {
  const core = { market: "#57efb3", wise: "#76c8ff", hsbc_public: "#ff9690" };
  if (core[id]) return core[id];
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${(hash + index * 17) % 360} 72% 64%)`;
}

function renderChartLegend(available, unavailable) {
  elements.chartLegend.innerHTML = [
    ...available.map((series, index) => `<span><i style="background:${sourceColor(series.id, index)}"></i>${escapeHtml(series.label)}</span>`),
    ...unavailable.map((series) => `<span class="unavailable"><i></i>${escapeHtml(series.label)} · 历史积累中</span>`),
  ].join("");
}

function updateStats(series) {
  const points = series.points;
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
  setText("#stat-source", `${series.label} · 当前值`);
  setText("#stat-pair", `${state.quote} / ${state.base}`);
}

function clearStats() {
  setText("#stat-source", "暂无可用历史");
  setText("#stat-current", "—");
  setText("#stat-high", "—");
  setText("#stat-low", "—");
  setText("#stat-change", "—");
}

function updateConversion() {
  const source = currentCalculatorSource();
  if (!source) {
    elements.convertedAmount.textContent = "—";
    elements.calculatorRate.textContent = `1 ${state.base} = — ${state.quote}`;
    elements.calculatorRateSource.textContent = "所选来源暂不可用";
    return;
  }
  const amount = Math.max(0, Number(elements.amount.value) || 0);
  elements.convertedAmount.textContent = formatAmount(amount * source.rate, state.quote);
  elements.calculatorRate.textContent = `1 ${state.base} = ${formatRate(source.rate, state.quote)} ${state.quote}`;
  elements.calculatorRateSource.textContent = source.label;
  elements.calculatorSourceNote.textContent = source.note;
}

function currentCalculatorSource() {
  const id = state.calculatorSource;
  if (id === "market") {
    const rate = state.snapshot?.rates?.[state.quote];
    return Number.isFinite(rate)
      ? { id, label: "公共市场参考价", rate, note: "默认参考口径；不代表银行或 Wise 最终成交价。" }
      : null;
  }
  if (id === "wise" || id === "hsbc_public") {
    const source = state.comparison?.sources?.find((item) => item.id === id);
    if (!Number.isFinite(source?.rate)) return null;
    return {
      id,
      label: source.label,
      rate: source.rate,
      note: id === "wise"
        ? "Wise 公开中间价，未扣除按金额与币种计算的转换费用。"
        : "汇丰香港公开 TT 指示性牌价，已包含买卖价差。",
    };
  }
  const bankId = id.match(/^bank_(.+)$/)?.[1];
  const bank = state.bankComparison?.banks?.find((item) => item.id === bankId);
  if (!Number.isFinite(bank?.rate)) return null;
  return {
    id,
    label: `${bank.name}公开 TT`,
    rate: bank.rate,
    note: `${bank.basis || "公开 TT 买卖价"}；指示性数据，实际成交以银行确认为准。`,
  };
}

function refreshCalculatorSources() {
  Array.from(elements.calculatorSource.options).forEach((option) => {
    option.dataset.label ||= option.textContent.replace(/（当前不可用）$/, "");
    const previousSource = state.calculatorSource;
    state.calculatorSource = option.value;
    const available = Boolean(currentCalculatorSource());
    state.calculatorSource = previousSource;
    option.disabled = !available;
    option.textContent = available ? option.dataset.label : `${option.dataset.label}（当前不可用）`;
  });
  const selected = currentCalculatorSource();
  if (!selected) {
    state.calculatorSource = "market";
    elements.calculatorSource.value = "market";
  } else {
    elements.calculatorSource.value = state.calculatorSource;
  }
}

function updateChartSelectionNote() {
  const bankCount = [...state.chartSources].filter((id) => id.startsWith("bank_")).length;
  setText("#chart-bank-count", String(bankCount));
  elements.chartSelectionNote.textContent = `已选择 ${state.chartSources.size} 个数据源。折线图可同时比较；柱状图以半透明颜色叠层展示，汇率数值不会相加。`;
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
  setText("#banks-base", state.base);
  setText("#banks-quote", state.quote);
  setText("#banks-sell", state.base);
  setText("#banks-buy", state.quote);
  setText("#bank-direction", `卖出 ${state.base} → 买入 ${state.quote}`);
  setText("#bank-rate-column", `1 ${state.base} 可得 ${state.quote}`);
  setText("#stat-pair", `${state.quote} / ${state.base}`);
  elements.swapPair.setAttribute("aria-label", `反转 ${state.base}/${state.quote} 为 ${state.quote}/${state.base}`);
  elements.overviewSwap.setAttribute("aria-label", `反转 ${state.base}/${state.quote} 为 ${state.quote}/${state.base}`);
  setText("#swap-label", `${state.base} / ${state.quote}`);
  setText("#overview-swap-label", `${state.quote}/${state.base}`);
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
