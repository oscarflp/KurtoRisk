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
