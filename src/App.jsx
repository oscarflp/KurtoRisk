import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Database, Cpu, CheckCircle2, ShieldCheck, ArrowRight, ArrowDown, Activity,
  AlertOctagon, TrendingUp, GitBranch, Shuffle, ShieldAlert, Lock, Plus
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell,
  ScatterChart, Scatter, ZAxis
} from "recharts";

/* =========================================================================
   ENGINE — deterministic seeded pseudo-random daily returns, market +
   sector factor + idiosyncratic noise. Shared by the Terminal and by
   Market Movers, so both read from the same underlying numbers.
   ========================================================================= */

const N_DAYS = 252;
const RF = 0.04;

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h >>> 0; }
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function genNormalSeries(seedStr, n) {
  const rng = mulberry32(hashStr(seedStr));
  const out = [];
  for (let i = 0; i < n; i += 2) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const mag = Math.sqrt(-2 * Math.log(u));
    out.push(mag * Math.cos(2 * Math.PI * v));
    if (out.length < n) out.push(mag * Math.sin(2 * Math.PI * v));
  }
  return out.slice(0, n);
}

const SECTOR_ANN_VOL = {
  Semiconductors: 0.18, Technology: 0.15, Communication: 0.14, Financials: 0.13,
  Healthcare: 0.10, Consumer: 0.11, Defensive: 0.07, Energy: 0.16, Industrials: 0.12, Automotive: 0.20,
};
const MARKET_ANN_VOL = 0.15;
const MARKET_ANN_DRIFT = 0.09;

const STOCK_UNIVERSE = [
  { t: "NVDA", name: "Nvidia Corp", sector: "Semiconductors", beta: 1.70, idioVol: 0.32, drift: 0.18 },
  { t: "AMD", name: "Advanced Micro Devices", sector: "Semiconductors", beta: 1.60, idioVol: 0.34, drift: 0.10 },
  { t: "TSM", name: "Taiwan Semiconductor", sector: "Semiconductors", beta: 1.30, idioVol: 0.26, drift: 0.12 },
  { t: "ASML", name: "ASML Holding", sector: "Semiconductors", beta: 1.35, idioVol: 0.28, drift: 0.11 },
  { t: "MSFT", name: "Microsoft Corp", sector: "Technology", beta: 0.95, idioVol: 0.18, drift: 0.12 },
  { t: "AAPL", name: "Apple Inc", sector: "Technology", beta: 1.05, idioVol: 0.20, drift: 0.09 },
  { t: "GOOGL", name: "Alphabet Inc", sector: "Technology", beta: 1.10, idioVol: 0.22, drift: 0.10 },
  { t: "META", name: "Meta Platforms", sector: "Technology", beta: 1.25, idioVol: 0.30, drift: 0.14 },
  { t: "NFLX", name: "Netflix Inc", sector: "Communication", beta: 1.20, idioVol: 0.32, drift: 0.13 },
  { t: "DIS", name: "Walt Disney Co", sector: "Communication", beta: 1.05, idioVol: 0.24, drift: 0.03 },
  { t: "JPM", name: "JPMorgan Chase", sector: "Financials", beta: 1.10, idioVol: 0.20, drift: 0.08 },
  { t: "GS", name: "Goldman Sachs", sector: "Financials", beta: 1.20, idioVol: 0.24, drift: 0.09 },
  { t: "BAC", name: "Bank of America", sector: "Financials", beta: 1.25, idioVol: 0.23, drift: 0.06 },
  { t: "UNH", name: "UnitedHealth Group", sector: "Healthcare", beta: 0.70, idioVol: 0.19, drift: 0.05 },
  { t: "LLY", name: "Eli Lilly", sector: "Healthcare", beta: 0.85, idioVol: 0.26, drift: 0.16 },
  { t: "JNJ", name: "Johnson & Johnson", sector: "Healthcare", beta: 0.55, idioVol: 0.14, drift: 0.04 },
  { t: "LVMH", name: "LVMH Moet Hennessy", sector: "Consumer", beta: 0.90, idioVol: 0.22, drift: 0.06 },
  { t: "NKE", name: "Nike Inc", sector: "Consumer", beta: 1.00, idioVol: 0.25, drift: -0.02 },
  { t: "MCD", name: "McDonald's Corp", sector: "Defensive", beta: 0.60, idioVol: 0.15, drift: 0.05 },
  { t: "KO", name: "Coca-Cola Co", sector: "Defensive", beta: 0.50, idioVol: 0.13, drift: 0.04 },
  { t: "XOM", name: "Exxon Mobil", sector: "Energy", beta: 0.80, idioVol: 0.21, drift: 0.03 },
  { t: "SHEL", name: "Shell plc", sector: "Energy", beta: 0.75, idioVol: 0.20, drift: 0.04 },
  { t: "CAT", name: "Caterpillar Inc", sector: "Industrials", beta: 1.15, idioVol: 0.24, drift: 0.07 },
  { t: "TSLA", name: "Tesla Inc", sector: "Automotive", beta: 2.00, idioVol: 0.45, drift: 0.08 },
  { t: "CASH", name: "Cash & equivalents", sector: "Defensive", beta: 0.00, idioVol: 0.005, drift: 0.04 },
];

const marketZ = genNormalSeries("MARKET", N_DAYS);
const marketDailyStd = MARKET_ANN_VOL / Math.sqrt(252);
const marketDailyMean = MARKET_ANN_DRIFT / 252;
const marketRet = marketZ.map((z) => marketDailyMean + marketDailyStd * z);
const marketPrices = [100];
marketRet.forEach((r) => marketPrices.push(marketPrices[marketPrices.length - 1] * (1 + r)));

const sectorRet = {};
Object.keys(SECTOR_ANN_VOL).forEach((sec) => {
  const z = genNormalSeries(sec + "_SECTOR", N_DAYS);
  const s = SECTOR_ANN_VOL[sec] / Math.sqrt(252);
  sectorRet[sec] = z.map((v) => s * v);
});

const RETURNS = {};
const PRICES = {};
STOCK_UNIVERSE.forEach((s) => {
  const idioZ = genNormalSeries(s.t + "_IDIO", N_DAYS);
  const idioStd = s.idioVol / Math.sqrt(252);
  const driftDaily = s.drift / 252;
  const rets = idioZ.map((z, i) => s.beta * marketRet[i] + sectorRet[s.sector][i] + driftDaily + idioStd * z);
  RETURNS[s.t] = rets;
  const px = [100];
  rets.forEach((r) => px.push(px[px.length - 1] * (1 + r)));
  PRICES[s.t] = px;
});

const ANALYST = {};
STOCK_UNIVERSE.forEach((s) => {
  const rng = mulberry32(hashStr(s.t + "_ANALYST"));
  const total = 10 + Math.floor(rng() * 10);
  const bullishness = rng();
  const strongBuy = Math.round(total * bullishness * 0.4);
  const buy = Math.round(total * bullishness * 0.35);
  const hold = Math.round(total * (1 - bullishness) * 0.5);
  const sell = Math.round(total * (1 - bullishness) * 0.3);
  const strongSell = Math.max(0, total - strongBuy - buy - hold - sell);
  const lastPrice = PRICES[s.t][PRICES[s.t].length - 1];
  const targetMult = 1 + (bullishness - 0.3) * 0.35 + (rng() - 0.5) * 0.06;
  const target = lastPrice * targetMult;
  const bullVotes = strongBuy + buy, bearVotes = sell + strongSell;
  const consensus = bullVotes > bearVotes * 1.3 ? "Strong Buy" : bullVotes > bearVotes ? "Buy" : bearVotes > bullVotes * 1.3 ? "Sell" : bearVotes > bullVotes ? "Hold" : "Hold";
  ANALYST[s.t] = { strongBuy, buy, hold, sell, strongSell, total, target, consensus };
});

/* ------------------------- technical indicators --------------------------- */
function smaSeries(arr, period) {
  const out = [];
  for (let i = 0; i < arr.length; i++) { if (i < period - 1) { out.push(null); continue; } let s = 0; for (let j = i - period + 1; j <= i; j++) s += arr[j]; out.push(s / period); }
  return out;
}
function emaSeries(arr, period) {
  const k = 2 / (period + 1);
  const out = [arr[0]];
  for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k));
  return out;
}
function rsiSeries(prices, period = 14) {
  const out = Array(prices.length).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) { const ch = prices[i] - prices[i - 1]; if (ch > 0) gains += ch; else losses -= ch; }
  let avgGain = gains / period, avgLoss = losses / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  for (let i = period + 1; i < prices.length; i++) {
    const ch = prices[i] - prices[i - 1];
    const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}
function computeTechnicals(prices) {
  const sma20 = smaSeries(prices, 20), sma50 = smaSeries(prices, 50);
  const ema12 = emaSeries(prices, 12), ema26 = emaSeries(prices, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = emaSeries(macdLine, 9);
  const hist = macdLine.map((v, i) => v - signalLine[i]);
  const rsiArr = rsiSeries(prices, 14);
  const last = prices.length - 1;
  const price = prices[last];
  const s20 = sma20[last], s50 = sma50[last], rsiV = rsiArr[last], macdHist = hist[last];
  let score = 0;
  let maSignal = "Neutral";
  if (s20 != null && s50 != null) { if (price > s20 && s20 > s50) { maSignal = "Buy"; score++; } else if (price < s20 && s20 < s50) { maSignal = "Sell"; score--; } }
  let rsiSignal = "Neutral";
  if (rsiV != null) { if (rsiV < 30) { rsiSignal = "Buy"; score++; } else if (rsiV > 70) { rsiSignal = "Sell"; score--; } }
  const macdSignal = macdHist > 0 ? "Buy" : macdHist < 0 ? "Sell" : "Neutral";
  score += macdHist > 0 ? 1 : macdHist < 0 ? -1 : 0;
  const label = score >= 2 ? "Strong Buy" : score === 1 ? "Buy" : score === 0 ? "Neutral" : score === -1 ? "Sell" : "Strong Sell";
  return { price, sma20: s20, sma50: s50, rsi: rsiV, macdHist, maSignal, rsiSignal, macdSignal, score, label };
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
function quantile(sortedArr, q) {
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos), rest = pos - base;
  if (sortedArr[base + 1] !== undefined) return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
  return sortedArr[base];
}
function pearson(a, b) {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}
function covariance(a, b) { const ma = mean(a), mb = mean(b); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb); return s / a.length; }
function annVolOf(rets) { return std(rets) * Math.sqrt(252); }
function annRetOf(rets) { return mean(rets) * 252; }
function maxDrawdownOf(prices) { let peak = prices[0], mdd = 0; prices.forEach((p) => { if (p > peak) peak = p; const dd = p / peak - 1; if (dd < mdd) mdd = dd; }); return mdd; }
function drawdownSeries(prices) { let peak = prices[0]; return prices.map((p) => { if (p > peak) peak = p; return (p / peak - 1) * 100; }); }
function rollingVolSeries(rets, window = 20) {
  const out = [];
  for (let i = 0; i < rets.length; i++) { if (i < window - 1) { out.push(null); continue; } out.push(annVolOf(rets.slice(i - window + 1, i + 1)) * 100); }
  return out;
}
function skewnessOf(rets) { const m = mean(rets), s = std(rets); return mean(rets.map((r) => ((r - m) / s) ** 3)); }
function kurtosisExcessOf(rets) { const m = mean(rets), s = std(rets); return mean(rets.map((r) => ((r - m) / s) ** 4)) - 3; }
function cornishFisherVaR(rets) {
  const m = mean(rets), s = std(rets);
  const S = skewnessOf(rets), K = kurtosisExcessOf(rets);
  const z = -1.6448536269514722;
  const zcf = z + ((z ** 2 - 1) * S) / 6 + ((z ** 3 - 3 * z) * K) / 24 - ((2 * z ** 3 - 5 * z) * S ** 2) / 36;
  return m + zcf * s;
}
function omegaRatio(rets, threshold = 0) {
  let gains = 0, losses = 0;
  rets.forEach((r) => { if (r > threshold) gains += r - threshold; else losses += threshold - r; });
  return losses === 0 ? Infinity : gains / losses;
}
function ulcerIndex(ddSeriesPct) { return Math.sqrt(mean(ddSeriesPct.map((d) => (d / 100) ** 2))) * 100; }
function ewmaVol(rets, lambda = 0.94) {
  let v = rets[0] ** 2;
  for (let i = 1; i < rets.length; i++) v = lambda * v + (1 - lambda) * rets[i - 1] ** 2;
  return Math.sqrt(v * 252);
}
function downsideBeta(portRets, mktRets) {
  const idx = mktRets.map((m, i) => (m < 0 ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 5) return NaN;
  const p = idx.map((i) => portRets[i]), m = idx.map((i) => mktRets[i]);
  return covariance(p, m) / (std(m) ** 2);
}
function invertMatrix(M) {
  const n = M.length;
  const A = M.map((row, i) => [...row.map((v, j) => v + (i === j ? 1e-6 : 0)), ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let j = 0; j < 2 * n; j++) A[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[col][j];
    }
  }
  return A.map((row) => row.slice(n));
}
function matVec(M, v) { return M.map((row) => row.reduce((s, x, j) => s + x * v[j], 0)); }

const STRESS_SCENARIOS = [
  { name: "Semiconductor / AI correction", impact: (s) => (s.sector === "Semiconductors" ? -0.18 : s.sector === "Technology" ? -0.10 : -0.03) },
  { name: "Rate shock, +150 bps", impact: (s) => (s.sector === "Financials" ? 0.04 : s.sector === "Technology" || s.sector === "Semiconductors" ? -0.08 : s.sector === "Defensive" ? -0.02 : -0.03) },
  { name: "Broad market drawdown, -20%", impact: (s) => s.beta * -0.20 },
  { name: "Oil price spike, +40%", impact: (s) => (s.sector === "Energy" ? 0.12 : s.sector === "Industrials" ? -0.04 : s.sector === "Consumer" ? -0.03 : -0.01) },
];
function riskColor(score) { return score >= 70 ? "#A6321B" : score >= 45 ? "#9C6B24" : "#1F6F5C"; }
function riskLabel(score) { return score >= 70 ? "Elevated" : score >= 45 ? "Moderate" : "Contained"; }
function scoreClip(x) { return Math.max(0, Math.min(100, x)); }
function fmtPct(x, d = 1) { return `${(x * 100).toFixed(d)}%`; }
function downloadText(filename, content, mime = "text/plain") {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) { /* download not available in this environment */ }
}
function weightsObjToArray(tickers, weightsObj) {
  const raw = tickers.map((t) => Number(weightsObj[t]) || 0);
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((x) => x / sum);
}
const SECTORS_ORDER = ["Semiconductors", "Technology", "Communication", "Financials", "Healthcare", "Consumer", "Defensive", "Energy", "Industrials", "Automotive"];

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap');
  .ay-disp { font-family:'Fraunces', Georgia, serif; }
  .ay-mono { font-family:'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric:tabular-nums; }
  .ay-sans { font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif; }
  .ay-nav a { color:#14201B; text-decoration:none; cursor:pointer; }
  .ay-nav a.active { border-bottom:2px solid #1F6F5C; padding-bottom:3px; }
  .ay-grid { position:absolute; inset:0; background-image: linear-gradient(rgba(20,32,27,0.05) 1px, transparent 1px); background-size: 100% 34px; pointer-events:none; }
  @keyframes ay-marquee { from { transform:translateX(0); } to { transform:translateX(-50%); } }
  .ay-track { display:flex; width:max-content; animation:ay-marquee 36s linear infinite; }
  .ay-btn { cursor:pointer; padding:13px 22px; font-family:'IBM Plex Mono'; font-size:12px; letter-spacing:0.6px; border:1.4px solid #14201B; position:relative; background:none; color:#14201B; }
  .ay-btn.solid { background:#14201B; color:#F6F3EC; transition:background 0.2s; }
  .ay-btn.solid:hover { background:#1F6F5C; border-color:#1F6F5C; }
  .ay-btn .arrow { display:inline-block; transition:transform 0.2s ease; }
  .ay-btn:hover .arrow { transform:translateX(4px); }
  .ay-btn2 { cursor:pointer; background:#1F6F5C; color:#F2F0E8; border:none; padding:10px 14px; font-family:'IBM Plex Mono'; font-size:11.5px; letter-spacing:0.5px; }
  .ay-btn2:hover { background:#268066; }
  @keyframes ay-blink { 0%,100% { opacity:1; } 50% { opacity:0.25; } }
  .ay-live { display:inline-block; width:7px; height:7px; border-radius:50%; background:#1F6F5C; animation:ay-blink 1.6s ease-in-out infinite; margin-right:6px; }
  table.ay-t { border-collapse:collapse; width:100%; font-size:13px; }
  table.ay-t th { text-align:right; font-family:'IBM Plex Mono'; font-weight:500; font-size:10.5px; color:#5C6B62; padding:8px 10px; border-bottom:1px solid #14201B; cursor:pointer; user-select:none; }
  table.ay-t td { text-align:right; padding:9px 10px; border-bottom:1px solid rgba(20,32,27,0.12); }
  table.ay-t th:first-child, table.ay-t td:first-child, table.ay-t th:nth-child(2), table.ay-t td:nth-child(2) { text-align:left; }
  table.ay-t tbody tr:hover { background:rgba(20,32,27,0.03); }

  /* dark terminal (dashboard) */
  .qt-root { --bg:#F6F3EC; --panel:#FFFFFF; --ink:#14201B; --sub:#5C6B62; --hair:#D9D2C4; --pos:#1F6F5C; --neg:#A6321B; --accent:#9C6B24;
    font-family:'IBM Plex Mono', ui-monospace, monospace; color:var(--ink); min-height:100%; position:relative; overflow-x:hidden;
    background: radial-gradient(ellipse 900px 500px at 15% -5%, rgba(31,111,92,0.08), transparent 60%),
                radial-gradient(ellipse 800px 500px at 90% 10%, rgba(156,107,36,0.07), transparent 55%),
                radial-gradient(ellipse 700px 600px at 50% 100%, rgba(166,50,27,0.06), transparent 60%),
                var(--bg); }
  .qt-disp { font-family:'Fraunces', sans-serif; }
  @keyframes qt-pulse { 0%,100% { text-shadow:0 0 18px currentColor; } 50% { text-shadow:0 0 34px currentColor, 0 0 6px currentColor; } }
  .qt-pulse { animation: qt-pulse 2.6s ease-in-out infinite; }
  @keyframes qt-blink { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
  .qt-blink { animation: qt-blink 1.6s ease-in-out infinite; }
  @keyframes qt-fadein { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
  .qt-insight { animation: qt-fadein 0.5s ease; display:inline-block; }
  .qt-tickerwrap { overflow:hidden; border-bottom:1px solid var(--hair); background:#10201C; }
  .qt-tickertrack { display:flex; width:max-content; animation: qt-marquee 40s linear infinite; padding:9px 0; }
  @keyframes qt-marquee { from { transform:translateX(0); } to { transform:translateX(-50%); } }
  .qt-tick { display:inline-flex; align-items:baseline; gap:6px; padding:0 18px; font-size:12px; border-right:1px solid rgba(242,240,232,0.14); color:#9FB3A8; }
  .qt-tick b { color:#F2F0E8; }
  .qt-tickp { transition:color 0.4s ease; font-weight:600; }
  .qt-hair { border:none; border-top:1px solid var(--hair); margin:0; }
  .qt-section { padding:30px 0; border-bottom:1px solid var(--hair); }
  .qt-section:last-child { border-bottom:none; }
  .qt-h { font-family:'Fraunces'; font-weight:600; font-size:15px; letter-spacing:0.2px; margin:0 0 3px; color:var(--ink); }
  .qt-dek { font-size:11.5px; color:var(--sub); margin:0 0 16px; }
  table.qt-t { border-collapse:collapse; width:100%; font-size:12px; }
  table.qt-t th { text-align:right; font-weight:500; font-size:10px; color:var(--sub); padding:6px 9px; border-bottom:1px solid var(--hair); }
  table.qt-t td { text-align:right; padding:8px 9px; border-bottom:1px solid var(--hair); }
  table.qt-t th:first-child, table.qt-t td:first-child, table.qt-t th:nth-child(2), table.qt-t td:nth-child(2) { text-align:left; font-family:'Fraunces'; }
  table.qt-t tbody tr:hover { background:rgba(231,227,216,0.04); }
  .qt-tab { cursor:pointer; padding:10px 0; font-family:'Fraunces'; font-size:12.5px; border:none; background:none; color:var(--sub); border-bottom:2px solid transparent; }
  .qt-tab.on { color:var(--ink); border-bottom:2px solid var(--accent); }
  .qt-tab:hover { color:var(--ink); }
  .qt-chip { cursor:pointer; padding:4px 9px; font-size:11px; border:1px solid var(--hair); background:transparent; color:var(--ink); transition:all 0.15s ease; border-radius:3px; }
  .qt-chip:hover { border-color:var(--accent); color:var(--accent); }
  .qt-chip.on { background:var(--accent); color:#F6F3EC; border-color:var(--accent); box-shadow:0 0 14px rgba(156,107,36,0.35); }
  .qt-stat { padding:0 16px; border-left:1px solid var(--hair); }
  .qt-stat:first-child { border-left:none; padding-left:0; }
  input.qt-in { border:none; border-bottom:1px solid var(--hair); background:transparent; padding:5px 2px; color:var(--ink); font-size:12px; font-family:'IBM Plex Mono'; }
  input.qt-wt { width:48px; border:none; border-bottom:1px solid var(--hair); background:transparent; text-align:right; color:var(--ink); font-size:12px; font-family:'IBM Plex Mono'; }
  .qt-btn { cursor:pointer; border:1px solid var(--hair); background:none; color:var(--ink); padding:6px 12px; font-family:'Fraunces'; font-size:11px; }
  .qt-btn.solid { background:var(--accent); color:#F6F3EC; border-color:var(--accent); font-weight:600; }
  .qt-btn:hover { border-color:var(--accent); }
  .qt-note { border-left:2px solid var(--accent); padding-left:12px; }
`;

/* ============================ LIVE WIDGETS ================================ */

function useLiveSeries(seed, len = 30, tick = 850) {
  const [series, setSeries] = useState(() => Array.from({ length: len }, () => seed));
  useEffect(() => {
    const id = setInterval(() => {
      setSeries((prev) => {
        const last = prev[prev.length - 1];
        const nv = Math.max(0.5, last + (Math.random() - 0.47) * last * 0.01);
        return [...prev.slice(1), nv];
      });
    }, tick);
    return () => clearInterval(id);
  }, [tick]);
  return series;
}
function useLiveValue(tick = 1200) {
  const [v, setV] = useState(() => Math.random() * 2 - 1);
  useEffect(() => {
    const id = setInterval(() => setV((prev) => Math.max(-1, Math.min(1, prev + (Math.random() - 0.5) * 0.5))), tick);
    return () => clearInterval(id);
  }, [tick]);
  return v;
}
function useAnimatedNumber(target, duration = 700) {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf;
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return display;
}
function RowSpark({ points, color, w = 90, h = 26 }) {
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const path = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / range) * h}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none"><polyline points={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function AnimatedStat({ value, fmt }) {
  const v = useAnimatedNumber(value);
  return <>{fmt(v)}</>;
}

function RotatingInsights({ port }) {
  const [idx, setIdx] = useState(0);
  const insights = useMemo(() => {
    const top = [...port.rows].sort((a, b) => b.varShare - a.varShare)[0];
    const msgs = [
      `Portfolio beta of ${port.beta.toFixed(2)} — ${port.beta > 1.1 ? "amplifying" : port.beta < 0.9 ? "dampening" : "tracking"} market moves.`,
      `${top.t} contributes ${top.varShare.toFixed(0)}% of total portfolio VaR on a ${top.weight.toFixed(1)}% weight.`,
      `EWMA volatility forecast: ${fmtPct(port.ewmaVolFwd)}, vs. ${fmtPct(port.annVol)} realised.`,
      `Monte Carlo: ${(port.probLoss10 * 100).toFixed(1)}% probability of a loss beyond 10% in 60 sessions.`,
      `Model fragility on this window: ${port.fragility}.`,
      `Sharpe ${port.sharpe.toFixed(2)} · Sortino ${port.sortino.toFixed(2)} · Calmar ${port.calmar.toFixed(2)}.`,
    ];
    return msgs;
  }, [port]);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % insights.length), 4200);
    return () => clearInterval(id);
  }, [insights.length]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: "1px solid var(--hair)", overflow: "hidden" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} className="qt-blink" />
      <span key={idx} className="qt-insight" style={{ fontSize: 12.5, color: "var(--sub)" }}>{insights[idx]}</span>
    </div>
  );
}

function BigSpark({ points, color }) {
  const w = 400, h = 130;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const path = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / range) * (h - 10) - 5}`).join(" ");
  const area = `0,${h} ${path} ${w},${h}`;
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={130} preserveAspectRatio="none"><polygon points={area} fill={color} opacity="0.08" /><polyline points={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function LiveTicker() {
  const [live, setLive] = useState(() => Object.fromEntries(STOCK_UNIVERSE.map((s) => [s.t, { p: PRICES[s.t][PRICES[s.t].length - 1], dir: 0 }])));
  useEffect(() => {
    const id = setInterval(() => {
      setLive((prev) => {
        const next = {};
        STOCK_UNIVERSE.forEach((s) => {
          const cur = prev[s.t].p;
          const j = (Math.random() - 0.5) * cur * 0.006;
          next[s.t] = { p: Math.max(0.5, cur + j), dir: j >= 0 ? 1 : -1 };
        });
        return next;
      });
    }, 1200);
    return () => clearInterval(id);
  }, []);
  const row = [...STOCK_UNIVERSE, ...STOCK_UNIVERSE];
  return (
    <div style={{ position: "relative", overflow: "hidden", borderBottom: "1px solid rgba(15,20,18,0.1)", background: "#10201C" }}>
      <div className="ay-track" style={{ padding: "8px 0" }}>
        {row.map((s, i) => {
          const d = live[s.t];
          return (
            <span key={i} className="ay-mono" style={{ display: "inline-flex", alignItems: "baseline", gap: 6, padding: "0 20px", fontSize: 12, color: "#F2F0E8", borderRight: "1px solid rgba(242,240,232,0.14)" }}>
              <b>{s.t}</b>
              <span style={{ color: d.dir >= 0 ? "#6FCB9F" : "#E38A7D", transition: "color 0.4s" }}>{d.p.toFixed(2)}</span>
              <span style={{ color: d.dir >= 0 ? "#6FCB9F" : "#E38A7D" }}>{d.dir >= 0 ? "▲" : "▼"}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

const WATCH = ["NVDA", "TSLA", "JPM"];
function LivePanel({ onEnter }) {
  const index = useLiveSeries(100, 36, 800);
  const w1 = useLiveSeries(PRICES.NVDA[PRICES.NVDA.length - 1], 20, 1000);
  const w2 = useLiveSeries(PRICES.TSLA[PRICES.TSLA.length - 1], 20, 1050);
  const w3 = useLiveSeries(PRICES.JPM[PRICES.JPM.length - 1], 20, 1100);
  const series = { NVDA: w1, TSLA: w2, JPM: w3 };
  const indexUp = index[index.length - 1] >= index[0];
  return (
    <div style={{ background: "#10201C", color: "#F2F0E8", padding: "26px 26px 20px" }}>
      <div className="ay-sans" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, letterSpacing: "1px", color: "#9FB3A8", marginBottom: 6 }}>
        <span>SIMULATED INDEX</span>
        <span style={{ color: indexUp ? "#6FCB9F" : "#E38A7D" }}>{indexUp ? "▲" : "▼"} {Math.abs(index[index.length - 1] - index[0]).toFixed(2)}</span>
      </div>
      <div className="ay-mono" style={{ fontSize: 30, fontWeight: 600, marginBottom: 4 }}>{index[index.length - 1].toFixed(2)}</div>
      <BigSpark points={index} color={indexUp ? "#6FCB9F" : "#E38A7D"} />
      <div style={{ borderTop: "1px solid rgba(242,240,232,0.12)", marginTop: 8, paddingTop: 14 }}>
        {WATCH.map((t) => {
          const arr = series[t];
          const up = arr[arr.length - 1] >= arr[0];
          const info = STOCK_UNIVERSE.find((u) => u.t === t);
          return (
            <div key={t} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0" }}>
              <div className="ay-sans" style={{ fontSize: 12.5 }}><b>{t}</b> <span style={{ color: "#9FB3A8" }}>{info.name}</span></div>
              <RowSpark points={arr} color={up ? "#6FCB9F" : "#E38A7D"} />
              <div className="ay-mono" style={{ fontSize: 13, width: 60, textAlign: "right", color: up ? "#6FCB9F" : "#E38A7D" }}>{arr[arr.length - 1].toFixed(2)}</div>
            </div>
          );
        })}
      </div>
      <button className="ay-btn2" type="button" onClick={onEnter} style={{ marginTop: 16, width: "100%" }}>OPEN THE TERMINAL →</button>
    </div>
  );
}

const INDICES = [
  { name: "US 500", p: 5812 }, { name: "TECH 100", p: 20140 }, { name: "EURO STX", p: 4980 },
  { name: "SEMIS", p: 4870 }, { name: "ENERGY", p: 690 }, { name: "CRYPTO PX", p: 61200 },
];
function IndexCard({ idx }) {
  const series = useLiveSeries(idx.p, 26, 900 + Math.random() * 300);
  const up = series[series.length - 1] >= series[0];
  const pct = ((series[series.length - 1] - series[0]) / series[0]) * 100;
  return (
    <div style={{ border: "1px solid rgba(20,32,27,0.12)", padding: "14px 16px", background: "rgba(255,255,255,0.55)" }}>
      <div className="ay-sans" style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, letterSpacing: "0.5px", color: "#5C6B62" }}>
        <span>{idx.name}</span><span style={{ color: up ? "#1F6F5C" : "#A6321B" }}>{up ? "+" : ""}{pct.toFixed(2)}%</span>
      </div>
      <div className="ay-mono" style={{ fontSize: 18, fontWeight: 600, margin: "3px 0" }}>{series[series.length - 1].toFixed(series[series.length - 1] > 1000 ? 0 : 2)}</div>
      <RowSpark points={series} color={up ? "#1F6F5C" : "#A6321B"} />
    </div>
  );
}
function HeatTile({ name }) {
  const v = useLiveValue(1100 + Math.random() * 500);
  const bg = v >= 0 ? `rgba(31,111,92,${0.15 + v * 0.55})` : `rgba(166,50,27,${0.15 + -v * 0.55})`;
  return (
    <div style={{ background: bg, padding: "12px 8px", textAlign: "center", transition: "background 0.6s ease" }}>
      <div className="ay-sans" style={{ fontSize: 10.5, color: "#14201B" }}>{name}</div>
      <div className="ay-mono" style={{ fontSize: 12.5, fontWeight: 600, color: "#14201B" }}>{v >= 0 ? "+" : ""}{(v * 2.4).toFixed(2)}%</div>
    </div>
  );
}
const SECTORS = ["Tech", "Financials", "Energy", "Healthcare", "Consumer", "Industrials", "Semis", "Comm.", "Defensive", "Autos"];

/* =============================== NAV ==================================== */

function Nav({ view, setView, user, onSignIn }) {
  return (
    <div className="ay-nav" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 40px", borderBottom: "1px solid rgba(20,32,27,0.1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }} onClick={() => setView("landing")}>
        <span style={{ width: 8, height: 8, background: "#1F6F5C", display: "inline-block" }} />
        <span className="ay-disp" style={{ fontSize: 19, fontWeight: 600 }}>KurtoRisk</span>
      </div>
      <div className="ay-sans" style={{ display: "flex", gap: 26, fontSize: 12, letterSpacing: "0.5px" }}>
        <a className={view === "terminal" ? "active" : ""} onClick={() => setView("terminal")}>Analyse</a>
        <a className={view === "movers" ? "active" : ""} onClick={() => setView("movers")}>Market movers</a>
        <a className={view === "method" ? "active" : ""} onClick={() => setView("method")}>Methodology</a>
        <a className={view === "validation" ? "active" : ""} onClick={() => setView("validation")}>Model Validation</a>
        <a className={view === "glossary" ? "active" : ""} onClick={() => setView("glossary")}>Glossary</a>
        {user ? <a onClick={onSignIn}>Hi, {user}</a> : <a onClick={onSignIn}>Sign in</a>}
      </div>
    </div>
  );
}

function SignInModal({ onClose, onSubmit }) {
  const [name, setName] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,32,27,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div className="ay-root" style={{ background: "#F6F3EC", padding: "30px 32px", width: 320, border: "1px solid #14201B" }} onClick={(e) => e.stopPropagation()}>
        <div className="ay-disp" style={{ fontSize: 20, marginBottom: 4 }}>Sign in</div>
        <p className="ay-sans" style={{ fontSize: 11.5, color: "#5C6B62", marginBottom: 16 }}>Local session for this demo — nothing is sent to a server.</p>
        <input className="ay-sans" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)}
          style={{ width: "100%", border: "1px solid rgba(20,32,27,0.2)", padding: "9px 10px", fontSize: 13, marginBottom: 14, boxSizing: "border-box" }} />
        <button className="ay-btn solid" type="button" style={{ width: "100%" }} onClick={() => name.trim() && onSubmit(name.trim())}>CONTINUE</button>
      </div>
    </div>
  );
}

/* =============================== LANDING ================================= */

function Landing({ setView }) {
  return (
    <div>
      <LiveTicker />
      <div style={{ position: "relative", maxWidth: 1180, margin: "0 auto" }}>
        <div className="ay-grid" style={{ maxWidth: 1180, margin: "0 auto" }} />
        <div style={{ position: "relative", display: "flex", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 480px", padding: "70px 40px 50px" }}>
            <div className="ay-sans" style={{ fontSize: 11.5, letterSpacing: "1.5px", color: "#5C6B62", marginBottom: 18, display: "flex", alignItems: "center" }}>
              <span className="ay-live" /> LIVE MARKET DATA
            </div>
            <h1 className="ay-disp" style={{ fontSize: 52, fontWeight: 400, lineHeight: 1.14, margin: "0 0 26px", letterSpacing: "-0.5px" }}>
              Build a portfolio.<br />Read its <em style={{ fontStyle: "italic", color: "#1F6F5C" }}>real risk</em>, not just its price.
            </h1>
            <p style={{ fontSize: 17, lineHeight: 1.65, color: "#3A423D", maxWidth: 480, margin: "0 0 30px" }}>
              KurtoRisk turns your holdings into volatility, drawdown, and tail-risk scenarios you can actually read —
              recalculated the instant you change anything. No jargon, no buy or sell calls.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button className="ay-btn solid" type="button" onClick={() => setView("terminal")}>BUILD YOUR PORTFOLIO <span className="arrow">→</span></button>
              <button className="ay-btn" type="button" onClick={() => setView("movers")}>SEE MARKET MOVERS <span className="arrow">→</span></button>
            </div>
            <div className="ay-sans" style={{ marginTop: 34, fontSize: 11, letterSpacing: "1px", color: "#5C6B62" }}>STOCKS · ETFS · CRYPTO · COMMODITIES</div>
          </div>
          <div style={{ flex: "1 1 360px", padding: "40px", display: "flex", alignItems: "center" }}>
            <div style={{ width: "100%", maxWidth: 420, boxShadow: "0 30px 60px -30px rgba(20,32,27,0.35)" }}>
              <LivePanel onEnter={() => setView("terminal")} />
            </div>
          </div>
        </div>
        <div style={{ position: "relative", padding: "10px 40px 30px" }}>
          <div className="ay-sans" style={{ fontSize: 11, letterSpacing: "1.5px", color: "#5C6B62", marginBottom: 14 }}>GLOBAL INDICES, LIVE</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {INDICES.map((idx) => <IndexCard key={idx.name} idx={idx} />)}
          </div>
        </div>
        <div style={{ position: "relative", padding: "10px 40px 60px" }}>
          <div className="ay-sans" style={{ fontSize: 11, letterSpacing: "1.5px", color: "#5C6B62", marginBottom: 14 }}>SECTOR HEATMAP, LIVE</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 3 }}>
            {SECTORS.map((s) => <HeatTile key={s} name={s} />)}
          </div>
        </div>

        <div style={{ position: "relative", padding: "10px 40px 70px" }}>
          <div className="ay-sans" style={{ fontSize: 11, letterSpacing: "1.5px", color: "#5C6B62", marginBottom: 14 }}>ECONOMIC CALENDAR</div>
          <table className="ay-t ay-mono" style={{ maxWidth: 720 }}>
            <thead><tr><th className="ay-sans">When</th><th className="ay-sans">Event</th><th className="ay-sans">Impact</th><th>Forecast</th><th>Prior</th></tr></thead>
            <tbody>
              {[
                ["Today 14:30", "US Core CPI m/m", "High", "0.3%", "0.2%"],
                ["Today 20:00", "FOMC Rate Decision", "High", "4.25%", "4.25%"],
                ["Tomorrow 08:00", "EU Industrial Production", "Medium", "-0.1%", "0.4%"],
                ["Tomorrow 12:30", "US Initial Jobless Claims", "Medium", "224K", "231K"],
                ["Fri 10:00", "China Retail Sales y/y", "Medium", "3.2%", "3.0%"],
                ["Fri 14:30", "US Nonfarm Payrolls", "High", "180K", "142K"],
              ].map((row, i) => (
                <tr key={i}>
                  <td className="ay-sans" style={{ fontSize: 12 }}>{row[0]}</td>
                  <td style={{ fontFamily: "Source Serif 4, serif", fontSize: 13 }}>{row[1]}</td>
                  <td style={{ color: row[2] === "High" ? "#A6321B" : "#9C6B24", fontSize: 11 }}>{row[2]}</td>
                  <td>{row[3]}</td>
                  <td style={{ color: "#5C6B62" }}>{row[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================ MARKET MOVERS ============================== */

function MarketMovers({ setView, cash, setCash, positions, setPositions }) {
  const [live, setLive] = useState(() => Object.fromEntries(STOCK_UNIVERSE.map((s) => {
    const last = PRICES[s.t][PRICES[s.t].length - 1];
    const prev = PRICES[s.t][PRICES[s.t].length - 2];
    return [s.t, { p: last, chg: (last / prev - 1) * 100 }];
  })));
  const [sortKey, setSortKey] = useState("chg");
  const [sortDir, setSortDir] = useState(-1);
  const [alerts, setAlerts] = useState({});
  const [alertInputs, setAlertInputs] = useState({});
  const [triggered, setTriggered] = useState([]);
  const alertsRef = useRef({});
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);

  useEffect(() => {
    const id = setInterval(() => {
      setLive((prev) => {
        const next = {};
        const fires = [];
        STOCK_UNIVERSE.forEach((s) => {
          const cur = prev[s.t].p;
          const j = (Math.random() - 0.5) * cur * 0.004;
          const np = Math.max(0.5, cur + j);
          next[s.t] = { p: np, chg: prev[s.t].chg + (j / cur) * 100 };
          const al = alertsRef.current[s.t];
          if (al && !al.done) {
            const nowAbove = np >= al.target;
            if (nowAbove !== al.above) {
              fires.push(`${s.t} crossed ${al.target.toFixed(2)}`);
              al.done = true;
            }
          }
        });
        if (fires.length) setTriggered((t) => [...fires, ...t].slice(0, 6));
        return next;
      });
    }, 1500);
    return () => clearInterval(id);
  }, []);

  function armAlert(t) {
    const target = Number(alertInputs[t]);
    if (!target) return;
    setAlerts((prev) => ({ ...prev, [t]: { target, above: live[t].p >= target, done: false } }));
  }

  const rows = STOCK_UNIVERSE.map((s) => ({
    t: s.t, name: s.name, sector: s.sector, beta: s.beta,
    vol: annVolOf(RETURNS[s.t]), p: live[s.t].p, chg: live[s.t].chg,
  }));
  rows.sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : -1) * sortDir);

  function headerClick(key) {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(-1); }
  }

  const breadth = rows.filter((r) => r.chg >= 0).length / rows.length;
  const avgChg = mean(rows.map((r) => r.chg));
  const avgVol = mean(rows.map((r) => r.vol));
  const fgScore = Math.max(0, Math.min(100, 50 + (breadth - 0.5) * 100 * 0.6 + avgChg * 8 - (avgVol - 0.20) * 100 * 0.5));
  const fgLabel = fgScore < 25 ? "Extreme Fear" : fgScore < 45 ? "Fear" : fgScore < 55 ? "Neutral" : fgScore < 75 ? "Greed" : "Extreme Greed";
  function buy(t) {
    const price = live[t].p;
    const qty = 10;
    const cost = price * qty;
    if (cost > cash) return;
    setCash((c) => c - cost);
    setPositions((prev) => {
      const cur = prev[t] || { qty: 0, avgCost: 0 };
      const newQty = cur.qty + qty;
      const newAvg = (cur.qty * cur.avgCost + cost) / newQty;
      return { ...prev, [t]: { qty: newQty, avgCost: newAvg } };
    });
  }
  function sell(t) {
    const pos = positions[t];
    if (!pos || pos.qty <= 0) return;
    const qty = Math.min(10, pos.qty);
    const price = live[t].p;
    setCash((c) => c + price * qty);
    setPositions((prev) => {
      const remaining = pos.qty - qty;
      const next = { ...prev };
      if (remaining <= 0) delete next[t]; else next[t] = { ...pos, qty: remaining };
      return next;
    });
  }
  const heldTickers = Object.keys(positions);
  const positionsValue = heldTickers.reduce((s, t) => s + positions[t].qty * (live[t] ? live[t].p : 0), 0);
  const costBasis = heldTickers.reduce((s, t) => s + positions[t].qty * positions[t].avgCost, 0);
  const equity = cash + positionsValue;
  const totalPL = positionsValue - costBasis;

  const fgColor = fgScore < 45 ? "#A6321B" : fgScore < 55 ? "#9C6B24" : "#1F6F5C";

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "50px 40px 70px" }}>
      <div className="ay-disp" style={{ fontSize: 30, marginBottom: 6 }}>Market movers</div>
      <p className="ay-sans" style={{ fontSize: 13, color: "#5C6B62", marginBottom: 24 }}>
        All {STOCK_UNIVERSE.length} names in the KurtoRisk universe, live-updating · click a column to sort · same
        engine that powers the risk terminal.
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 30 }}>
        <div style={{ border: "1px solid rgba(20,32,27,0.15)", padding: "16px 20px", minWidth: 220 }}>
          <div className="ay-sans" style={{ fontSize: 10.5, letterSpacing: "1px", color: "#5C6B62" }}>FEAR &amp; GREED INDEX</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="ay-mono" style={{ fontSize: 30, fontWeight: 700, color: fgColor }}><AnimatedStat value={fgScore} fmt={(v) => Math.round(v)} /></span>
            <span className="ay-sans" style={{ fontSize: 13, color: fgColor }}>{fgLabel}</span>
          </div>
          <div style={{ background: "rgba(20,32,27,0.1)", height: 5, marginTop: 6 }}><div style={{ width: `${fgScore}%`, height: 5, background: fgColor }} /></div>
          <div className="ay-sans" style={{ fontSize: 10, color: "#5C6B62", marginTop: 4 }}>breadth {(breadth * 100).toFixed(0)}% up · avg vol {(avgVol * 100).toFixed(1)}%</div>
        </div>
        <div style={{ border: "1px solid rgba(20,32,27,0.15)", padding: "16px 20px", minWidth: 240 }}>
          <div className="ay-sans" style={{ fontSize: 10.5, letterSpacing: "1px", color: "#5C6B62" }}>PAPER TRADING · $100,000 START</div>
          <div style={{ display: "flex", gap: 18, marginTop: 4 }}>
            <div><div className="ay-sans" style={{ fontSize: 9.5, color: "#8A9690" }}>Equity</div><div className="ay-mono" style={{ fontSize: 18, fontWeight: 700 }}>$<AnimatedStat value={equity} fmt={(v) => v.toFixed(0)} /></div></div>
            <div><div className="ay-sans" style={{ fontSize: 9.5, color: "#8A9690" }}>Cash</div><div className="ay-mono" style={{ fontSize: 14 }}>${cash.toFixed(0)}</div></div>
            <div><div className="ay-sans" style={{ fontSize: 9.5, color: "#8A9690" }}>Open P&amp;L</div><div className="ay-mono" style={{ fontSize: 14, color: totalPL >= 0 ? "#1F6F5C" : "#A6321B" }}>{totalPL >= 0 ? "+" : ""}${totalPL.toFixed(0)}</div></div>
          </div>
          {heldTickers.length > 0 && (
            <div className="ay-sans" style={{ fontSize: 11, marginTop: 8, color: "#5C6B62" }}>{heldTickers.map((t) => `${t} ×${positions[t].qty}`).join(" · ")}</div>
          )}
        </div>
        {triggered.length > 0 && (
          <div style={{ border: "1px solid rgba(166,50,27,0.4)", padding: "16px 20px", flex: "1 1 260px" }}>
            <div className="ay-sans" style={{ fontSize: 10.5, letterSpacing: "1px", color: "#A6321B", marginBottom: 6 }}>TRIGGERED ALERTS</div>
            {triggered.map((t, i) => <div key={i} className="ay-mono" style={{ fontSize: 12.5, marginBottom: 3 }}>▲ {t}</div>)}
          </div>
        )}
      </div>

      <table className="ay-t ay-mono">
        <thead>
          <tr>
            <th className="ay-sans" onClick={() => headerClick("t")}>Ticker</th>
            <th className="ay-sans" onClick={() => headerClick("name")}>Name</th>
            <th onClick={() => headerClick("p")}>Price</th>
            <th onClick={() => headerClick("chg")}>Change</th>
            <th onClick={() => headerClick("vol")}>Vol</th>
            <th className="ay-sans">Analyst consensus</th>
            <th>Target</th>
            <th className="ay-sans">Set alert</th>
            <th className="ay-sans">Trade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const a = ANALYST[r.t];
            const upside = (a.target / r.p - 1) * 100;
            return (
              <tr key={r.t}>
                <td style={{ fontWeight: 700 }}>{r.t}</td>
                <td style={{ fontFamily: "Source Serif 4, serif" }}>{r.name}</td>
                <td>{r.p.toFixed(2)}</td>
                <td style={{ color: r.chg >= 0 ? "#1F6F5C" : "#A6321B", fontWeight: 600 }}>{r.chg >= 0 ? "+" : ""}{r.chg.toFixed(2)}%</td>
                <td>{(r.vol * 100).toFixed(1)}%</td>
                <td className="ay-sans" style={{ fontSize: 11.5, color: a.consensus.includes("Buy") ? "#1F6F5C" : a.consensus === "Hold" ? "#9C6B24" : "#A6321B" }}>{a.consensus} ({a.total})</td>
                <td>{a.target.toFixed(2)} <span style={{ fontSize: 10, color: upside >= 0 ? "#1F6F5C" : "#A6321B" }}>({upside >= 0 ? "+" : ""}{upside.toFixed(1)}%)</span></td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <input className="ay-sans" placeholder="px" value={alertInputs[r.t] ?? ""} onChange={(e) => setAlertInputs((p) => ({ ...p, [r.t]: e.target.value }))}
                      style={{ width: 52, border: "1px solid rgba(20,32,27,0.2)", padding: "3px 5px", fontSize: 11 }} />
                    <button className="ay-sans" type="button" onClick={() => armAlert(r.t)}
                      style={{ border: "1px solid #14201B", background: alerts[r.t] && !alerts[r.t].done ? "#14201B" : "none", color: alerts[r.t] && !alerts[r.t].done ? "#F6F3EC" : "#14201B", fontSize: 10, padding: "3px 7px", cursor: "pointer" }}>
                      {alerts[r.t] && !alerts[r.t].done ? "armed" : "set"}
                    </button>
                  </div>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <button className="ay-sans" type="button" onClick={() => buy(r.t)}
                      style={{ border: "1px solid #1F6F5C", background: "none", color: "#1F6F5C", fontSize: 10, padding: "3px 7px", cursor: "pointer" }}>buy 10</button>
                    <button className="ay-sans" type="button" onClick={() => sell(r.t)} disabled={!positions[r.t]}
                      style={{ border: "1px solid #A6321B", background: "none", color: positions[r.t] ? "#A6321B" : "#C9BFB2", fontSize: 10, padding: "3px 7px", cursor: positions[r.t] ? "pointer" : "default" }}>sell 10</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <button className="ay-btn solid" type="button" onClick={() => setView("terminal")}>ANALYSE THESE IN THE TERMINAL →</button>
        <button className="ay-btn" type="button" onClick={() => {
          const header = "Ticker,Name,Sector,Price,Change%,AnnVol%,Analyst,Target";
          const lines = rows.map((r) => { const a = ANALYST[r.t]; return [r.t, r.name, r.sector, r.p.toFixed(2), r.chg.toFixed(2), (r.vol * 100).toFixed(2), a.consensus, a.target.toFixed(2)].join(","); });
          downloadText("kurtorisk_market_movers.csv", [header, ...lines].join("\n"), "text/csv");
        }}>download CSV</button>
      </div>
    </div>
  );
}

/* ================================ METHOD ================================= */

function FlowNode({ icon: Icon, label, sub, color }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 100 }}>
      <div style={{ width: 52, height: 52, borderRadius: "50%", border: `1.5px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(31,111,92,0.05)" }}>
        <Icon size={22} color={color} strokeWidth={1.6} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div className="ay-sans" style={{ fontSize: 11.5, fontWeight: 600, color: "#14201B" }}>{label}</div>
        <div className="ay-sans" style={{ fontSize: 9.5, color: "#8A9690" }}>{sub}</div>
      </div>
    </div>
  );
}

function Methodology({ setView }) {
  const layers = [
    { n: "0", title: "Data Layer", icon: Database, body: "Daily return series for every holding are generated by a shared simulation engine: a market factor, a sector factor, and stock-specific noise, combined with realistic betas and volatilities per sector. This is a simulated dataset built for this demo — not a live multi-exchange feed." },
    { n: "1", title: "Risk Engine", icon: Cpu, body: "A deterministic layer: every metric on this site is computed directly from the return series with closed-form formulas — no black box, no model that could hallucinate a number. Given the same holdings and weights, it always returns the same result." },
    { n: "2", title: "Validation Layer", icon: CheckCircle2, body: "Before a number is shown, a few consistency checks run — see the checklist below. The Monte Carlo fragility indicator belongs here too: it re-estimates VaR on sub-periods of your own history and flags when the estimate is unstable." },
    { n: "3", title: "Safeguards", icon: ShieldCheck, body: "Guardrails that stop the interface from showing something misleading — see the list below. Every page also carries the same disclaimer: this is analysis, not advice." },
  ];
  const metricGroups = [
    { label: "Volatility family", icon: Activity, items: ["Realised vol", "EWMA vol", "Rolling vol"] },
    { label: "Tail risk family", icon: AlertOctagon, items: ["VaR95", "CVaR95", "Cornish-Fisher VaR"] },
    { label: "Ratio family", icon: TrendingUp, items: ["Sharpe", "Sortino", "Calmar", "Treynor", "Omega"] },
    { label: "Optimizer", icon: GitBranch, items: ["Min-variance", "Max-Sharpe tangency"] },
    { label: "Simulation", icon: Shuffle, items: ["Monte Carlo fan", "Bootstrap VaR"] },
  ];
  const checks = [
    "Cornish-Fisher VaR moves sensibly with skew and kurtosis",
    "Covariance matrix is invertible before the optimizer runs",
    "Composite risk score stays inside its 0-100 bound",
    "VaR estimate re-checked for stability across sub-periods (fragility)",
  ];
  const guards = [
    { icon: Lock, text: "Scores are clipped to their valid range, never shown out of bounds" },
    { icon: ShieldAlert, text: "Divide-by-zero ratios show \"n/a\" instead of Infinity or NaN" },
    { icon: ShieldCheck, text: "A singular covariance matrix disables the optimizer with an explicit message" },
    { icon: CheckCircle2, text: "Every page carries the same disclaimer — analysis, not advice" },
  ];

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "50px 40px 80px" }}>
      <div className="ay-disp" style={{ fontSize: 30, marginBottom: 6 }}>Methodology</div>
      <p className="ay-sans" style={{ fontSize: 13, color: "#5C6B62", marginBottom: 34 }}>How the KurtoRisk engine computes, checks and constrains every number it shows you.</p>

      {/* Architecture flow diagram */}
      <div style={{ border: "1px solid rgba(20,32,27,0.12)", padding: "28px 20px", marginBottom: 30, overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 560 }}>
          <FlowNode icon={Database} label="Data Layer" sub="0" color="#1F6F5C" />
          <ArrowRight size={18} color="#B7AE9E" style={{ flexShrink: 0 }} />
          <FlowNode icon={Cpu} label="Risk Engine" sub="1" color="#1F6F5C" />
          <ArrowRight size={18} color="#B7AE9E" style={{ flexShrink: 0 }} />
          <FlowNode icon={CheckCircle2} label="Validation" sub="2" color="#9C6B24" />
          <ArrowRight size={18} color="#B7AE9E" style={{ flexShrink: 0 }} />
          <FlowNode icon={ShieldCheck} label="Safeguards" sub="3" color="#9C6B24" />
          <ArrowRight size={18} color="#B7AE9E" style={{ flexShrink: 0 }} />
          <FlowNode icon={TrendingUp} label="Output" sub="→" color="#14201B" />
        </div>
      </div>

      <div style={{ padding: "18px 0", borderBottom: "1px solid rgba(20,32,27,0.12)", marginBottom: 6 }}>
        <div className="ay-disp" style={{ fontSize: 18, marginBottom: 6 }}>System architecture</div>
        <p style={{ fontSize: 14.5, lineHeight: 1.7, color: "#3A423D" }}>
          KurtoRisk is organised in four independent layers. Each one only talks to the layer next to it, so a
          change in the data source never has to touch the risk formulas, and a change in the formulas never has
          to touch the safeguards. Results are deterministic at every layer.
        </p>
      </div>

      {layers.map((l) => (
        <div key={l.n} style={{ padding: "20px 0", borderBottom: "1px solid rgba(20,32,27,0.12)" }}>
          <div className="ay-disp" style={{ fontSize: 16, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <l.icon size={17} color="#1F6F5C" strokeWidth={1.7} />
            <span className="ay-mono" style={{ color: "#1F6F5C" }}>{l.n}</span>{l.title}
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#3A423D", marginBottom: 14 }}>{l.body}</p>

          {l.n === "0" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "rgba(20,32,27,0.03)", padding: "16px", justifyContent: "center" }}>
              {["Market factor", "Sector factor", "Idiosyncratic noise"].map((x, i) => (
                <React.Fragment key={x}>
                  <div className="ay-mono" style={{ fontSize: 11, border: "1px solid #D9D2C4", padding: "8px 12px", background: "#FFFFFF" }}>{x}</div>
                  {i < 2 && <Plus size={14} color="#8A9690" />}
                </React.Fragment>
              ))}
              <ArrowRight size={16} color="#8A9690" />
              <div className="ay-mono" style={{ fontSize: 11, border: "1px solid #1F6F5C", color: "#1F6F5C", padding: "8px 12px", background: "#FFFFFF", fontWeight: 600 }}>Daily return</div>
            </div>
          )}

          {l.n === "1" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              {metricGroups.map((g) => (
                <div key={g.label} style={{ border: "1px solid rgba(20,32,27,0.12)", padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <g.icon size={14} color="#1F6F5C" /><span className="ay-sans" style={{ fontSize: 11, fontWeight: 600 }}>{g.label}</span>
                  </div>
                  {g.items.map((it) => <div key={it} className="ay-sans" style={{ fontSize: 10.5, color: "#5C6B62" }}>{it}</div>)}
                </div>
              ))}
            </div>
          )}

          {l.n === "2" && (
            <div>
              {checks.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                  <CheckCircle2 size={14} color="#9C6B24" style={{ flexShrink: 0 }} />
                  <span className="ay-sans" style={{ fontSize: 12.5 }}>{c}</span>
                </div>
              ))}
            </div>
          )}

          {l.n === "3" && (
            <div>
              {guards.map((g, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                  <g.icon size={14} color="#9C6B24" style={{ flexShrink: 0 }} />
                  <span className="ay-sans" style={{ fontSize: 12.5 }}>{g.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div style={{ padding: "18px 0", borderBottom: "1px solid rgba(20,32,27,0.12)" }}>
        <div className="ay-disp" style={{ fontSize: 18, marginBottom: 6 }}>Transparency</div>
        <ul style={{ fontSize: 14, lineHeight: 1.8, color: "#3A423D", paddingLeft: 20, margin: 0 }}>
          <li>KurtoRisk does not provide investment advice.</li>
          <li>The system quantifies structural risk conditions on data you select yourself.</li>
          <li>Every category, score and threshold used anywhere on the site is documented on the <a onClick={() => setView("glossary")} style={{ color: "#1F6F5C", cursor: "pointer" }}>Glossary</a> page.</li>
          <li>Bootstrap validation of the engine's estimates, and a real optimizer-vs-baseline comparison, are on the <a onClick={() => setView("validation")} style={{ color: "#1F6F5C", cursor: "pointer" }}>Model Validation</a> page.</li>
          <li>Prices, analyst consensus, and calendar events on this build are simulated — see each page for what's real vs illustrative.</li>
        </ul>
      </div>

      <p className="ay-sans" style={{ fontSize: 11.5, color: "#8A9690", marginTop: 20, lineHeight: 1.6 }}>
        This methodology is for educational purposes. Models have inherent limitations. Consult a qualified advisor for any investment decisions.
      </p>
      <button className="ay-btn solid" type="button" style={{ marginTop: 20 }} onClick={() => setView("terminal")}>TRY IT IN THE TERMINAL →</button>
    </div>
  );
}

function Glossary() {
  const groups = [
    {
      title: "Risk score (0-100)",
      items: [
        ["Composite formula", "35% volatility score + 25% drawdown score + 20% concentration score + 20% tail (VaR) score, each normalised 0-100 against a reference ceiling (45% vol, 35% drawdown, 6% daily VaR)."],
        ["Contained", "Score under 45 — teal."],
        ["Moderate", "Score 45 to 69 — amber."],
        ["Elevated", "Score 70 or above — red."],
      ],
    },
    {
      title: "Technical signal",
      items: [
        ["Per-indicator vote", "Moving average (price vs SMA20 vs SMA50), RSI14 (below 30 = oversold/Buy, above 70 = overbought/Sell), and MACD histogram sign each cast one vote: Buy (+1), Sell (-1), or Neutral (0)."],
        ["Composite label", "Weighted sum across your holdings: ≥1.3 Strong Buy, ≥0.4 Buy, -0.4 to 0.4 Neutral, ≤-0.4 Sell, ≤-1.3 Strong Sell."],
      ],
    },
    {
      title: "Fear & Greed index (Market Movers)",
      items: [
        ["Formula", "50 + (breadth-50%)×60% + average change×8 - (average volatility-20%)×50%, clipped to 0-100."],
        ["Bands", "Under 25 Extreme Fear, under 45 Fear, 45-55 Neutral, under 75 Greed, 75+ Extreme Greed."],
      ],
    },
    {
      title: "Analyst consensus (Market Movers)",
      items: [
        ["How it's generated", "Simulated, not real analyst data: a fixed random seed per ticker produces a stable distribution of Strong Buy/Buy/Hold/Sell/Strong Sell votes and a price target, so the same ticker always shows the same consensus."],
        ["Consensus label", "Strong Buy if bullish votes exceed bearish by 30%+, Buy if simply more bullish, and the mirror for Sell; otherwise Hold."],
      ],
    },
    {
      title: "Sectors",
      items: [
        ["Coverage", "Semiconductors, Technology, Communication, Financials, Healthcare, Consumer, Defensive, Energy, Industrials, Automotive — each holding is assigned exactly one."],
      ],
    },
    {
      title: "Model fragility (Simulation tab)",
      items: [
        ["How it's measured", "VaR95 is recomputed separately on each quarter of your holding's history; fragility is the coefficient of variation across those four estimates."],
        ["Bands", "Under 20% Low, under 45% Medium, above that High — high fragility means the risk estimate is sensitive to which window of history you look at."],
      ],
    },
    {
      title: "Portfolio optimizer",
      items: [
        ["Minimum-variance", "The weight vector that minimises portfolio variance, solved in closed form from the inverted covariance matrix."],
        ["Max-Sharpe (tangency)", "The weight vector proportional to Σ⁻¹(expected return − risk-free rate), maximising return per unit of risk."],
        ["Unconstrained vs long-only", "The raw solution can suggest negative weights (a short); \"apply\" clips those to zero and renormalises to 100%."],
      ],
    },
  ];
  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "50px 40px 80px" }}>
      <div className="ay-disp" style={{ fontSize: 30, marginBottom: 6 }}>Glossary</div>
      <p className="ay-sans" style={{ fontSize: 13, color: "#5C6B62", marginBottom: 30 }}>Every category, score and threshold used anywhere on this site, and exactly how it's calculated.</p>
      {groups.map((g, gi) => (
        <div key={gi} style={{ marginBottom: 26 }}>
          <div className="ay-disp" style={{ fontSize: 17, marginBottom: 10, color: "#1F6F5C" }}>{g.title}</div>
          {g.items.map(([t, b], i) => (
            <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid rgba(20,32,27,0.1)" }}>
              <div style={{ fontFamily: "Source Serif 4, serif", fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{t}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "#3A423D" }}>{b}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* =========================== MODEL VALIDATION ============================= */

const EXAMPLE_SET = ["NVDA", "MSFT", "JPM", "AAPL", "ASML", "LVMH", "TSLA", "UNH", "TSM", "CASH"];
function computePortfolioStats(tickers, weights) {
  const rets = [];
  for (let d = 0; d < N_DAYS; d++) { let r = 0; tickers.forEach((t, i) => (r += weights[i] * RETURNS[t][d])); rets.push(r); }
  const prices = [100];
  rets.forEach((r) => prices.push(prices[prices.length - 1] * (1 + r)));
  return { vol: annVolOf(rets), ret: annRetOf(rets), sharpe: (annRetOf(rets) - RF) / annVolOf(rets), mdd: maxDrawdownOf(prices), rets };
}

function useValidationData() {
  return useMemo(() => {
    const n = EXAMPLE_SET.length;
    const eqW = Array(n).fill(1 / n);
    const eq = computePortfolioStats(EXAMPLE_SET, eqW);

    const covMat = EXAMPLE_SET.map((a) => EXAMPLE_SET.map((b) => covariance(RETURNS[a], RETURNS[b]) * 252));
    const inv = invertMatrix(covMat);
    let minVarStats = null, tanStats = null;
    if (inv) {
      const ones = Array(n).fill(1);
      const rawMV = matVec(inv, ones);
      const sumMV = rawMV.reduce((s, x) => s + x, 0);
      const minVar = rawMV.map((x) => x / sumMV);
      minVarStats = computePortfolioStats(EXAMPLE_SET, minVar);
      const excess = EXAMPLE_SET.map((t) => annRetOf(RETURNS[t]) - RF);
      const rawTan = matVec(inv, excess);
      const sumTan = rawTan.reduce((s, x) => s + x, 0);
      if (sumTan !== 0) { const tangency = rawTan.map((x) => x / sumTan); tanStats = computePortfolioStats(EXAMPLE_SET, tangency); }
    }

    const rng = mulberry32(hashStr("VALIDATION_BOOTSTRAP"));
    const N_BOOT = 1000;
    const varSamples = [];
    for (let b = 0; b < N_BOOT; b++) {
      const sample = [];
      for (let i = 0; i < eq.rets.length; i++) sample.push(eq.rets[Math.floor(rng() * eq.rets.length)]);
      const sorted = [...sample].sort((a, b2) => a - b2);
      varSamples.push(Math.abs(quantile(sorted, 0.05)));
    }
    varSamples.sort((a, b) => a - b);
    const varMedian = quantile(varSamples, 0.5), varP5 = quantile(varSamples, 0.05), varP95 = quantile(varSamples, 0.95);
    const minV = varSamples[0], maxV = varSamples[varSamples.length - 1];
    const nBins = 16, binW = (maxV - minV) / nBins || 0.001;
    const bins = Array.from({ length: nBins }, (_, i) => ({ lo: minV + i * binW, hi: minV + (i + 1) * binW, count: 0 }));
    varSamples.forEach((v) => { const i = Math.min(nBins - 1, Math.floor((v - minV) / binW)); bins[i].count++; });
    const histData = bins.map((b) => ({ bin: (((b.lo + b.hi) / 2) * 100).toFixed(1) + "%", count: b.count }));

    return { eq, minVarStats, tanStats, varMedian, varP5, varP95, histData };
  }, []);
}

function ModelValidation({ setView }) {
  const d = useValidationData();
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "50px 40px 80px" }}>
      <div className="ay-mono" style={{ fontSize: 11, color: "#1F6F5C", marginBottom: 8 }}>WORKING NOTE · v1.0 · KurtoRisk Research</div>
      <div className="ay-disp" style={{ fontSize: 30, marginBottom: 6 }}>Model Validation</div>
      <p className="ay-sans" style={{ fontSize: 13.5, color: "#5C6B62", marginBottom: 26, maxWidth: 640 }}>
        Bootstrap validation of the risk engine and a real, computed comparison of the portfolio optimizer against a naive
        equal-weight baseline, on the example holding set ({EXAMPLE_SET.join(", ")}). Every figure below is computed live
        by the same engine as the terminal — nothing here is a backtested trading record.
      </p>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 34 }}>
        {[
          ["Bootstrap VaR95 (median)", fmtPct(d.varMedian)],
          ["[P5, P95] interval", `${fmtPct(d.varP5)} – ${fmtPct(d.varP95)}`],
          ["Min-var vs equal-weight", d.minVarStats ? fmtPct(d.eq.vol - d.minVarStats.vol) + " less vol" : "n/a"],
          ["Bootstrap resamples", "1,000"],
        ].map(([l, v], i) => (
          <div key={i} style={{ border: "1px solid rgba(20,32,27,0.15)", padding: "14px 18px", minWidth: 150 }}>
            <div className="ay-sans" style={{ fontSize: 10, color: "#8A9690" }}>{l}</div>
            <div className="ay-mono" style={{ fontSize: 19, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: "18px 0", borderBottom: "1px solid rgba(20,32,27,0.12)" }}>
        <div className="ay-disp" style={{ fontSize: 18, marginBottom: 8 }}>01 · Executive summary</div>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "#3A423D" }}>
          On this holding set, the closed-form minimum-variance portfolio realises {fmtPct(d.minVarStats ? d.minVarStats.vol : 0)} annualised
          volatility versus {fmtPct(d.eq.vol)} for naive equal weighting — a real, computed reduction, not an assumption. The
          bootstrap distribution of historical VaR95 (1,000 resamples with replacement from the 252-day window) has a median
          of {fmtPct(d.varMedian)} and a 5-95% interval of [{fmtPct(d.varP5)}, {fmtPct(d.varP95)}], giving a sense of how much a single-window
          VaR estimate could plausibly have differed.
        </p>
      </div>

      <div style={{ padding: "18px 0", borderBottom: "1px solid rgba(20,32,27,0.12)" }}>
        <div className="ay-disp" style={{ fontSize: 18, marginBottom: 8 }}>02 · Method comparison</div>
        <p className="ay-sans" style={{ fontSize: 12.5, color: "#5C6B62", marginBottom: 12 }}>Same 10 holdings, three weighting schemes, computed over the same 252-day window.</p>
        <table className="ay-t ay-mono">
          <thead><tr><th className="ay-sans">Scheme</th><th>Vol</th><th>Return</th><th>Sharpe</th><th>Max DD</th></tr></thead>
          <tbody>
            <tr><td style={{ fontFamily: "Source Serif 4, serif" }}>Equal weight</td><td>{fmtPct(d.eq.vol)}</td><td>{fmtPct(d.eq.ret)}</td><td>{d.eq.sharpe.toFixed(2)}</td><td>{fmtPct(d.eq.mdd)}</td></tr>
            {d.minVarStats && <tr><td style={{ fontFamily: "Source Serif 4, serif" }}>Min-variance</td><td>{fmtPct(d.minVarStats.vol)}</td><td>{fmtPct(d.minVarStats.ret)}</td><td>{d.minVarStats.sharpe.toFixed(2)}</td><td>{fmtPct(d.minVarStats.mdd)}</td></tr>}
            {d.tanStats && <tr><td style={{ fontFamily: "Source Serif 4, serif" }}>Max-Sharpe</td><td>{fmtPct(d.tanStats.vol)}</td><td>{fmtPct(d.tanStats.ret)}</td><td>{d.tanStats.sharpe.toFixed(2)}</td><td>{fmtPct(d.tanStats.mdd)}</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ padding: "18px 0", borderBottom: "1px solid rgba(20,32,27,0.12)" }}>
        <div className="ay-disp" style={{ fontSize: 18, marginBottom: 8 }}>03 · Bootstrap distribution of VaR95</div>
        <p className="ay-sans" style={{ fontSize: 12.5, color: "#5C6B62", marginBottom: 12 }}>1,000 resamples with replacement from the equal-weight portfolio's 252 daily returns.</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={d.histData} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#D9D2C4" vertical={false} />
            <XAxis dataKey="bin" tick={{ fontSize: 9, fill: "#5C6B62" }} axisLine={{ stroke: "#D9D2C4" }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 11, border: "1px solid #D9D2C4", background: "#FFFFFF" }} />
            <Bar dataKey="count" fill="#1F6F5C" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ padding: "18px 0" }}>
        <div className="ay-disp" style={{ fontSize: 18, marginBottom: 8 }}>04 · Limitations</div>
        <ul style={{ fontSize: 13.5, lineHeight: 1.8, color: "#3A423D", paddingLeft: 20, margin: 0 }}>
          <li>Underlying prices are simulated (market + sector factor + idiosyncratic noise), not real historical data.</li>
          <li>252 sessions is a short window; the bootstrap resamples the same window rather than drawing from independent history.</li>
          <li>The optimizer is a closed-form Markowitz solution — it has no transaction costs, no turnover constraint, and assumes the covariance matrix is stable going forward, which real markets rarely guarantee.</li>
          <li>Nothing here is a live or backtested trading record. It validates internal consistency of the engine, not real-world performance.</li>
        </ul>
      </div>

      <p className="ay-sans" style={{ fontSize: 11, color: "#8A9690", marginTop: 24, lineHeight: 1.6 }}>
        This document presents engine-validation results, not a live trading record. KurtoRisk does not provide investment advice.
      </p>
      <button className="ay-btn solid" type="button" style={{ marginTop: 16 }} onClick={() => setView("terminal")}>OPEN THE TERMINAL →</button>
    </div>
  );
}

/* =============================== TERMINAL ================================ */

function LiveTickerDark() {
  const [live, setLive] = useState(() => Object.fromEntries(STOCK_UNIVERSE.map((s) => [s.t, { p: PRICES[s.t][PRICES[s.t].length - 1], dir: 0 }])));
  useEffect(() => {
    const id = setInterval(() => {
      setLive((prev) => {
        const next = {};
        STOCK_UNIVERSE.forEach((s) => {
          const cur = prev[s.t].p;
          const j = (Math.random() - 0.5) * cur * 0.006;
          next[s.t] = { p: Math.max(0.5, cur + j), dir: j >= 0 ? 1 : -1 };
        });
        return next;
      });
    }, 1300);
    return () => clearInterval(id);
  }, []);
  const row = [...STOCK_UNIVERSE, ...STOCK_UNIVERSE];
  return (
    <div className="qt-tickerwrap">
      <div className="qt-tickertrack">
        {row.map((s, i) => {
          const d = live[s.t];
          return (
            <span key={i} className="qt-tick">
              <b>{s.t}</b>
              <span className="qt-tickp" style={{ color: d.dir >= 0 ? "#6FCB9F" : "#E38A7D" }}>{d.p.toFixed(2)}</span>
              <span style={{ color: d.dir >= 0 ? "#6FCB9F" : "#E38A7D" }}>{d.dir >= 0 ? "▲" : "▼"}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function CompareTab({ portfolios, currentSelected, currentWeights }) {
  const candidates = [
    { id: "__current", name: "Current selection", tickers: currentSelected, weightsArr: weightsObjToArray(currentSelected, currentWeights) },
    ...portfolios.map((p) => ({ id: p.id, name: p.name, tickers: p.tickers, weightsArr: weightsObjToArray(p.tickers, p.weights) })),
  ].filter((c) => c.tickers && c.tickers.length);

  const [picked, setPicked] = useState(() => candidates.slice(0, Math.min(2, candidates.length)).map((c) => c.id));

  function toggle(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 3 ? [...prev, id] : prev));
  }

  const chosen = candidates.filter((c) => picked.includes(c.id));
  const stats = chosen.map((c) => ({ ...c, s: computePortfolioStats(c.tickers, c.weightsArr) }));
  const colors = ["#1F6F5C", "#9C6B24", "#A6321B"];

  const chartData = Array.from({ length: N_DAYS + 1 }, (_, d) => ({ d }));
  stats.forEach((s, i) => {
    let val = 100;
    chartData[0]["p" + i] = 100;
    s.s.rets.forEach((r, d) => { val *= 1 + r; chartData[d + 1]["p" + i] = val; });
  });

  return (
    <div className="qt-section">
      <div className="qt-h">COMPARE PORTFOLIOS</div>
      <div className="qt-dek">Pick up to 3 — includes your current selection and anything you've saved</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {candidates.map((c) => {
          const pickedIdx = picked.indexOf(c.id);
          return (
            <span key={c.id} className={`qt-chip ${pickedIdx >= 0 ? "on" : ""}`} onClick={() => toggle(c.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {pickedIdx >= 0 && <span style={{ width: 7, height: 7, borderRadius: "50%", background: colors[pickedIdx % 3], display: "inline-block" }} />}
              {c.name}
            </span>
          );
        })}
        {!candidates.length && <span className="qt-dek">Save a portfolio (or select holdings) to compare.</span>}
      </div>

      {stats.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#D9D2C4" vertical={false} />
              <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={{ stroke: "#D9D2C4" }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 11, border: "1px solid #D9D2C4", background: "#FFFFFF" }} />
              {stats.map((s, i) => <Line key={i} type="monotone" dataKey={"p" + i} name={s.name} stroke={colors[i % 3]} strokeWidth={1.7} dot={false} />)}
            </LineChart>
          </ResponsiveContainer>
          <table className="qt-t" style={{ marginTop: 16 }}>
            <thead><tr><th>Portfolio</th><th>Vol</th><th>Return</th><th>Sharpe</th><th>Max DD</th><th>Holdings</th></tr></thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600, color: colors[i % 3] }}>{s.name}</td>
                  <td>{fmtPct(s.s.vol)}</td><td>{fmtPct(s.s.ret)}</td><td>{s.s.sharpe.toFixed(2)}</td><td>{fmtPct(s.s.mdd)}</td>
                  <td style={{ fontSize: 11 }}>{s.tickers.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Dashboard({ onBack, portfolios, savePortfolio, deletePortfolio, jumpTo }) {
  const [selected, setSelected] = useState([]);
  const [weights, setWeights] = useState({});
  const [tab, setTab] = useState("overview");
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [showSaveBox, setShowSaveBox] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [portName, setPortName] = useState("");
  const [lastJump, setLastJump] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("last-session", false);
        if (res && res.value) {
          const d = JSON.parse(res.value);
          if (d.selected && d.selected.length) { setSelected(d.selected); setWeights(d.weights || {}); }
        }
      } catch (e) { /* nothing saved yet */ }
      setSessionLoaded(true);
    })();
  }, []);
  useEffect(() => {
    if (!sessionLoaded) return;
    window.storage.set("last-session", JSON.stringify({ selected, weights }), false).catch(() => {});
  }, [selected, weights, sessionLoaded]);

  useEffect(() => {
    if (jumpTo && jumpTo.ts !== lastJump) {
      setLastJump(jumpTo.ts);
      if (!selected.includes(jumpTo.t)) {
        const next = [...selected, jumpTo.t];
        setSelected(next);
        setWeights(equalize(next));
      }
      setDetail(jumpTo.t);
      setTab("positions");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo]);

  function equalize(list) { const w = {}; list.forEach((t) => (w[t] = list.length ? +(100 / list.length).toFixed(2) : 0)); return w; }
  function toggle(ticker) {
    let next;
    if (selected.includes(ticker)) { next = selected.filter((x) => x !== ticker); if (detail === ticker) setDetail(null); }
    else next = [...selected, ticker];
    setSelected(next);
    setWeights(equalize(next));
  }
  function loadExample() {
    const ex = ["NVDA", "MSFT", "JPM", "AAPL", "ASML", "LVMH", "TSLA", "UNH", "TSM", "CASH"];
    setSelected(ex); setWeights(equalize(ex));
  }
  function setWeight(t, v) { setWeights((prev) => ({ ...prev, [t]: v })); }
  function normalize() {
    const sum = selected.reduce((s, t) => s + (Number(weights[t]) || 0), 0);
    if (!sum) return;
    const w = {};
    selected.forEach((t) => (w[t] = +((Number(weights[t]) || 0) * 100 / sum).toFixed(2)));
    setWeights(w);
  }
  function applyWeights(map) { setWeights(map); }
  function handleSavePortfolio() {
    if (!portName.trim() || !selected.length) return;
    savePortfolio(portName.trim(), selected, weights);
    setPortName(""); setShowSaveBox(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2200);
  }
  function loadPortfolio(p) { setSelected(p.tickers); setWeights(p.weights); }

  const filtered = STOCK_UNIVERSE.filter((s) =>
    s.t.toLowerCase().includes(search.toLowerCase()) || s.name.toLowerCase().includes(search.toLowerCase()) || s.sector.toLowerCase().includes(search.toLowerCase())
  );

  const port = useMemo(() => {
    if (!selected.length) return null;
    const wArr = selected.map((t) => (Number(weights[t]) || 0) / 100);
    const wSum = wArr.reduce((a, b) => a + b, 0) || 1;
    const wNorm = wArr.map((w) => w / wSum);

    const portRets = [];
    for (let d = 0; d < N_DAYS; d++) { let r = 0; selected.forEach((t, i) => (r += wNorm[i] * RETURNS[t][d])); portRets.push(r); }
    const portPrices = [100];
    portRets.forEach((r) => portPrices.push(portPrices[portPrices.length - 1] * (1 + r)));

    const annVol = annVolOf(portRets);
    const annRet = annRetOf(portRets);
    const mdd = maxDrawdownOf(portPrices);
    const sorted = [...portRets].sort((a, b) => a - b);
    const var95 = quantile(sorted, 0.05);
    const tailSet = sorted.filter((r) => r <= var95);
    const cvar95 = tailSet.length ? mean(tailSet) : var95;
    const sharpe = (annRet - RF) / annVol;
    const downside = portRets.filter((r) => r < 0);
    const downsideDev = downside.length ? std(downside) * Math.sqrt(252) : 0.0001;
    const sortino = (annRet - RF) / downsideDev;
    const calmar = mdd !== 0 ? annRet / Math.abs(mdd) : 0;
    const beta = selected.reduce((s, t, i) => s + wNorm[i] * STOCK_UNIVERSE.find((u) => u.t === t).beta, 0);

    const skew = skewnessOf(portRets);
    const kurt = kurtosisExcessOf(portRets);
    const cfVar = cornishFisherVaR(portRets);
    const omega = omegaRatio(portRets, 0);
    const dd = drawdownSeries(portPrices);
    const ulcer = ulcerIndex(dd);
    const ewmaVolFwd = ewmaVol(portRets);
    const treynor = beta !== 0 ? (annRet - RF) / beta : NaN;
    const dBeta = downsideBeta(portRets, marketRet);

    const hhi = wNorm.reduce((s, w) => s + w * w, 0);
    const concScore = scoreClip((hhi - 1 / selected.length) / (1 - 1 / Math.max(selected.length, 2)) * 100 || (selected.length === 1 ? 100 : 0));
    const volScore = scoreClip((annVol / 0.45) * 100);
    const ddScore = scoreClip((Math.abs(mdd) / 0.35) * 100);
    const tailScore = scoreClip((Math.abs(var95) / 0.06) * 100);
    const riskScore = Math.round(0.35 * volScore + 0.25 * ddScore + 0.2 * concScore + 0.2 * tailScore);

    const corr = {};
    selected.forEach((a) => { corr[a] = {}; selected.forEach((b) => { corr[a][b] = a === b ? 1 : pearson(RETURNS[a], RETURNS[b]); }); });
    const avgCorr = {};
    selected.forEach((a) => { const others = selected.filter((b) => b !== a); avgCorr[a] = others.length ? mean(others.map((b) => corr[a][b])) : 0; });

    const rows = selected.map((t, i) => {
      const info = STOCK_UNIVERSE.find((u) => u.t === t);
      const rets = RETURNS[t];
      const v = annVolOf(rets);
      const ownSorted = [...rets].sort((a, b) => a - b);
      const ownVar = quantile(ownSorted, 0.05);
      const s = scoreClip(0.5 * (v / 0.45) * 100 + 0.3 * (Math.abs(maxDrawdownOf(PRICES[t])) / 0.35) * 100 + 0.2 * (Math.abs(ownVar) / 0.06) * 100);
      return { t, name: info.name, sector: info.sector, weight: wNorm[i] * 100, vol: v, ret: annRetOf(rets), beta: info.beta, corr: avgCorr[t], varContribPct: wNorm[i] * Math.abs(ownVar) * 100, score: Math.round(s) };
    });
    const totalVarContrib = rows.reduce((s, r) => s + r.varContribPct, 0) || 1;
    rows.forEach((r) => (r.varShare = (r.varContribPct / totalVarContrib) * 100));

    const secAlloc = {};
    rows.forEach((r) => (secAlloc[r.sector] = (secAlloc[r.sector] || 0) + r.weight));

    const stress = STRESS_SCENARIOS.map((sc) => {
      const impact = selected.reduce((s, t, i) => { const info = STOCK_UNIVERSE.find((u) => u.t === t); return s + wNorm[i] * sc.impact(info); }, 0);
      return { name: sc.name, impact };
    });

    const benchAnnRet = annRetOf(marketRet);
    const alpha = (annRet - RF) - beta * (benchAnnRet - RF);
    const trackDiff = portRets.map((r, i) => r - marketRet[i]);
    const trackingError = std(trackDiff) * Math.sqrt(252);
    const infoRatio = trackingError ? (annRet - benchAnnRet) / trackingError : 0;

    const n = selected.length;
    const covMat = selected.map((a) => selected.map((b) => covariance(RETURNS[a], RETURNS[b]) * 252));
    const inv = invertMatrix(covMat);
    let minVar = null, tangency = null;
    if (inv) {
      const ones = Array(n).fill(1);
      const rawMV = matVec(inv, ones);
      const sumMV = rawMV.reduce((s, x) => s + x, 0);
      minVar = rawMV.map((x) => x / sumMV);
      const excess = selected.map((t) => annRetOf(RETURNS[t]) - RF);
      const rawTan = matVec(inv, excess);
      const sumTan = rawTan.reduce((s, x) => s + x, 0);
      tangency = sumTan !== 0 ? rawTan.map((x) => x / sumTan) : null;
    }
    function statsFor(wgts) {
      const rets = [];
      for (let d = 0; d < N_DAYS; d++) { let r = 0; selected.forEach((t, i) => (r += wgts[i] * RETURNS[t][d])); rets.push(r); }
      return { vol: annVolOf(rets), ret: annRetOf(rets), sharpe: (annRetOf(rets) - RF) / annVolOf(rets) };
    }
    const optimizer = inv ? {
      minVar: { weights: minVar, stats: statsFor(minVar) },
      tangency: tangency ? { weights: tangency, stats: statsFor(tangency) } : null,
      current: { weights: wNorm, stats: { vol: annVol, ret: annRet, sharpe } },
    } : null;

    const MC_PATHS = 300, MC_DAYS = 60;
    const mcRng = mulberry32(hashStr(selected.join(",") + "_MC"));
    const paths = [];
    for (let p = 0; p < MC_PATHS; p++) {
      let val = 100;
      const path = [val];
      for (let d = 0; d < MC_DAYS; d++) {
        const idx = Math.floor(mcRng() * portRets.length);
        val *= 1 + portRets[idx];
        path.push(val);
      }
      paths.push(path);
    }
    const fan = [];
    for (let d = 0; d <= MC_DAYS; d++) {
      const vals = paths.map((p) => p[d]).sort((a, b) => a - b);
      fan.push({ d, p05: quantile(vals, 0.05), p25: quantile(vals, 0.25), p50: quantile(vals, 0.5), p75: quantile(vals, 0.75), p95: quantile(vals, 0.95) });
    }
    const finalVals = paths.map((p) => p[MC_DAYS]);
    const probLoss10 = finalVals.filter((v) => v < 90).length / MC_PATHS;
    const probGain = finalVals.filter((v) => v > 100).length / MC_PATHS;

    const quarterLen = Math.floor(portRets.length / 4);
    const quarterVars = [0, 1, 2, 3].map((q) => {
      const chunk = portRets.slice(q * quarterLen, (q + 1) * quarterLen);
      const s = [...chunk].sort((a, b) => a - b);
      return Math.abs(quantile(s, 0.05));
    });
    const qMean = mean(quarterVars);
    const fragilityCV = qMean ? std(quarterVars) / qMean : 0;
    const fragility = fragilityCV < 0.20 ? "Low" : fragilityCV < 0.45 ? "Medium" : "High";

    const alerts = [];
    const sortedByVar = [...rows].sort((a, b) => b.varShare - a.varShare);
    if (sortedByVar[0] && sortedByVar[0].varShare > 35) alerts.push({ sev: "high", text: `${sortedByVar[0].t} alone accounts for ${sortedByVar[0].varShare.toFixed(0)}% of total portfolio VaR.` });
    let maxPairCorr = -1, pairA = null, pairB = null;
    selected.forEach((a) => selected.forEach((b) => { if (a < b && corr[a][b] > maxPairCorr) { maxPairCorr = corr[a][b]; pairA = a; pairB = b; } }));
    if (maxPairCorr > 0.6) alerts.push({ sev: "medium", text: `${pairA} and ${pairB} are highly correlated (${maxPairCorr.toFixed(2)}) — limited diversification between them.` });
    if (beta > 1.3) alerts.push({ sev: "medium", text: `Portfolio beta of ${beta.toFixed(2)} means moves are amplified relative to the broad market.` });
    if (skew < -0.3) alerts.push({ sev: "medium", text: `Negative skew (${skew.toFixed(2)}) — large losses are more likely than large gains of the same size.` });
    if (kurt > 1) alerts.push({ sev: "low", text: `Excess kurtosis of ${kurt.toFixed(2)} points to fatter tails than a normal distribution — historical VaR may understate true risk.` });
    if (annVol > 0.30) alerts.push({ sev: "high", text: `Annualised volatility of ${fmtPct(annVol)} is high relative to a typical diversified equity portfolio (~15-18%).` });
    if (!alerts.length) alerts.push({ sev: "low", text: "No major risk flags at current settings — metrics sit within typical ranges." });

    const rollVol = rollingVolSeries(portRets, 20);
    const histBins = [
      { bin: "< -4%", lo: -Infinity, hi: -0.04 }, { bin: "-4/-3", lo: -0.04, hi: -0.03 }, { bin: "-3/-2", lo: -0.03, hi: -0.02 },
      { bin: "-2/-1", lo: -0.02, hi: -0.01 }, { bin: "-1/0", lo: -0.01, hi: 0 }, { bin: "0/1", lo: 0, hi: 0.01 },
      { bin: "1/2", lo: 0.01, hi: 0.02 }, { bin: "2/3", lo: 0.02, hi: 0.03 }, { bin: "3/4", lo: 0.03, hi: 0.04 }, { bin: "> 4%", lo: 0.04, hi: Infinity },
    ].map((b) => ({ bin: b.bin, count: portRets.filter((r) => r >= b.lo && r < b.hi).length, isVar: b.hi <= var95 + 0.005 && b.lo < 0 }));

    return {
      annVol, annRet, mdd, var95, cvar95, sharpe, sortino, calmar, beta, riskScore,
      skew, kurt, cfVar, omega, ulcer, ewmaVolFwd, treynor, dBeta,
      rows, corr, secAlloc, stress, alerts, alpha, trackingError, infoRatio, optimizer,
      fan, probLoss10, probGain, fragility, fragilityCV,
      chart: portRets.map((r, i) => ({ i, w: i % 21 === 0 ? `D${i}` : "", vol: rollVol[i], dd: dd[i], price: portPrices[i + 1], bench: marketPrices[i + 1] })),
      hist: histBins,
    };
  }, [selected, weights]);

  const TABS = [["overview", "Overview"], ["positions", "Positions"], ["technical", "Technical"], ["correlation", "Correlation"], ["riskreturn", "Risk/Return"], ["optimizer", "Optimizer"], ["montecarlo", "Simulation"], ["compare", "Compare"], ["stress", "Stress"], ["report", "Report"]];

  return (
    <div className="qt-root">
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 30px", fontSize: 10.5, color: "var(--sub)", borderBottom: "1px solid var(--hair)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span className="qt-blink" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--pos)", display: "inline-block" }} />LIVE · ENGINE: bootstrap simulation · 252 sessions · recalculated on selection</span>
        <span>MKT PROXY {marketPrices[marketPrices.length - 1].toFixed(1)} · not investment advice</span>
      </div>
      <div style={{ padding: "20px 30px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div className="qt-disp" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.3px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={onBack}>
          <span style={{ width: 9, height: 9, background: "var(--accent)", display: "inline-block" }} />
          QUANT / RISK TERMINAL
        </div>
        <button className="qt-btn" type="button" onClick={onBack}>← back to site</button>
      </div>
      <hr className="qt-hair" />
      <LiveTickerDark />

      <div style={{ padding: "16px 30px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontSize: 11.5, color: "var(--sub)" }}>UNIVERSE — select holdings [{selected.length}]</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input className="qt-in" placeholder="search..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 180 }} />
            <button className="qt-btn" type="button" onClick={loadExample}>load example</button>
            {selected.length > 0 && !showSaveBox && <button className="qt-btn" type="button" onClick={() => setShowSaveBox(true)}>save as...</button>}
            {showSaveBox && (
              <>
                <input className="qt-in" placeholder="portfolio name" value={portName} onChange={(e) => setPortName(e.target.value)} style={{ width: 130 }} />
                <button className="qt-btn solid" type="button" onClick={handleSavePortfolio}>save</button>
                <button className="qt-btn" type="button" onClick={() => setShowSaveBox(false)}>cancel</button>
              </>
            )}
            {savedFlash && <span style={{ fontSize: 11, color: "var(--pos)" }}>saved ✓</span>}
            {portfolios && portfolios.length > 0 && (
              <button className="qt-btn" type="button" onClick={() => setShowManage((v) => !v)}>{showManage ? "hide saved" : `manage saved (${portfolios.length})`}</button>
            )}
          </div>
        </div>

        {showManage && portfolios && portfolios.length > 0 && (
          <div style={{ border: "1px solid var(--hair)", padding: "10px 12px", marginBottom: 12 }}>
            {portfolios.map((p) => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--hair)" }}>
                <span style={{ fontSize: 12.5 }}>{p.name} <span style={{ color: "var(--sub)", fontSize: 11 }}>({p.tickers.length} holdings)</span></span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="qt-btn" type="button" onClick={() => loadPortfolio(p)}>load</button>
                  <button className="qt-btn" type="button" style={{ color: "var(--neg)", borderColor: "var(--neg)" }} onClick={() => deletePortfolio(p.id)}>delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 100, overflowY: "auto" }}>
          {filtered.map((s) => <span key={s.t} className={`qt-chip ${selected.includes(s.t) ? "on" : ""}`} onClick={() => toggle(s.t)}>{s.t}</span>)}
        </div>
      </div>

      {!port && <div style={{ padding: "50px 30px", maxWidth: 640 }}><p className="qt-dek" style={{ fontSize: 13 }}>Select holdings from the universe above, or load the example set, to run the model.</p></div>}

      {port && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 30px 60px" }}>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", padding: "6px 0 20px", borderBottom: "1px solid var(--hair)" }}>
            <div style={{ minWidth: 150 }}>
              <div className="qt-disp qt-pulse" style={{ fontSize: 58, fontWeight: 700, lineHeight: 0.95, color: riskColor(port.riskScore) }}><AnimatedStat value={port.riskScore} fmt={(v) => Math.round(v)} /></div>
              <div style={{ fontSize: 11, color: "var(--sub)" }}>RISK SCORE · {riskLabel(port.riskScore).toUpperCase()}</div>
            </div>
            {(() => {
              const techScore = port.rows.reduce((s, r) => s + computeTechnicals(PRICES[r.t]).score * (r.weight / 100), 0);
              const techLabel = techScore >= 1.3 ? "STRONG BUY" : techScore >= 0.4 ? "BUY" : techScore >= -0.4 ? "NEUTRAL" : techScore >= -1.3 ? "SELL" : "STRONG SELL";
              const techColor = techScore >= 0.4 ? "var(--pos)" : techScore <= -0.4 ? "var(--neg)" : "var(--accent)";
              return (
                <div style={{ minWidth: 170, cursor: "pointer" }} onClick={() => setTab("technical")}>
                  <div className="qt-disp" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: techColor }}>{techLabel}</div>
                  <div style={{ fontSize: 11, color: "var(--sub)" }}>TECHNICAL SIGNAL · view detail →</div>
                </div>
              );
            })()}
            <div style={{ flex: 1, minWidth: 340, display: "flex", flexWrap: "wrap", rowGap: 12 }}>
              {[
                ["RET", port.annRet, (v) => fmtPct(v)], ["VOL", port.annVol, (v) => fmtPct(v)], ["EWMA VOL", port.ewmaVolFwd, (v) => fmtPct(v)], ["MAX DD", port.mdd, (v) => fmtPct(v)],
                ["VaR95", port.var95, (v) => fmtPct(v)], ["CVaR95", port.cvar95, (v) => fmtPct(v)], ["CF-VaR95", port.cfVar, (v) => fmtPct(v)], ["BETA", port.beta, (v) => v.toFixed(2)],
                ["SHARPE", port.sharpe, (v) => v.toFixed(2)], ["SORTINO", port.sortino, (v) => v.toFixed(2)], ["CALMAR", port.calmar, (v) => v.toFixed(2)],
                ["TREYNOR", isNaN(port.treynor) ? 0 : port.treynor, (v) => (isNaN(port.treynor) ? "—" : v.toFixed(2))],
                ["OMEGA", isFinite(port.omega) ? port.omega : 0, (v) => (isFinite(port.omega) ? v.toFixed(2) : "∞")],
                ["SKEW", port.skew, (v) => v.toFixed(2)], ["KURT (excess)", port.kurt, (v) => v.toFixed(2)], ["ULCER", port.ulcer / 100, (v) => fmtPct(v)],
              ].map(([l, raw, fmt], i) => (
                <div key={i} className="qt-stat" style={{ minWidth: 90 }}>
                  <div style={{ fontSize: 9.5, color: "var(--sub)" }}>{l}</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}><AnimatedStat value={raw} fmt={fmt} /></div>
                </div>
              ))}
            </div>
          </div>

          <RotatingInsights port={port} />

          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", padding: "4px 0" }}>
            {TABS.map(([k, label]) => <button key={k} type="button" className={`qt-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{label}</button>)}
          </div>

          {tab === "overview" && (
            <div key="ov">
              <div className="qt-section">
                <div className="qt-h">PORTFOLIO VS. MARKET</div>
                <div className="qt-dek">solid = portfolio · dashed = simulated benchmark, indexed to 100</div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={port.chart} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="#D9D2C4" vertical={false} />
                    <XAxis dataKey="w" tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={{ stroke: "#D9D2C4" }} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 11, border: "1px solid #D9D2C4", background: "#FFFFFF", color: "#14201B" }} />
                    <Line type="monotone" dataKey="price" stroke="#1F6F5C" strokeWidth={1.6} dot={false} />
                    <Line type="monotone" dataKey="bench" stroke="#5C6B62" strokeWidth={1.2} strokeDasharray="4 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="qt-section" style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 380px" }}>
                  <div className="qt-h">ROLLING VOLATILITY (20D)</div>
                  <ResponsiveContainer width="100%" height={170}>
                    <LineChart data={port.chart} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke="#D9D2C4" vertical={false} />
                      <XAxis dataKey="w" tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={{ stroke: "#D9D2C4" }} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={false} tickLine={false} unit="%" />
                      <Tooltip contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 11, border: "1px solid #D9D2C4", background: "#FFFFFF", color: "#14201B" }} />
                      <ReferenceLine y={port.annVol * 100} stroke="#9C6B24" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="vol" stroke="#EDEAE0" strokeWidth={1.5} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ flex: "1 1 380px" }}>
                  <div className="qt-h">DRAWDOWN</div>
                  <ResponsiveContainer width="100%" height={170}>
                    <AreaChart data={port.chart} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke="#D9D2C4" vertical={false} />
                      <XAxis dataKey="w" tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={{ stroke: "#D9D2C4" }} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={false} tickLine={false} unit="%" />
                      <Tooltip contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 11, border: "1px solid #D9D2C4", background: "#FFFFFF", color: "#14201B" }} />
                      <Area type="monotone" dataKey="dd" stroke="#A6321B" fill="#A6321B" fillOpacity={0.15} strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="qt-section">
                <div className="qt-h">RETURN DISTRIBUTION</div>
                <div className="qt-dek">252 sessions · bars beyond historical VaR95 marked</div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={port.hist} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="#D9D2C4" vertical={false} />
                    <XAxis dataKey="bin" tick={{ fontSize: 9, fill: "#5C6B62" }} axisLine={{ stroke: "#D9D2C4" }} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 11, border: "1px solid #D9D2C4", background: "#FFFFFF", color: "#14201B" }} />
                    <Bar dataKey="count">{port.hist.map((d, i) => <Cell key={i} fill={d.isVar ? "#A6321B" : "#1F6F5C"} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="qt-section" style={{ display: "flex", gap: 36, flexWrap: "wrap" }}>
                <div style={{ flex: "2 1 380px" }}>
                  <div className="qt-h">MODEL READ</div>
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: "var(--ink)" }}>
                    Score {port.riskScore}/100 ({riskLabel(port.riskScore).toLowerCase()}). Skew of {port.skew.toFixed(2)} and excess kurtosis of {port.kurt.toFixed(2)} put
                    the Cornish-Fisher-adjusted VaR95 at {fmtPct(port.cfVar)}, vs. {fmtPct(port.var95)} from plain historical VaR. EWMA-weighted volatility reads
                    {" "}{fmtPct(port.ewmaVolFwd)} against {fmtPct(port.annVol)} realised. Downside beta is {isNaN(port.dBeta) ? "n/a" : port.dBeta.toFixed(2)}.
                  </p>
                </div>
                <div style={{ flex: "1 1 260px" }} className="qt-note">
                  <div style={{ fontSize: 10.5, color: "var(--sub)", marginBottom: 8 }}>FLAGS</div>
                  {port.alerts.map((a, i) => <div key={i} style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 8, color: a.sev === "high" ? "var(--neg)" : a.sev === "medium" ? "var(--accent)" : "var(--ink)" }}>{a.text}</div>)}
                </div>
              </div>
            </div>
          )}

          {tab === "technical" && (() => {
            const techRows = port.rows.map((r) => ({ ...r, tech: computeTechnicals(PRICES[r.t]) }));
            const weighted = techRows.reduce((s, r) => s + r.tech.score * (r.weight / 100), 0);
            const compLabel = weighted >= 1.3 ? "Strong Buy" : weighted >= 0.4 ? "Buy" : weighted >= -0.4 ? "Neutral" : weighted >= -1.3 ? "Sell" : "Strong Sell";
            const compColor = weighted >= 0.4 ? "var(--pos)" : weighted <= -0.4 ? "var(--neg)" : "var(--accent)";
            return (
              <div key="tech" className="qt-section">
                <div className="qt-h">TECHNICAL ANALYSIS</div>
                <div className="qt-dek">SMA(20/50), RSI(14), MACD(12,26,9) computed on each holding's simulated price series</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 18 }}>
                  <span style={{ fontSize: 11, color: "var(--sub)" }}>PORTFOLIO SIGNAL</span>
                  <span className="qt-disp" style={{ fontSize: 22, fontWeight: 700, color: compColor }}>{compLabel}</span>
                  <span style={{ fontSize: 11, color: "var(--sub)" }}>(weight-blended composite score {weighted.toFixed(2)})</span>
                </div>
                <table className="qt-t">
                  <thead><tr><th>Ticker</th><th>Price</th><th>SMA20</th><th>SMA50</th><th>RSI14</th><th>MACD hist</th><th>MA</th><th>RSI</th><th>MACD</th><th>Signal</th></tr></thead>
                  <tbody>
                    {techRows.map((r) => (
                      <tr key={r.t}>
                        <td style={{ fontWeight: 600 }}>{r.t}</td>
                        <td>{r.tech.price.toFixed(2)}</td>
                        <td>{r.tech.sma20 != null ? r.tech.sma20.toFixed(2) : "—"}</td>
                        <td>{r.tech.sma50 != null ? r.tech.sma50.toFixed(2) : "—"}</td>
                        <td>{r.tech.rsi != null ? r.tech.rsi.toFixed(1) : "—"}</td>
                        <td style={{ color: r.tech.macdHist >= 0 ? "var(--pos)" : "var(--neg)" }}>{r.tech.macdHist.toFixed(2)}</td>
                        <td style={{ color: r.tech.maSignal === "Buy" ? "var(--pos)" : r.tech.maSignal === "Sell" ? "var(--neg)" : "var(--sub)", fontSize: 11 }}>{r.tech.maSignal}</td>
                        <td style={{ color: r.tech.rsiSignal === "Buy" ? "var(--pos)" : r.tech.rsiSignal === "Sell" ? "var(--neg)" : "var(--sub)", fontSize: 11 }}>{r.tech.rsiSignal}</td>
                        <td style={{ color: r.tech.macdSignal === "Buy" ? "var(--pos)" : r.tech.macdSignal === "Sell" ? "var(--neg)" : "var(--sub)", fontSize: 11 }}>{r.tech.macdSignal}</td>
                        <td style={{ fontWeight: 600, color: r.tech.score > 0 ? "var(--pos)" : r.tech.score < 0 ? "var(--neg)" : "var(--sub)" }}>{r.tech.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="qt-dek" style={{ marginTop: 14 }}>Purely price-based technical signals — separate from, and not a substitute for, the risk metrics elsewhere in this terminal.</p>
              </div>
            );
          })()}

          {tab === "positions" && (
            <div key="pos" className="qt-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <div className="qt-h">HOLDINGS</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="qt-btn" type="button" onClick={() => {
                    const header = "Ticker,Name,Sector,Weight%,AnnVol%,Beta,Corr,VaRshare%,Score";
                    const lines = port.rows.map((r) => [r.t, r.name, r.sector, r.weight.toFixed(2), (r.vol * 100).toFixed(2), r.beta.toFixed(2), r.corr.toFixed(2), r.varShare.toFixed(2), r.score].join(","));
                    downloadText("kurtorisk_holdings.csv", [header, ...lines].join("\n"), "text/csv");
                  }}>download CSV</button>
                  <button className="qt-btn" type="button" onClick={normalize}>normalize to 100%</button>
                </div>
              </div>
              <table className="qt-t">
                <thead><tr><th>Ticker</th><th>Name</th><th>Sector</th><th>Weight</th><th>Vol</th><th>Beta</th><th>Corr</th><th>VaR share</th><th>Score</th></tr></thead>
                <tbody>
                  {port.rows.map((r) => (
                    <tr key={r.t} style={{ cursor: "pointer" }} onClick={() => setDetail(detail === r.t ? null : r.t)}>
                      <td style={{ fontWeight: 600 }}>{r.t}</td><td>{r.name}</td>
                      <td style={{ color: "var(--sub)", fontSize: 10.5 }}>{r.sector}</td>
                      <td onClick={(e) => e.stopPropagation()}><input className="qt-wt" value={weights[r.t] ?? ""} onChange={(e) => setWeight(r.t, e.target.value)} /></td>
                      <td>{(r.vol * 100).toFixed(1)}%</td><td>{r.beta.toFixed(2)}</td><td>{r.corr.toFixed(2)}</td><td>{r.varShare.toFixed(1)}%</td>
                      <td style={{ color: riskColor(r.score), fontWeight: 600 }}>{r.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail && (() => {
                const info = STOCK_UNIVERSE.find((u) => u.t === detail);
                const rets = RETURNS[detail]; const prices = PRICES[detail];
                const chartData = prices.map((p, i) => ({ i, w: i % 21 === 0 ? `D${i}` : "", price: p }));
                return (
                  <div style={{ marginTop: 20 }}>
                    <div className="qt-h">{info.name}</div>
                    <div className="qt-dek">{info.sector} · standalone</div>
                    <ResponsiveContainer width="100%" height={130}>
                      <LineChart data={chartData} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke="#D9D2C4" vertical={false} />
                        <XAxis dataKey="w" tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={{ stroke: "#D9D2C4" }} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                        <Tooltip contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 11, border: "1px solid #D9D2C4", background: "#FFFFFF", color: "#14201B" }} />
                        <Line type="monotone" dataKey="price" stroke="#1F6F5C" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                    <div style={{ fontSize: 11.5, marginTop: 8, display: "flex", gap: 20 }}>
                      <span>vol {fmtPct(annVolOf(rets))}</span><span>max dd {fmtPct(maxDrawdownOf(prices))}</span><span>beta {info.beta.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {tab === "correlation" && (
            <div key="corr" className="qt-section">
              <div className="qt-h">CORRELATION MATRIX</div>
              <div style={{ overflowX: "auto" }}>
                <table className="qt-t" style={{ minWidth: 440 }}>
                  <thead><tr><th></th>{selected.map((t) => <th key={t} style={{ textAlign: "center" }}>{t}</th>)}</tr></thead>
                  <tbody>
                    {selected.map((a) => (
                      <tr key={a}>
                        <td style={{ fontWeight: 600 }}>{a}</td>
                        {selected.map((b) => { const v = port.corr[a][b]; const bg = v === 1 ? "#D9D2C4" : v > 0 ? `rgba(166,50,27,${Math.min(0.8, v)})` : `rgba(31,111,92,${Math.min(0.8, -v)})`; return <td key={b} style={{ textAlign: "center", background: bg }}>{v.toFixed(2)}</td>; })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="qt-h" style={{ marginTop: 26 }}>SECTOR ALLOCATION</div>
              {SECTORS_ORDER.filter((s) => port.secAlloc[s]).map((s) => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0" }}>
                  <span style={{ fontSize: 11.5, width: 130, color: "var(--sub)" }}>{s}</span>
                  <div style={{ flex: 1, background: "var(--hair)", height: 3 }}><div style={{ background: "var(--accent)", width: `${port.secAlloc[s]}%`, height: 3 }} /></div>
                  <span style={{ fontSize: 11 }}>{port.secAlloc[s].toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}

          {tab === "riskreturn" && (
            <div key="rr" className="qt-section">
              <div className="qt-h">RISK / RETURN MAP</div>
              <div className="qt-dek">bubble size = weight · diamond = blended portfolio</div>
              <ResponsiveContainer width="100%" height={330}>
                <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                  <CartesianGrid stroke="#D9D2C4" />
                  <XAxis type="number" dataKey="x" name="Volatility" unit="%" tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={{ stroke: "#D9D2C4" }} tickLine={false} />
                  <YAxis type="number" dataKey="y" name="Return" unit="%" tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={false} tickLine={false} />
                  <ZAxis type="number" dataKey="z" range={[60, 400]} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 11, border: "1px solid #D9D2C4", background: "#FFFFFF", color: "#14201B" }} formatter={(v, n) => [`${v.toFixed(1)}%`, n]} labelFormatter={() => ""} />
                  <Scatter name="Holdings" data={port.rows.map((r) => ({ x: r.vol * 100, y: r.ret * 100, z: r.weight }))} fill="#1F6F5C" />
                  <Scatter name="Portfolio" data={[{ x: port.annVol * 100, y: port.annRet * 100, z: 55 }]} fill="#9C6B24" shape="diamond" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}

          {tab === "optimizer" && (
            <div key="opt" className="qt-section">
              <div className="qt-h">MARKOWITZ OPTIMIZER</div>
              <div className="qt-dek">Closed-form solutions from the covariance matrix of your selected holdings</div>
              {!port.optimizer && <p style={{ fontSize: 12.5, color: "var(--neg)" }}>Covariance matrix is singular for this selection — add a more diverse set of holdings.</p>}
              {port.optimizer && (
                <>
                  <table className="qt-t">
                    <thead><tr><th></th><th>Vol</th><th>Return</th><th>Sharpe</th><th></th></tr></thead>
                    <tbody>
                      <tr><td style={{ fontWeight: 600 }}>Current</td><td>{fmtPct(port.optimizer.current.stats.vol)}</td><td>{fmtPct(port.optimizer.current.stats.ret)}</td><td>{port.optimizer.current.stats.sharpe.toFixed(2)}</td><td></td></tr>
                      <tr><td style={{ fontWeight: 600 }}>Min-variance</td><td>{fmtPct(port.optimizer.minVar.stats.vol)}</td><td>{fmtPct(port.optimizer.minVar.stats.ret)}</td><td>{port.optimizer.minVar.stats.sharpe.toFixed(2)}</td>
                        <td><button className="qt-btn solid" type="button" onClick={() => applyWeights(Object.fromEntries(selected.map((t, i) => [t, +(Math.max(0, port.optimizer.minVar.weights[i]) * 100).toFixed(2)])))}>apply</button></td></tr>
                      {port.optimizer.tangency && (
                        <tr><td style={{ fontWeight: 600 }}>Max-Sharpe</td><td>{fmtPct(port.optimizer.tangency.stats.vol)}</td><td>{fmtPct(port.optimizer.tangency.stats.ret)}</td><td>{port.optimizer.tangency.stats.sharpe.toFixed(2)}</td>
                          <td><button className="qt-btn solid" type="button" onClick={() => applyWeights(Object.fromEntries(selected.map((t, i) => [t, +(Math.max(0, port.optimizer.tangency.weights[i]) * 100).toFixed(2)])))}>apply</button></td></tr>
                      )}
                    </tbody>
                  </table>
                  <div className="qt-h" style={{ marginTop: 24 }}>SUGGESTED WEIGHTS (unconstrained)</div>
                  <table className="qt-t">
                    <thead><tr><th>Ticker</th><th>Current</th><th>Min-var</th>{port.optimizer.tangency && <th>Max-Sharpe</th>}</tr></thead>
                    <tbody>
                      {selected.map((t, i) => (
                        <tr key={t}><td style={{ fontWeight: 600 }}>{t}</td>
                          <td>{port.optimizer.current.weights[i] !== undefined ? (port.optimizer.current.weights[i] * 100).toFixed(1) : "—"}%</td>
                          <td>{(port.optimizer.minVar.weights[i] * 100).toFixed(1)}%</td>
                          {port.optimizer.tangency && <td>{(port.optimizer.tangency.weights[i] * 100).toFixed(1)}%</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {tab === "montecarlo" && (
            <div key="mc" className="qt-section">
              <div className="qt-h">MONTE CARLO SIMULATION</div>
              <div className="qt-dek">Where can the portfolio be in 60 days? 300 trajectories bootstrapped from your own historical return distribution.</div>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={port.fan} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#D9D2C4" vertical={false} />
                  <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={{ stroke: "#D9D2C4" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#5C6B62" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 11, border: "1px solid #D9D2C4", background: "#FFFFFF", color: "#14201B" }} />
                  <Area type="monotone" dataKey="p95" stroke="none" fill="#1F6F5C" fillOpacity={0.08} />
                  <Area type="monotone" dataKey="p75" stroke="none" fill="#1F6F5C" fillOpacity={0.18} />
                  <Area type="monotone" dataKey="p50" stroke="#14201B" fill="none" strokeWidth={1.6} />
                  <Area type="monotone" dataKey="p05" stroke="none" fill="#A6321B" fillOpacity={0.08} />
                </AreaChart>
              </ResponsiveContainer>

              <div style={{ display: "flex", gap: 14, marginTop: 20, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 160px", border: "1px solid var(--hair)", padding: "14px 16px" }}>
                  <div style={{ fontSize: 10.5, color: "var(--neg)" }}>PESSIMISTIC SCENARIO</div>
                  <div className="qt-disp" style={{ fontSize: 22, fontWeight: 700 }}>{port.fan[port.fan.length - 1].p05.toFixed(2)}</div>
                  <div style={{ fontSize: 10.5, color: "var(--sub)" }}>P5</div>
                </div>
                <div style={{ flex: "1 1 160px", border: "1px solid var(--hair)", padding: "14px 16px" }}>
                  <div style={{ fontSize: 10.5, color: "var(--ink)" }}>CENTRAL TRAJECTORY</div>
                  <div className="qt-disp" style={{ fontSize: 22, fontWeight: 700 }}>{port.fan[port.fan.length - 1].p50.toFixed(2)}</div>
                  <div style={{ fontSize: 10.5, color: "var(--sub)" }}>Median</div>
                </div>
                <div style={{ flex: "1 1 160px", border: "1px solid var(--hair)", padding: "14px 16px" }}>
                  <div style={{ fontSize: 10.5, color: "var(--pos)" }}>OPTIMISTIC SCENARIO</div>
                  <div className="qt-disp" style={{ fontSize: 22, fontWeight: 700 }}>{port.fan[port.fan.length - 1].p95.toFixed(2)}</div>
                  <div style={{ fontSize: 10.5, color: "var(--sub)" }}>P95</div>
                </div>
