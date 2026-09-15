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
