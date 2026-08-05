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
const OVERVIEW_GLOBAL_STORAGE_KEY = "fxpulse.overview.global-sources.v1";
const OVERVIEW_CARD_STORAGE_KEY = "fxpulse.overview.card-sources.v1";
const HISTORY_API_VERSION = "free-tier-cache-v1";
const FIXED_CHART_SOURCE_IDS = ["market", "wise"];
const MAX_CHART_EXTRA_SOURCES = 5;
const CHART_SOURCE_COLORS = [
  "#2fe3a0",
  "#339cff",
  "#ff4d57",
  "#ffc247",
  "#9d6cff",
  "#ff6bcb",
  "#ff7a2f",
];
const SOURCE_CATALOG = Array.isArray(initial.sourceCatalog) ? initial.sourceCatalog : [];
const state = {
  base: initial.base,
  quote: initial.quote,
  days: 30,
  snapshot: initial.snapshot,
  comparison: null,
  bankComparison: null,
  overview: null,
  overviewError: null,
  overviewGlobalSources: readGlobalOverviewSources(),
  overviewCardSources: readCardOverviewSources(),
  calculatorSource: "market",
  chartType: "line",
  chartSources: new Set(FIXED_CHART_SOURCE_IDS),
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
  overviewLegend: document.querySelector("#overview-legend"),
  overviewGlobalConfig: document.querySelector("#overview-global-config"),
  overviewGlobalOptions: document.querySelector("#overview-global-options"),
  overviewGlobalCount: document.querySelector("#overview-global-count"),
  overviewGlobalNote: document.querySelector("#overview-global-note"),
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
  syncOverviewGlobalConfig();
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
    const reset = event.target.closest("[data-card-config-reset]");
    if (reset) {
      const card = reset.closest("[data-currency]");
      if (!card) return;
      delete state.overviewCardSources[cardConfigKey(card.dataset.currency)];
      persistCardOverviewSources();
      renderRates();
      loadOverview();
      return;
    }
    const select = event.target.closest("[data-select-currency]");
    if (!select) return;
    const card = select.closest("[data-currency]");
    if (!card) return;
    state.quote = card.dataset.currency;
    resetPairData();
    updatePairChrome();
    renderRates();
    updateUrl();
    Promise.all([loadHistory(), loadComparison(), loadBanks()]);
    document.querySelector("#trend").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  elements.overviewGlobalConfig.addEventListener("change", (event) => {
    const input = event.target.closest("[data-overview-global-source]");
    if (!input) return;
    const selected = selectedCheckboxValues(elements.overviewGlobalOptions, "[data-overview-global-source]");
    if (selected.length > 5) {
      input.checked = false;
      elements.overviewGlobalNote.textContent = "最多只能增加 5 个全局数据源。";
      return;
    }
    state.overviewGlobalSources = normalizeOverviewSourceIds(selected);
    persistGlobalOverviewSources();
    syncOverviewGlobalConfig();
    renderRates();
    loadOverview();
  });

  elements.grid.addEventListener("change", (event) => {
    const card = event.target.closest("[data-currency]");
    if (!card) return;
    const quote = card.dataset.currency;
    const key = cardConfigKey(quote);
    const follow = event.target.closest("[data-card-follow-global]");
    if (follow) {
      if (follow.checked) delete state.overviewCardSources[key];
      else state.overviewCardSources[key] = [...state.overviewGlobalSources];
    } else {
      const sourceInput = event.target.closest("[data-overview-card-source]");
      if (!sourceInput) return;
      const selected = selectedCheckboxValues(card, "[data-overview-card-source]");
      if (selected.length > 5) {
        sourceInput.checked = false;
        card.querySelector("[data-card-config-note]").textContent = "每张卡最多增加 5 个数据源。";
        return;
      }
      state.overviewCardSources[key] = normalizeOverviewSourceIds(selected);
    }
    persistCardOverviewSources();
    renderRates();
    loadOverview();
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

  bindChartTypeSwitcher();

  elements.chartSourcePicker.addEventListener("change", (event) => {
    const input = event.target.closest("[data-history-source]");
    if (!input) return;

    if (FIXED_CHART_SOURCE_IDS.includes(input.value)) {
      input.checked = true;
      state.chartSources = new Set(normalizeChartSourceIds(state.chartSources));
      updateChartSelectionNote();
      return;
    }

    const nextSources = new Set(state.chartSources);
    if (input.checked) nextSources.add(input.value);
    else nextSources.delete(input.value);
    const normalized = normalizeChartSourceIds(nextSources);
    if (input.checked && !normalized.includes(input.value)) {
      input.checked = false;
      elements.chartSelectionNote.textContent = "公共市场与 Wise 固定保留；其余最多只能选择 5 个数据源。";
      return;
    }

    state.chartSources = new Set(normalized);
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

function bindChartTypeSwitcher() {
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

  try {
    const query = new URLSearchParams({ base: state.base, quote: state.quote });
    const response = await fetch(`/api/compare?${query}`, {
      headers: { accept: "application/json" },
      signal: state.comparisonController.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "核心汇率暂时不可用");
    state.comparison = payload;
    renderComparison(payload);
  } catch (error) {
    if (error.name === "AbortError") return;
    state.comparison = null;
    renderUnifiedSources();
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
    elements.bankError.textContent = `${error.message}。公共市场与 Wise 仍会保留在统一来源表中。`;
    elements.bankError.hidden = false;
    elements.bankBest.textContent = "暂不可用";
    renderUnifiedSources();
    elements.bankTableBody.insertAdjacentHTML("beforeend", `<tr class="bank-row bank-row-error"><td colspan="7"><strong>银行牌价加载失败</strong><button type="button" id="retry-banks">重试</button></td></tr>`);
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
    const query = new URLSearchParams({
      base: state.base,
      sources: requestedOverviewSources().join(","),
    });
    const response = await fetch(`/api/overview?${query}`, {
      headers: { accept: "application/json" },
      signal: state.overviewController.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "多来源总览暂时不可用");
    state.overview = payload;
    renderRates();
  } catch (error) {
    if (error.name === "AbortError") return;
    state.overviewError = error.message;
    renderRates();
    elements.overviewError.textContent = `附加来源总览暂时无法加载：${error.message}。公共市场参考价仍可使用。`;
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
      v: HISTORY_API_VERSION,
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
  const openCardConfigs = new Set(
    [...elements.grid.querySelectorAll("[data-card-source-config][open]")]
      .map((details) => details.closest("[data-currency]")?.dataset.currency)
      .filter(Boolean),
  );
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
      const configuredSources = ["market", "wise", ...configuredOverviewExtras(code)];
      return `<article class="rate-card ${code === state.quote ? "active" : ""}" data-currency="${code}">
        <button type="button" class="rate-card-select" data-select-currency aria-label="比较 ${state.base} 兑 ${code} 多来源汇率并查看走势">
        <span class="rate-card-header">
          <span class="flag" aria-hidden="true">${meta.flag}</span>
          <span class="currency-id"><strong>${code}</strong><small>${meta.name}</small></span>
          <span class="pair-direction">${code === state.quote ? "当前目标 · " : ""}1 ${state.base} → ${code}</span>
          <span class="card-arrow" aria-hidden="true">↗</span>
        </span>
        <span class="provider-rate-list">
          ${configuredSources.map((id) => {
            const label = overviewSourceLabel(id);
            const source = id === "market"
              ? sources.get(id) ?? marketFallback
              : sources.get(id) ?? null;
            return renderOverviewSource(id, label, source, code);
          }).join("")}
        </span>
        <span class="card-footer">选择 ${code} 查看详细对比与走势 <b>查看</b></span>
        </button>
        ${renderCardSourceConfig(code)}
      </article>`;
    })
    .join("");
  elements.grid.querySelectorAll("[data-currency]").forEach((card) => {
    if (openCardConfigs.has(card.dataset.currency)) {
      card.querySelector("[data-card-source-config]").open = true;
    }
  });
  document.querySelector("#rates-title").textContent = `1 ${state.base} 兑换其他币种 · 可配置多源报价`;
  renderOverviewLegend();
  refreshCalculatorSources();
  updateConversion();
}

function orderedQuoteCodes() {
  return [state.quote, ...CODES.filter((code) => code !== state.base && code !== state.quote)];
}

function overviewSourceLabel(id) {
  if (id === "market") return "公共市场";
  if (id === "wise") return "Wise";
  return SOURCE_CATALOG.find((source) => source.id === id)?.label ?? id;
}

function normalizeOverviewSourceIds(values) {
  const supported = new Set(SOURCE_CATALOG.map((source) => source.id));
  return [...new Set(Array.isArray(values) ? values : [])]
    .filter((id) => supported.has(id))
    .slice(0, 5);
}

function normalizeChartSourceIds(values) {
  const unique = [...new Set(values ?? [])];
  const extras = unique
    .filter((id) => !FIXED_CHART_SOURCE_IDS.includes(id))
    .slice(0, MAX_CHART_EXTRA_SOURCES);
  return [...FIXED_CHART_SOURCE_IDS, ...extras];
}

function readGlobalOverviewSources() {
  try {
    return normalizeOverviewSourceIds(JSON.parse(localStorage.getItem(OVERVIEW_GLOBAL_STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function readCardOverviewSources() {
  try {
    const parsed = JSON.parse(localStorage.getItem(OVERVIEW_CARD_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, normalizeOverviewSourceIds(value)]),
    );
  } catch {
    return {};
  }
}

function persistGlobalOverviewSources() {
  try {
    localStorage.setItem(OVERVIEW_GLOBAL_STORAGE_KEY, JSON.stringify(state.overviewGlobalSources));
  } catch {
    // Private browsing or a restrictive storage policy should not block rate viewing.
  }
}

function persistCardOverviewSources() {
  try {
    localStorage.setItem(OVERVIEW_CARD_STORAGE_KEY, JSON.stringify(state.overviewCardSources));
  } catch {
    // Keep the current in-memory configuration when storage is unavailable.
  }
}

function cardConfigKey(quote) {
  return `${state.base}/${quote}`;
}

function configuredOverviewExtras(quote) {
  const key = cardConfigKey(quote);
  return Object.prototype.hasOwnProperty.call(state.overviewCardSources, key)
    ? state.overviewCardSources[key]
    : state.overviewGlobalSources;
}

function requestedOverviewSources() {
  return [...new Set(orderedQuoteCodes().flatMap((quote) => configuredOverviewExtras(quote)))];
}

function selectedCheckboxValues(container, selector) {
  return [...container.querySelectorAll(`${selector}:checked`)].map((input) => input.value);
}

function syncOverviewGlobalConfig() {
  const selected = new Set(state.overviewGlobalSources);
  elements.overviewGlobalOptions.querySelectorAll("[data-overview-global-source]").forEach((input) => {
    input.checked = selected.has(input.value);
    const colorDot = input.nextElementSibling?.querySelector("i");
    if (colorDot) colorDot.style.background = sourceColor(input.value);
  });
  elements.overviewGlobalCount.textContent = `${selected.size} / 5`;
  elements.overviewGlobalNote.textContent = selected.size
    ? `当前附加：${state.overviewGlobalSources.map(overviewSourceLabel).join("、")}`
    : "当前使用默认配置：公共市场 + Wise。";
  renderOverviewLegend();
}

function renderOverviewLegend() {
  const sources = ["market", "wise", ...state.overviewGlobalSources];
  elements.overviewLegend.innerHTML = sources
    .map((id) => `<span><i style="background:${sourceColor(id)}"></i>${escapeHtml(overviewSourceLabel(id))}</span>`)
    .join("");
}

function renderCardSourceConfig(quote) {
  const key = cardConfigKey(quote);
  const custom = Object.prototype.hasOwnProperty.call(state.overviewCardSources, key);
  const selected = new Set(custom ? state.overviewCardSources[key] : state.overviewGlobalSources);
  const options = SOURCE_CATALOG.map((source) => `<label class="overview-source-option">
    <input type="checkbox" value="${escapeHtml(source.id)}" data-overview-card-source ${selected.has(source.id) ? "checked" : ""} ${custom ? "" : "disabled"}>
    <span><i style="background:${sourceColor(source.id)}"></i>${escapeHtml(source.label)}</span>
  </label>`).join("");
  return `<details class="card-source-config" data-card-source-config>
    <summary>卡片数据源 <b data-card-source-mode>${custom ? `自定义 ${selected.size} / 5` : "跟随全局"}</b></summary>
    <div class="card-config-panel">
      <label class="card-follow-option"><input type="checkbox" data-card-follow-global ${custom ? "" : "checked"}><span>跟随全局配置</span></label>
      <p>取消跟随后，可为 ${quote} 单独选择最多 5 个附加来源。</p>
      <div class="overview-config-options card-config-options">${options}</div>
      <div class="card-config-footer"><small data-card-config-note>${custom ? "该卡片使用独立配置。" : "当前跟随全局配置。"}</small><button type="button" data-card-config-reset>恢复全局</button></div>
    </div>
  </details>`;
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

  return `<span class="provider-rate provider-${escapeHtml(id)} ${escapeHtml(status)}" style="--source-color:${sourceColor(id)}">
    <span class="provider-label"><i></i>${escapeHtml(label)}</span>
    <strong data-overview-rate="${escapeHtml(id)}">${available ? formatRate(source.rate, quote) : "—"}<em>${quote}</em></strong>
    <small data-overview-diff="${escapeHtml(id)}">${escapeHtml(detail)}</small>
  </span>`;
}

function renderComparison(payload) {
  renderUnifiedSources();
  refreshCalculatorSources();
  updateConversion();
}

function renderBanks(payload) {
  renderUnifiedSources();
  const best = payload?.bestBank;
  elements.bankBest.textContent = best
    ? `${best.name} · ${formatRate(best.rate, state.quote)} ${state.quote}`
    : "暂无可用报价";
  elements.bankAvailable.textContent = `${payload.availableBankCount} / ${payload.totalBankCount}`;
  const warning = payload.warnings?.length ? ` 当前提示：${payload.warnings.join("；")}。` : "";
  elements.bankNote.textContent = `${payload.interpretation} ${payload.source.note}${warning}`;
  refreshCalculatorSources();
  updateConversion();
}

function renderUnifiedSources() {
  const comparisonSources = new Map(
    (state.comparison?.sources ?? []).map((source) => [source.id, source]),
  );
  const marketRate = state.snapshot?.rates?.[state.quote];
  const coreSources = [
    comparisonSources.get("market") ?? {
      id: "market",
      label: "公共市场参考价",
      rate: Number.isFinite(marketRate) ? marketRate : null,
      differenceFromMarketPct: 0,
      sourceUpdatedAt: state.snapshot?.sourceUpdatedAt
        ? new Date(state.snapshot.sourceUpdatedAt * 1000).toISOString()
        : null,
      provider: state.snapshot?.provider ?? "ExchangeRate-API",
      providerUrl: state.snapshot?.providerUrl ?? "https://www.exchangerate-api.com/",
    },
    comparisonSources.get("wise") ?? {
      id: "wise",
      label: "Wise 公开中间价",
      rate: null,
      differenceFromMarketPct: null,
      sourceUpdatedAt: null,
      provider: "Wise",
      providerUrl: "https://wise.com/gb/currency-converter/",
    },
  ];
  const banks = state.bankComparison?.banks ?? [];
  const hsbcFallback = banks.length === 0
    ? [...comparisonSources.values()].filter((source) => source.id === "hsbc_public")
    : [];
  const rows = [
    ...coreSources.map(renderReferenceSourceRow),
    ...hsbcFallback.map(renderReferenceSourceRow),
    ...banks.map(renderBankSourceRow),
  ].join("");
  elements.bankTableBody.innerHTML = rows || `<tr class="bank-row bank-row-loading"><td colspan="7">正在加载公共市场、Wise 与香港银行公开牌价</td></tr>`;
}

function renderReferenceSourceRow(source) {
  const available = Number.isFinite(source?.rate);
  const difference = source.id === "market"
    ? "基准"
    : Number.isFinite(source.differenceFromMarketPct)
      ? `${source.differenceFromMarketPct >= 0 ? "+" : ""}${source.differenceFromMarketPct.toFixed(3)}%`
      : "暂不可用";
  const type = source.id === "market" ? "市场参考" : source.id === "wise" ? "公开中间价" : "银行 TT";
  const badge = source.id === "market" ? "公开市场" : source.id === "wise" ? "公开直连" : "官方直连";
  const basis = source.basis || (source.id === "market"
    ? "统一比较基准，不代表客户成交价"
    : source.id === "wise"
      ? "Wise 中间价，未扣转换费用"
      : "汇丰官方 TT 买卖牌价");
  const observed = source.sourceUpdatedAt ? formatSourceTime(source.sourceUpdatedAt) : "—";
  return `<tr class="bank-row reference-row ${available ? "available" : "unavailable"}">
    <td class="bank-rank">${source.id === "market" ? "基准" : "—"}</td>
    <td class="bank-name"><a href="${escapeHtml(source.providerUrl)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(source.label)}</strong><small>${escapeHtml(source.provider)}</small></a><em>${badge}</em></td>
    <td class="bank-type">${type}</td>
    <td class="bank-rate">${available ? `<strong>${formatRate(source.rate, state.quote)}</strong><small>${state.quote}</small>` : "—"}</td>
    <td class="bank-diff ${available && source.differenceFromMarketPct >= 0 ? "positive" : "negative"}">${escapeHtml(difference)}</td>
    <td class="bank-basis">${escapeHtml(basis)}</td>
    <td class="bank-updated">${escapeHtml(observed)}</td>
  </tr>`;
}

function renderBankSourceRow(bank) {
  const available = Number.isFinite(bank.rate);
  const difference = Number.isFinite(bank.differenceFromMarketPct)
    ? `${bank.differenceFromMarketPct >= 0 ? "+" : ""}${bank.differenceFromMarketPct.toFixed(3)}%`
    : "暂不可用";
  const observed = bank.observedAt ? formatSourceTime(bank.observedAt) : "—";
  const sourceLabel = bank.source === "HSBC Hong Kong" ? "官方直连" : "公开聚合";
  return `<tr class="bank-row ${available ? "available" : "unavailable"} ${bank.rank === 1 ? "best" : ""}">
    <td class="bank-rank">${available ? `#${bank.rank}` : "—"}</td>
    <td class="bank-name"><a href="${escapeHtml(bank.sourceUrl)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(bank.name)}</strong><small>${escapeHtml(bank.englishName)}</small></a><em>${escapeHtml(sourceLabel)}</em></td>
    <td class="bank-type">银行 TT</td>
    <td class="bank-rate">${available ? `<strong>${formatRate(bank.rate, state.quote)}</strong><small>${state.quote}</small>` : "—"}</td>
    <td class="bank-diff ${available && bank.differenceFromMarketPct >= 0 ? "positive" : "negative"}">${escapeHtml(difference)}</td>
    <td class="bank-basis">${escapeHtml(bank.basis || bank.reason || "该币种暂未公布")}</td>
    <td class="bank-updated">${escapeHtml(observed)}</td>
  </tr>`;
}

function renderChart(seriesList, chartType) {
  const plottedSeries = chartType === "bar"
    ? normalizeBarSeriesByDay(seriesList, 100)
    : seriesList.map((series) => ({
        ...series,
        points: downsamplePoints(series.points, 260),
      }));
  const allPoints = plottedSeries.flatMap((series) => series.points);
  const minimumPoints = chartType === "bar" ? 1 : 2;
  if (allPoints.length < minimumPoints) throw new Error("历史数据点不足");
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
  const barDays = chartType === "bar"
    ? [...new Set(allPoints.map((point) => Number(point.timestamp)))].sort((a, b) => a - b)
    : [];
  const barDayIndexes = new Map(barDays.map((timestamp, index) => [timestamp, index]));
  const plotWidth = width - padding.left - padding.right;
  const x = chartType === "bar"
    ? (timestamp) => padding.left + ((barDayIndexes.get(timestamp) ?? 0) + 0.5) / Math.max(1, barDays.length) * plotWidth
    : (timestamp) => padding.left + ((timestamp - minTimestamp) / timeSpread) * plotWidth;
  const y = (value) => padding.top + ((max - value) / (max - min)) * (height - padding.top - padding.bottom);

  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const value = min + ((max - min) * index) / 4;
    const posY = y(value);
    return `<g><line x1="${padding.left}" x2="${width - padding.right}" y1="${posY}" y2="${posY}"/><text x="${padding.left - 14}" y="${posY + 4}">${formatRate(value, state.quote)}</text></g>`;
  }).join("");
  const labelTimestamps = chartType === "bar"
    ? sampleEvenly(barDays, Math.min(4, barDays.length))
    : [0, 1, 2, 3].map((index) => minTimestamp + (timeSpread * index) / 3);
  const labels = labelTimestamps
    .map((timestamp) => `<text x="${x(timestamp)}" y="${height - 12}" text-anchor="middle">${formatDate(new Date(timestamp * 1000).toISOString())}</text>`)
    .join("");
  const plot = chartType === "bar"
    ? renderBarSeries(plottedSeries, barDays, x, y, height, padding, width)
    : renderLineSeries(plottedSeries, x, y);
  const titleSources = plottedSeries.map((series) => series.label).join("、");

  elements.chart.innerHTML = `<figure class="rate-chart chart-${chartType}">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-desc" preserveAspectRatio="none">
      <title id="chart-title">${state.base} 兑 ${state.quote} 过去 ${state.days} 天${chartType === "bar" ? "柱状" : "折线"}走势：${escapeHtml(titleSources)}</title>
      <desc id="chart-desc">多来源区间最低 ${formatRate(rawMin, state.quote)}，最高 ${formatRate(rawMax, state.quote)}。柱状图按香港日期对齐，每天仅使用一个柱位，以颜色叠层区分来源，数值不相加。</desc>
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
    const pointerX = relative * width;
    const targetTimestamp = chartType === "bar"
      ? nearestValue(barDays, pointerX, x)
      : minTimestamp + relative * timeSpread;
    const nearest = plottedSeries
      .map((series, index) => ({
        series,
        item: chartType === "bar"
          ? series.points.find((point) => point.timestamp === targetTimestamp)
          : nearestPoint(series.points, targetTimestamp),
        color: sourceColor(series.id, index),
      }))
      .filter(({ item }) => item);
    const anchor = nearest[0]?.item;
    if (!anchor) return;
    const itemX = x(chartType === "bar" ? targetTimestamp : anchor.timestamp);
    cursor.hidden = false;
    cursor.setAttribute("x1", itemX);
    cursor.setAttribute("x2", itemX);
    tooltip.hidden = false;
    tooltip.innerHTML = `<span>${escapeHtml(chartType === "bar" ? formatDate(anchor.date) : formatDateTime(anchor.date))}</span>${nearest
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

function renderBarSeries(seriesList, barDays, x, y, height, padding, width) {
  const baseWidth = Math.max(1.5, Math.min(22, ((width - padding.left - padding.right) / Math.max(1, barDays.length)) * 0.72));
  const bottom = height - padding.bottom;
  const pointsBySourceAndDay = seriesList.map((series) => new Map(
    series.points.map((point) => [point.timestamp, point]),
  ));
  return barDays.map((timestamp) => {
    const layers = seriesList.map((series, index) => {
      const point = pointsBySourceAndDay[index].get(timestamp);
      if (!point) return "";
      const color = sourceColor(series.id, index);
      const layerProgress = index / Math.max(1, seriesList.length - 1);
      const barWidth = Math.max(1.2, baseWidth * (1 - layerProgress * 0.48));
      const top = y(point.rate);
      return `<rect class="chart-bar" data-source="${escapeHtml(series.id)}" x="${(x(timestamp) - barWidth / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(1, bottom - top).toFixed(2)}" rx="${Math.min(2, barWidth / 3).toFixed(2)}" style="fill:${color}"><title>${escapeHtml(series.label)} · ${formatRate(point.rate, state.quote)} ${state.quote}</title></rect>`;
    }).join("");
    return `<g class="chart-bar-day" data-day="${timestamp}">${layers}</g>`;
  }).join("");
}

function normalizeBarSeriesByDay(seriesList, limit) {
  const daySeconds = 86_400;
  const hongKongOffsetSeconds = 8 * 3_600;
  const normalized = seriesList.map((series) => {
    const latestByDay = new Map();
    for (const point of series.points) {
      const observedTimestamp = Number(point.timestamp);
      if (!Number.isFinite(observedTimestamp)) continue;
      const dayStart = Math.floor((observedTimestamp + hongKongOffsetSeconds) / daySeconds) * daySeconds - hongKongOffsetSeconds;
      const dayTimestamp = dayStart + daySeconds / 2;
      const previous = latestByDay.get(dayTimestamp);
      if (!previous || observedTimestamp > previous.observedTimestamp) {
        latestByDay.set(dayTimestamp, {
          observedTimestamp,
          point: {
            ...point,
            timestamp: dayTimestamp,
            date: new Date(dayTimestamp * 1000).toISOString(),
          },
        });
      }
    }
    return {
      ...series,
      points: [...latestByDay.values()]
        .sort((a, b) => a.point.timestamp - b.point.timestamp)
        .map(({ point }) => point),
    };
  });
  const allDays = [...new Set(normalized.flatMap((series) => series.points.map((point) => point.timestamp)))]
    .sort((a, b) => a - b);
  const visibleDays = new Set(sampleEvenly(allDays, limit));
  return normalized.map((series) => ({
    ...series,
    points: series.points.filter((point) => visibleDays.has(point.timestamp)),
  }));
}

function sampleEvenly(values, limit) {
  if (values.length <= limit || limit <= 0) return values;
  if (limit === 1) return [values.at(-1)];
  const sampled = [];
  const step = (values.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) sampled.push(values[Math.round(index * step)]);
  return [...new Set(sampled)];
}

function nearestValue(values, target, project = (value) => value) {
  return values.reduce((nearest, value) =>
    Math.abs(project(value) - target) < Math.abs(project(nearest) - target) ? value : nearest,
  values[0]);
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
  const core = { market: CHART_SOURCE_COLORS[0], wise: CHART_SOURCE_COLORS[1] };
  if (core[id]) return core[id];
  if (Number.isInteger(index) && index > 0) {
    return CHART_SOURCE_COLORS[index % CHART_SOURCE_COLORS.length];
  }
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash} 78% 58%)`;
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
  const extras = [...state.chartSources].filter((id) => !FIXED_CHART_SOURCE_IDS.includes(id));
  setText("#chart-bank-count", `${extras.length} / ${MAX_CHART_EXTRA_SOURCES}`);
  elements.chartSelectionNote.textContent = `公共市场与 Wise 固定保留；已增加 ${extras.length} / ${MAX_CHART_EXTRA_SOURCES} 个数据源。折线图可同时比较；柱状图按香港日期共用一个柱位，以高对比颜色叠层区分，汇率数值不会相加。`;
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
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Hong_Kong" }).format(new Date(value));
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
