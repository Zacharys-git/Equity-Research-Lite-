// ====== CONFIG ======
// Change API_BASE to your deployed Flask URL once you deploy the backend.
// e.g. "https://stock-research-lite-api.onrender.com"
const API_BASE = (() => {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return "http://localhost:5001";
  }
  return "https://equity-research-lite.onrender.com";
})();

// ====== STATE ======
let currentTicker = "AAPL";
let snapChart = null;

// ====== HELPERS ======
const $ = (sel) => document.querySelector(sel);

function fmtNum(v, opts = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const { pct = false, money = false, compact = false, decimals = 2 } = opts;
  if (pct) return (v * (Math.abs(v) < 1 ? 100 : 1)).toFixed(decimals) + "%";
  if (typeof v === "string") return v;
  if (typeof v !== "number") return String(v);
  if (compact || (money && Math.abs(v) >= 1e6)) {
    const abs = Math.abs(v);
    if (abs >= 1e12) return (v / 1e12).toFixed(2) + "T";
    if (abs >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return (v / 1e3).toFixed(2) + "K";
  }
  return v.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function setStatus(msg) { $("#status").textContent = msg || ""; }

async function api(path) {
  let r;
  try {
    r = await fetch(API_BASE + path);
  } catch (e) {
    throw new Error(`Cannot reach backend at ${API_BASE}. Is it running?`);
  }
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {
    throw new Error(`Backend returned non-JSON (HTTP ${r.status}). Check backend logs.`);
  }
  if (!r.ok && (!json || !json.error)) {
    throw new Error(`HTTP ${r.status}`);
  }
  return json || {};
}

// ====== TABS ======
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    const id = "tab-" + btn.dataset.tab;
    document.getElementById(id).classList.add("active");
    if (btn.dataset.tab === "macro") loadMacro();
    if (btn.dataset.tab === "sectors") loadSectors();
  });
});

// ====== SEARCH ======
$("#go").addEventListener("click", () => {
  const t = $("#ticker").value.trim().toUpperCase();
  if (t) loadTicker(t);
});
$("#ticker").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#go").click();
});
document.querySelectorAll('input[name="period"]').forEach(r => {
  r.addEventListener("change", () => loadFinancials(currentTicker));
});

async function loadTicker(t) {
  currentTicker = t;
  setStatus(`Loading ${t}…`);
  try {
    await Promise.all([loadSnapshot(t), loadFinancials(t), loadFilings(t)]);
    setStatus(`Loaded ${t}`);
  } catch (e) {
    setStatus("Error: " + e.message);
  }
}

// ====== SNAPSHOT ======
async function loadSnapshot(t) {
  const data = await api(`/api/snapshot/${t}`);
  const s = data.stats || {};
  $("#snap-name").textContent = (s.longName || s.shortName || t) + " · " + t;
  $("#snap-meta").textContent = [s.exchange, s.sector, s.industry].filter(Boolean).join(" · ") || "—";
  const price = s.currentPrice ?? s.previousClose;
  const prev = s.previousClose;
  $("#snap-price").textContent = price != null ? "$" + fmtNum(price) : "—";

  const chgEl = $("#snap-change");
  if (price != null && prev != null) {
    const diff = price - prev;
    const pct = (diff / prev) * 100;
    chgEl.textContent = `${diff >= 0 ? "+" : ""}${fmtNum(diff)} (${pct.toFixed(2)}%)`;
    chgEl.className = "change " + (diff >= 0 ? "up" : "down");
  } else {
    chgEl.textContent = "—";
    chgEl.className = "change";
  }

  $("#snap-about").textContent = s.longBusinessSummary || "—";

  // Stats grid
  const stats = [
    ["Market Cap", fmtNum(s.marketCap, { compact: true })],
    ["Shares Out", fmtNum(s.sharesOutstanding, { compact: true })],
    ["52W High", fmtNum(s.fiftyTwoWeekHigh)],
    ["52W Low", fmtNum(s.fiftyTwoWeekLow)],
    ["50D Avg", fmtNum(s.fiftyDayAverage)],
    ["200D Avg", fmtNum(s.twoHundredDayAverage)],
    ["Volume", fmtNum(s.regularMarketVolume, { compact: true })],
    ["Avg Volume", fmtNum(s.averageVolume, { compact: true })],
    ["Trailing P/E", fmtNum(s.trailingPE)],
    ["Forward P/E", fmtNum(s.forwardPE)],
    ["P/B", fmtNum(s.priceToBook)],
    ["P/S", fmtNum(s.priceToSalesTrailing12Months)],
    ["EPS (TTM)", fmtNum(s.trailingEps)],
    ["Dividend Yield", s.dividendYield != null ? (s.dividendYield * 100).toFixed(2) + "%" : "—"],
    ["Beta", fmtNum(s.beta)],
    ["ROE", s.returnOnEquity != null ? (s.returnOnEquity * 100).toFixed(2) + "%" : "—"],
  ];
  $("#snap-stats").innerHTML = stats.map(([l, v]) =>
    `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`
  ).join("");

  // Chart
  snapHistory = data.history || [];
  snapTicker = t;
  renderSnapChart();
}

// Snapshot chart state
let snapHistory = [];
let snapTicker = "";
const SMA_COLORS = { 20: "#3fb950", 50: "#d29922", 200: "#f85149" };

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v != null) { sum += v; count++; }
    if (i >= period) {
      const drop = values[i - period];
      if (drop != null) { sum -= drop; count--; }
    }
    if (i >= period - 1 && count === period) out[i] = sum / period;
  }
  return out;
}

function renderSnapChart() {
  if (!snapHistory.length) return;
  const closesFull = snapHistory.map(p => p.close);

  // Compute SMAs over the FULL history (so 200-day still has values when range is short)
  const smaFull = { 20: sma(closesFull, 20), 50: sma(closesFull, 50), 200: sma(closesFull, 200) };

  // Slice by selected range
  const range = document.querySelector('input[name="snap-range"]:checked')?.value || "2Y";
  const tradingDaysByRange = { "3M": 63, "6M": 126, "1Y": 252, "2Y": 504 };
  const slice = Math.min(tradingDaysByRange[range] || 504, snapHistory.length);
  const startIdx = snapHistory.length - slice;

  const labels = snapHistory.slice(startIdx).map(p => p.date);
  const closes = closesFull.slice(startIdx);

  const datasets = [{
    label: snapTicker + " Close",
    data: closes,
    borderColor: "#4ea1ff",
    backgroundColor: "rgba(78,161,255,0.08)",
    fill: true,
    pointRadius: 0,
    borderWidth: 1.8,
    tension: 0.1,
  }];

  document.querySelectorAll(".sma-toggle").forEach(t => {
    if (!t.checked) return;
    const p = parseInt(t.dataset.period, 10);
    datasets.push({
      label: `SMA ${p}`,
      data: smaFull[p].slice(startIdx),
      borderColor: SMA_COLORS[p] || "#888",
      borderWidth: 1.6,
      pointRadius: 0,
      fill: false,
      tension: 0.15,
      spanGaps: true,
    });
  });

  if (snapChart) snapChart.destroy();
  const ctx = document.getElementById("snap-chart").getContext("2d");
  snapChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false }, // controls panel above already shows the legend
        tooltip: {
          callbacks: {
            label: (c) => `${c.dataset.label}: $${(c.parsed.y ?? 0).toFixed(2)}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: "#8b949e", maxTicksLimit: 8 }, grid: { color: "#2a313a" } },
        y: { ticks: { color: "#8b949e" }, grid: { color: "#2a313a" } },
      },
    },
  });
}

document.querySelectorAll(".sma-toggle").forEach(t => t.addEventListener("change", renderSnapChart));
document.querySelectorAll('input[name="snap-range"]').forEach(r => r.addEventListener("change", renderSnapChart));

// ====== FINANCIALS ======
async function loadFinancials(t) {
  const period = document.querySelector('input[name="period"]:checked').value;
  const data = await api(`/api/financials/${t}?period=${period}`);
  renderRatios(data.ratios || {});
  renderTable("#tbl-income", data.incomeStatement);
  renderTable("#tbl-balance", data.balanceSheet);
  renderTable("#tbl-cashflow", data.cashFlow);
}

function renderRatios(r) {
  const items = [
    ["Trailing P/E", fmtNum(r.trailingPE)],
    ["Forward P/E", fmtNum(r.forwardPE)],
    ["PEG", fmtNum(r.pegRatio)],
    ["P/B", fmtNum(r.priceToBook)],
    ["P/S", fmtNum(r.priceToSales)],
    ["EV", fmtNum(r.enterpriseValue, { compact: true })],
    ["EV / Revenue", fmtNum(r.evToRevenue)],
    ["EV / EBITDA", fmtNum(r.evToEbitda)],
    ["Gross Margin", r.grossMargin != null ? (r.grossMargin * 100).toFixed(2) + "%" : "—"],
    ["Op Margin", r.operatingMargin != null ? (r.operatingMargin * 100).toFixed(2) + "%" : "—"],
    ["Net Margin", r.profitMargin != null ? (r.profitMargin * 100).toFixed(2) + "%" : "—"],
    ["ROA", r.returnOnAssets != null ? (r.returnOnAssets * 100).toFixed(2) + "%" : "—"],
    ["ROE", r.returnOnEquity != null ? (r.returnOnEquity * 100).toFixed(2) + "%" : "—"],
    ["Debt/Equity", fmtNum(r.debtToEquity)],
    ["Current Ratio", fmtNum(r.currentRatio)],
    ["Quick Ratio", fmtNum(r.quickRatio)],
    ["Div Yield", r.dividendYield != null ? (r.dividendYield * 100).toFixed(2) + "%" : "—"],
    ["Payout Ratio", r.payoutRatio != null ? (r.payoutRatio * 100).toFixed(2) + "%" : "—"],
    ["Beta", fmtNum(r.beta)],
    ["EPS", fmtNum(r.eps)],
    ["Book Value", fmtNum(r.bookValue)],
  ];
  $("#fin-ratios").innerHTML = items.map(([l, v]) =>
    `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`
  ).join("");
}

function renderTable(sel, records) {
  const el = document.querySelector(sel);
  if (!records || records.length === 0) {
    el.innerHTML = "<tbody><tr><td>No data</td></tr></tbody>";
    return;
  }
  // Collect all line item keys (excluding "period")
  const keys = new Set();
  records.forEach(r => Object.keys(r).forEach(k => { if (k !== "period") keys.add(k); }));
  const lineItems = Array.from(keys);

  const periods = records.map(r => r.period);
  let html = "<thead><tr><th>Line Item</th>";
  periods.forEach(p => html += `<th>${p}</th>`);
  html += "</tr></thead><tbody>";
  lineItems.forEach(item => {
    html += `<tr><td>${item}</td>`;
    records.forEach(r => {
      const v = r[item];
      html += `<td>${v == null ? "—" : fmtNum(v, { compact: true })}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody>";
  el.innerHTML = html;
}

async function loadFilings(t) {
  try {
    const data = await api(`/api/edgar/${t}`);
    const el = $("#tbl-filings");
    const filings = data.filings || [];
    if (filings.length === 0) { el.innerHTML = "<tbody><tr><td>No filings</td></tr></tbody>"; return; }
    let html = "<thead><tr><th>Form</th><th>Filed</th><th>Period</th><th>Link</th></tr></thead><tbody>";
    filings.forEach(f => {
      html += `<tr><td>${f.form}</td><td>${f.filingDate}</td><td>${f.reportDate || "—"}</td><td><a href="${f.url}" target="_blank">View</a></td></tr>`;
    });
    html += "</tbody>";
    el.innerHTML = html;
  } catch (e) {
    $("#tbl-filings").innerHTML = `<tbody><tr><td>EDGAR error: ${e.message}</td></tr></tbody>`;
  }
}

// ====== SECTORS ======
let sectorsLoaded = false;
let sectorsData = null;
let sectorBarChart = null;
let sectorLineChart = null;

async function loadSectors() {
  if (sectorsLoaded) return;
  setStatus("Loading sectors…");
  try {
    const data = await api(`/api/sectors`);
    sectorsData = data.sectors.filter(s => !s.error);
    renderSectorBar();
    renderSectorToggles();
    renderSectorLine();
    renderSectorTable();
    sectorsLoaded = true;
    setStatus("");
  } catch (e) {
    setStatus("Sectors error: " + e.message);
  }
}

function renderSectorBar() {
  const labels = sectorsData.map(s => s.sector);
  const returns = sectorsData.map(s => s.totalReturn);
  const colors = sectorsData.map(s => s.color);

  if (sectorBarChart) sectorBarChart.destroy();
  const ctx = document.getElementById("sector-bar").getContext("2d");
  sectorBarChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "5Y Total Return (%)",
        data: returns,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.parsed.x.toFixed(2)}%` } },
      },
      scales: {
        x: {
          ticks: { color: "#8b949e", callback: (v) => v + "%" },
          grid: { color: "#2a313a" },
        },
        y: { ticks: { color: "#e6edf3" }, grid: { display: false } },
      },
    },
  });
}

function renderSectorToggles() {
  const container = document.getElementById("sector-toggles");
  container.innerHTML = sectorsData.map(s => `
    <label>
      <span class="legend-swatch" style="background:${s.color}"></span>
      <input type="checkbox" class="sector-toggle" data-ticker="${s.ticker}" ${s.ticker === "SPY" || s.ticker === "XLK" || s.ticker === "XLE" ? "checked" : ""} />
      ${s.ticker}
    </label>
  `).join("");
  container.querySelectorAll(".sector-toggle").forEach(t => t.addEventListener("change", renderSectorLine));
}

function renderSectorLine() {
  const checked = new Set([...document.querySelectorAll(".sector-toggle:checked")].map(t => t.dataset.ticker));
  const datasets = sectorsData
    .filter(s => checked.has(s.ticker))
    .map(s => ({
      label: `${s.ticker} (${s.totalReturn >= 0 ? "+" : ""}${s.totalReturn.toFixed(1)}%)`,
      data: s.history.map(p => ({ x: new Date(p.date).getTime(), y: p.normalized })),
      borderColor: s.color,
      backgroundColor: s.color + "22",
      borderWidth: s.ticker === "SPY" ? 2.5 : 1.5,
      borderDash: s.ticker === "SPY" ? [6, 4] : [],
      pointRadius: 0,
      tension: 0.15,
      fill: false,
    }));

  if (sectorLineChart) sectorLineChart.destroy();
  const ctx = document.getElementById("sector-line").getContext("2d");
  sectorLineChart = new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(1)}` },
        },
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "year", displayFormats: { year: "yyyy", month: "MMM yy" } },
          ticks: { color: "#8b949e", maxTicksLimit: 8 },
          grid: { color: "#2a313a" },
        },
        y: {
          ticks: { color: "#8b949e", callback: (v) => v.toFixed(0) },
          grid: { color: "#2a313a" },
          title: { display: true, text: "Indexed (Start = 100)", color: "#8b949e" },
        },
      },
    },
  });
}

function renderSectorTable() {
  const el = document.getElementById("sector-table");
  let html = "<thead><tr><th>Sector</th><th>Ticker</th><th>Start Price</th><th>End Price</th><th>5Y Return</th><th>vs SPY</th></tr></thead><tbody>";
  const spy = sectorsData.find(s => s.ticker === "SPY");
  const spyRet = spy ? spy.totalReturn : 0;
  sectorsData.forEach(s => {
    const vs = s.totalReturn - spyRet;
    const cls = s.totalReturn >= 0 ? "up" : "down";
    const vsCls = vs >= 0 ? "up" : "down";
    html += `<tr>
      <td>${s.sector}</td>
      <td>${s.ticker}</td>
      <td>$${s.startPrice.toFixed(2)}</td>
      <td>$${s.endPrice.toFixed(2)}</td>
      <td class="${cls}">${s.totalReturn >= 0 ? "+" : ""}${s.totalReturn.toFixed(2)}%</td>
      <td class="${vsCls}">${vs >= 0 ? "+" : ""}${vs.toFixed(2)}%</td>
    </tr>`;
  });
  html += "</tbody>";
  el.innerHTML = html;
}

// ====== MACRO ======
let macroLoaded = false;
let macroData = null;
let macroChart = null;
const sparkCharts = {};

const CHART_GROUPS = {
  rates: { title: "U.S. Interest Rates", ids: ["FEDFUNDS", "DGS2", "DGS10"], colors: ["#f85149", "#d29922", "#4ea1ff"] },
  inflation: { title: "Inflation (YoY %)", ids: ["CPIAUCSL", "CPILFESL"], colors: ["#4ea1ff", "#d29922"], yoy: true },
  growth: { title: "Growth & Labor", ids: ["UNRATE", "INDPRO"], colors: ["#f85149", "#3fb950"] },
  risk: { title: "Risk Gauges", ids: ["VIXCLS", "T10Y2Y"], colors: ["#d29922", "#4ea1ff"] },
};

function yoy(history) {
  // Year-over-year % change. Filters non-null and pairs each obs with the
  // prior obs that is >= 365 days older (works for both monthly and weekly data).
  const clean = history.filter(p => p.value != null).map(p => ({ date: p.date, t: new Date(p.date).getTime(), value: p.value }));
  const ONE_YEAR = 365 * 24 * 3600 * 1000;
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const cur = clean[i];
    let prior = null;
    for (let j = i - 1; j >= 0; j--) {
      if (cur.t - clean[j].t >= ONE_YEAR - 7 * 24 * 3600 * 1000) { prior = clean[j]; break; }
    }
    if (prior && prior.value) {
      out.push({ date: cur.date, value: ((cur.value - prior.value) / Math.abs(prior.value)) * 100 });
    }
  }
  return out;
}

function renderMacroChart(group) {
  if (!macroData) return;
  const cfg = CHART_GROUPS[group];
  const seriesById = Object.fromEntries(macroData.series.map(s => [s.id, s]));

  // Find the latest "first valid date" across all series so the chart only
  // shows the period where all series in the group have data.
  let xMin = -Infinity;
  cfg.ids.forEach(id => {
    const s = seriesById[id];
    if (!s || !s.history) return;
    const raw = cfg.yoy ? yoy(s.history) : s.history;
    const firstValid = raw.find(p => p.value != null);
    if (firstValid) {
      const t = new Date(firstValid.date).getTime();
      if (t > xMin) xMin = t;
    }
  });

  const datasets = cfg.ids.map((id, i) => {
    const s = seriesById[id];
    if (!s || !s.history) return null;
    const raw = cfg.yoy ? yoy(s.history) : s.history;
    const points = raw
      .filter(p => p.value != null)
      .map(p => ({ x: new Date(p.date).getTime(), y: p.value }))
      .filter(p => p.x >= xMin);
    return {
      label: s.label + (cfg.yoy ? " (YoY %)" : ""),
      data: points,
      borderColor: cfg.colors[i],
      backgroundColor: cfg.colors[i] + "22",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.15,
      spanGaps: false,
    };
  }).filter(Boolean);

  if (macroChart) macroChart.destroy();
  const ctx = document.getElementById("macro-chart").getContext("2d");
  macroChart = new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      parsing: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { labels: { color: "#e6edf3", font: { size: 12 } } },
        title: { display: true, text: cfg.title, color: "#e6edf3", font: { size: 14 } },
        tooltip: {
          callbacks: {
            label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "month", tooltipFormat: "MMM yyyy", displayFormats: { month: "MMM yy", year: "yyyy" } },
          ticks: { color: "#8b949e", maxTicksLimit: 12, autoSkip: true },
          grid: { color: "#2a313a" },
        },
        y: { ticks: { color: "#8b949e" }, grid: { color: "#2a313a" } },
      },
    },
  });
}

function renderSparkline(canvasId, history, color, meta) {
  const el = document.getElementById(canvasId);
  if (!el || !history) return;
  const points = history.filter(p => p.value != null).map(p => ({ x: new Date(p.date).getTime(), y: p.value }));
  if (points.length === 0) return;
  if (sparkCharts[canvasId]) sparkCharts[canvasId].destroy();
  const units = meta?.units || "";
  const seriesLabel = meta?.label || "";
  sparkCharts[canvasId] = new Chart(el.getContext("2d"), {
    type: "line",
    data: {
      datasets: [{
        label: seriesLabel,
        data: points,
        borderColor: color,
        backgroundColor: color + "33",
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: "#e6edf3",
        pointHoverBorderWidth: 1,
        borderWidth: 1.5,
        tension: 0.2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          displayColors: false,
          backgroundColor: "rgba(22,27,34,0.95)",
          borderColor: "#2a313a",
          borderWidth: 1,
          titleColor: "#e6edf3",
          bodyColor: "#e6edf3",
          padding: 8,
          callbacks: {
            title: (items) => {
              const d = new Date(items[0].parsed.x);
              return d.toISOString().slice(0, 10);
            },
            label: (item) => {
              const v = item.parsed.y;
              const formatted = Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v.toFixed(2);
              return `${formatted}${units ? " " + units : ""}`;
            },
          },
        },
      },
      scales: {
        x: { type: "time", display: false },
        y: { display: false },
      },
    },
  });
}

async function loadMacro() {
  if (macroLoaded) return;
  setStatus("Loading macro…");
  try {
    const data = await api(`/api/macro`);
    macroData = data;
    const grid = $("#macro-grid");
    grid.innerHTML = data.series.map((s, i) => {
      if (s.error) {
        return `<div class="macro-card"><div class="ml">${s.label}</div><div class="muted">${s.error}</div></div>`;
      }
      const v = s.latest?.value;
      const chg = s.pctChange;
      const chgClass = chg == null ? "" : (chg >= 0 ? "up" : "down");
      const chgTxt = chg == null ? "—" : `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% vs prior`;
      return `
        <div class="macro-card">
          <div class="ml">${s.label}</div>
          <div class="mv">${v != null ? fmtNum(v) : "—"} <span class="muted" style="font-size:12px">${s.units}</span></div>
          <div class="mc ${chgClass}">${chgTxt}</div>
          <div class="spark-wrap"><canvas id="spark-${s.id}"></canvas></div>
          <div class="md">As of ${s.latest?.date || "—"} · FRED: ${s.id}</div>
        </div>`;
    }).join("");
    // Render sparklines
    data.series.forEach(s => {
      if (s.history && !s.error) {
        const isUp = s.pctChange == null ? true : s.pctChange >= 0;
        renderSparkline(`spark-${s.id}`, s.history, isUp ? "#3fb950" : "#f85149", { label: s.label, units: s.units });
      }
    });
    // Initial featured chart
    renderMacroChart("rates");
    macroLoaded = true;
    setStatus("");
  } catch (e) {
    setStatus("Macro error: " + e.message);
  }
}

document.querySelectorAll('input[name="macro-chart"]').forEach(r => {
  r.addEventListener("change", e => renderMacroChart(e.target.value));
});

// ====== INIT ======
$("#ticker").value = currentTicker;
loadTicker(currentTicker);
