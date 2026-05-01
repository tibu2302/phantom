// ─── PHANTOM Trading Engine v12.0 — Autonomous Intelligence ───
// Bybit-only, Grid + Scalping, 5x leverage, AI-connected, zero dead code
import { RestClientV5 } from "bybit-api";
import WebSocket from "ws";
import * as db from "./db";
import { autoConvertCoinsToUSDT } from "./autoConvert";
import {
  calculateSignalScore, calculateATRPercent,
  findSupportResistance,
  type SignalScore, type MarketRegime,
} from "./smartAnalysis";
import {
  aggregateMasterSignal, getOrderBookImbalance, detectManipulation,
  updateBTCState, getCurrentSession, getIntradayMomentumBoost,
  updateDrawdownState, getDrawdownMultiplier,
  updateArbPrice, type MasterSignal,
  detectMeanReversion as detectMeanReversionMI, detectBreakout as detectBreakoutMI,
} from "./marketIntelligence";
import {
  recordTradeForTuning, getAdaptiveState, recordTradeResult as recordTradeResultOptimizer,
  generatePerformanceReport, autoTuneParameters,
} from "./autoOptimizer";
import {
  getMarketTimingSignal, analyzeVolumeProfile, detectBreakoutSignal,
  detectMeanReversion as detectMeanReversionPM, recordTradeForTiming,
} from "./profitMaximizer";
import {
  analyzeStrategyPerformance, rebalanceCapital, checkAutoReinvest,
  getXAUBoostMultiplier, calculateDynamicTrailingStop, getTrendingGridAdjustment,
} from "./capitalAllocator";
import { analyzeStalePosition } from "./profitMaximizer";
import {
  fetchFearGreedIndex, getFearGreedSignal,
  recordTradeForLearning, getLearnedWeights,
  detectAnomaly,
} from "./aiEngine";
import { updatePairPrice } from "./advancedStrategies";
import { kellyOptimalSize } from "./marketIntelligence";

// ─── Types ───
interface TickerData {
  symbol: string; lastPrice: number; bid1Price: number; ask1Price: number;
  price24hPcnt: number; highPrice24h: number; lowPrice24h: number;
  volume24h: number; turnover24h: number;
}

interface OpenBuyPosition {
  symbol: string; buyPrice: number; qty: string; tradeAmount: number;
  category: "spot" | "linear"; gridLevelPrice: number;
  highestPrice?: number; openedAt: number;
}

interface ScalpPosition {
  symbol: string; buyPrice: number; qty: string; orderId: string;
  exchange: string; category: "spot" | "linear";
  openedAt: number; highestPrice?: number;
}

interface ShortPosition {
  symbol: string; entryPrice: number; qty: string; orderId: string;
  exchange: string; category: "linear";
  openedAt: number; lowestPrice?: number; strategy: "short_scalping" | "bidirectional_grid" | "mean_reversion";
}

interface GridLevel {
  price: number; side: "Buy" | "Sell"; filled: boolean;
  orderId?: string; filledPrice?: number; qty?: string;
}

interface DCAState {
  avgPrice: number; totalQty: number; totalCost: number; entries: number;
}

interface EngineState {
  userId: number; exchange: string; client: RestClientV5;
  isRunning: boolean; simulationMode: boolean;
  gridLevels: Record<string, GridLevel[]>;
  lastPrices: Record<string, number>;
  openBuyPositions: Record<string, OpenBuyPosition[]>;
  dcaPositions: Record<string, DCAState>;
  scalpPositions: Record<string, ScalpPosition[]>;
  shortPositions: Record<string, ShortPosition[]>;
  telegramBotToken?: string; telegramChatId?: string;
  intervalId?: ReturnType<typeof setInterval>;
  scannerIntervalId?: ReturnType<typeof setInterval>;
  priceIntervalId?: ReturnType<typeof setInterval>;
  dailySummaryId?: ReturnType<typeof setInterval>;
  telegramPollingId?: ReturnType<typeof setInterval>;
  telegramPollingOffset?: number;
  autoReinvestId?: ReturnType<typeof setInterval>;
  lastDrawdownAlertDate?: string;
  pnlAlertsSentToday?: Set<string>;
}

// ─── Constants ───
const LEVERAGE = 5; // v12.0: Fixed 5x leverage for all linear positions
const MIN_PROFIT_PCT = 0.001; // 0.1% minimum net profit
const EMERGENCY_STOP_THRESHOLD = -500;
const WARNING_THRESHOLD = -300;

// ─── Bybit Linear Perpetual Lot Sizes (from official Trading Parameters) ───
const LINEAR_LOT_SIZES: Record<string, { minQty: number; stepSize: number }> = {
  BTCUSDT:  { minQty: 0.001,  stepSize: 0.001 },
  ETHUSDT:  { minQty: 0.01,   stepSize: 0.01 },
  SOLUSDT:  { minQty: 0.1,    stepSize: 0.1 },
  XAUUSDT:  { minQty: 0.01,   stepSize: 0.01 },
  XRPUSDT:  { minQty: 0.1,    stepSize: 0.1 },
  DOGEUSDT: { minQty: 1,      stepSize: 1 },
  ADAUSDT:  { minQty: 1,      stepSize: 1 },
  AVAXUSDT: { minQty: 0.01,   stepSize: 0.01 },
  LINKUSDT: { minQty: 0.01,   stepSize: 0.01 },
  ARBUSDT:  { minQty: 0.1,    stepSize: 0.1 },
  SUIUSDT:  { minQty: 0.01,   stepSize: 0.01 },
  APTUSDT:  { minQty: 0.01,   stepSize: 0.01 },
  NEARUSDT: { minQty: 0.1,    stepSize: 0.1 },
  OPUSDT:   { minQty: 0.1,    stepSize: 0.1 },
  DOTUSDT:  { minQty: 0.1,    stepSize: 0.1 },
  MATICUSDT:{ minQty: 0.1,    stepSize: 0.1 },
};

// Normalize qty to Bybit linear lot size: floor to stepSize, enforce minQty
function normalizeLinearQty(symbol: string, rawQty: number): { qty: string; valid: boolean } {
  const lot = LINEAR_LOT_SIZES[symbol];
  if (!lot) {
    // Unknown symbol: use conservative defaults (0.01 step, 2 decimals)
    const rounded = Math.floor(rawQty * 100) / 100;
    return { qty: rounded.toFixed(2), valid: rounded >= 0.01 };
  }
  const decimals = Math.max(0, -Math.floor(Math.log10(lot.stepSize)));
  const factor = Math.pow(10, decimals);
  const rounded = Math.floor(rawQty * factor) / factor;
  return { qty: rounded.toFixed(decimals), valid: rounded >= lot.minQty };
}

// Scanner coins for opportunity detection
const SCANNER_COINS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT",
  "AVAXUSDT", "ADAUSDT", "DOTUSDT", "LINKUSDT", "MATICUSDT",
  "NEARUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT", "APTUSDT",
];

// ─── State ───
const engines = new Map<number, EngineState>();
const engineCycles = new Map<number, number>();
const livePrices = new Map<string, TickerData>();
const klineCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min
const lastErrorNotif = new Map<string, number>();

// ─── Loss Cooldown System ───
const tradeResults = new Map<string, { wins: number; losses: number; lastResults: boolean[] }>();

function recordTradeResult(symbol: string, strategy: string, isWin: boolean) {
  const key = `${symbol}_${strategy}`;
  const data = tradeResults.get(key) ?? { wins: 0, losses: 0, lastResults: [] };
  if (isWin) data.wins++; else data.losses++;
  data.lastResults.push(isWin);
  if (data.lastResults.length > 20) data.lastResults.shift();
  tradeResults.set(key, data);
}

function getLossCooldownMultiplier(symbol: string, strategy: string): number {
  const key = `${symbol}_${strategy}`;
  const data = tradeResults.get(key);
  if (!data || data.lastResults.length < 3) return 1.0;
  const last5 = data.lastResults.slice(-5);
  const losses = last5.filter(r => !r).length;
  if (losses >= 4) return 0.3;
  if (losses >= 3) return 0.5;
  if (losses >= 2) return 0.7;
  return 1.0;
}

// ─── Nocturnal Mode ───
function getNocturnalMultiplier(): { confidenceReduction: number; sizeMultiplier: number } {
  const hour = new Date().getUTCHours();
  if (hour >= 2 && hour < 6) return { confidenceReduction: 0.2, sizeMultiplier: 1.3 };
  return { confidenceReduction: 0, sizeMultiplier: 1.0 };
}

// ─── Volume Filter ───
function hasAdequateVolume(symbol: string): boolean {
  const ticker = livePrices.get(symbol);
  if (!ticker) return true;
  const minVolume = symbol === "XAUUSDT" ? 500_000 : 1_000_000;
  return ticker.turnover24h >= minVolume || ticker.volume24h > 0;
}

// ─── Opportunity Alert Builder ───
function buildOpportunityAlert(symbol: string, confidence: number, direction: string, regime: string, trailing: number, sizing: number, strategy: string): string {
  return `🔔 <b>PHANTOM Oportunidad</b>\nPar: ${symbol}\nDirección: ${direction.toUpperCase()}\nConfianza: ${confidence}%\nRégimen: ${regime}\nEstrategia: ${strategy}`;
}

// ─── Fee Calculator ───
function calcNetPnl(grossPnl: number, tradeAmount: number, category: "spot" | "linear", isSell: boolean, exchange: string = "bybit", holdTimeMs: number = 0): number {
  const feeRate = category === "linear" ? 0.00055 : 0.001;
  const fee = tradeAmount * feeRate * (isSell ? 2 : 1);
  let fundingCost = 0;
  if (category === "linear" && holdTimeMs > 0) {
    const fundingPeriods = Math.floor(holdTimeMs / (8 * 60 * 60 * 1000));
    fundingCost = tradeAmount * 0.0001 * fundingPeriods;
  }
  return grossPnl - fee - fundingCost;
}

// ─── Kline Fetcher with Cache ───
async function fetchKlines(client: RestClientV5 | null, symbol: string, interval: string, limit: number, category: "spot" | "linear" = "linear"): Promise<{ opens: number[]; highs: number[]; lows: number[]; closes: number[]; volumes: number[] }> {
  const cacheKey = `${symbol}_${interval}`;
  const cached = klineCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const cl = client ?? new RestClientV5({});
  const res = await cl.getKline({ category, symbol, interval: interval as any, limit });
  const list = (res.result?.list ?? []) as any[];
  list.reverse();
  const data = {
    opens: list.map(k => parseFloat(k[1])),
    highs: list.map(k => parseFloat(k[2])),
    lows: list.map(k => parseFloat(k[3])),
    closes: list.map(k => parseFloat(k[4])),
    volumes: list.map(k => parseFloat(k[5])),
  };
  klineCache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

// ─── Ticker Fetcher ───
async function fetchTicker(client: RestClientV5, symbol: string, category: "spot" | "linear" = "linear"): Promise<TickerData | null> {
  try {
    const res = await client.getTickers({ category, symbol } as any);
    const t = (res.result?.list ?? [])[0] as any;
    if (!t) return null;
    return {
      symbol, lastPrice: parseFloat(t.lastPrice),
      bid1Price: parseFloat(t.bid1Price ?? t.lastPrice),
      ask1Price: parseFloat(t.ask1Price ?? t.lastPrice),
      price24hPcnt: parseFloat(t.price24hPcnt ?? "0"),
      highPrice24h: parseFloat(t.highPrice24h ?? t.lastPrice),
      lowPrice24h: parseFloat(t.lowPrice24h ?? t.lastPrice),
      volume24h: parseFloat(t.volume24h ?? "0"),
      turnover24h: parseFloat(t.turnover24h ?? "0"),
    };
  } catch (e) {
    console.error(`[Ticker] ${symbol} fetch error:`, (e as Error).message);
    return null;
  }
}

// ─── Retry Helper ───
export async function withRetry<T>(fn: () => Promise<T>, label: string, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e: any) {
      if (i === retries - 1) throw e;
      const delay = Math.min(1000 * Math.pow(2, i), 5000);
      console.warn(`[Retry] ${label} attempt ${i + 1} failed: ${e.message}, retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`${label} failed after ${retries} retries`);
}

// ─── Telegram Notification ───
async function sendTelegramNotification(engine: EngineState, message: string) {
  if (!engine.telegramBotToken || !engine.telegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${engine.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: engine.telegramChatId, text: message, parse_mode: "HTML" }),
    });
  } catch { /* silent */ }
}

// ─── Place Order (Bybit only) ───
async function placeOrder(engine: EngineState, symbol: string, side: "Buy" | "Sell", qty: string, category: "spot" | "linear" = "linear", options?: { reduceOnly?: boolean; isOpenShort?: boolean }): Promise<string | null> {
  // v12.0 fix: Normalize qty to Bybit lot size before sending
  if (category === "linear") {
    const normalized = normalizeLinearQty(symbol, parseFloat(qty));
    if (!normalized.valid) {
      console.warn(`[Order] ${side} ${symbol} SKIPPED: qty=${qty} → normalized=${normalized.qty} below minQty`);
      return null;
    }
    qty = normalized.qty;
  }

  if (engine.simulationMode) {
    const simId = `SIM_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[Order] SIMULATED ${side} ${symbol} qty=${qty} cat=${category} → ${simId}`);
    return simId;
  }

  try {
    const orderParams: any = {
      category, symbol, side, orderType: "Market", qty,
      timeInForce: "GTC",
    };
    // v12.0: reduceOnly logic
    // - Sell orders closing longs: reduceOnly=true (default for Sell)
    // - Sell orders opening shorts (isOpenShort=true): reduceOnly=false
    // - Buy orders closing shorts (reduceOnly explicitly passed): reduceOnly=true
    if (options?.reduceOnly === true) {
      orderParams.reduceOnly = true;
    } else if (category === "linear" && side === "Sell" && !options?.isOpenShort) {
      orderParams.reduceOnly = true;
    }
    // For opening shorts, do NOT set reduceOnly (defaults to false)
    const res = await withRetry(() => engine.client.submitOrder(orderParams), `${side} ${symbol}`);
    if (res.retCode === 0) {
      const orderId = res.result?.orderId ?? `BYBIT_${Date.now()}`;
      console.log(`[Order] ${side} ${symbol} qty=${qty} cat=${category} short=${options?.isOpenShort ?? false} → ${orderId}`);
      return orderId;
    }
    console.error(`[Order] ${side} ${symbol} failed: ${res.retMsg} (code=${res.retCode})`);
    return null;
  } catch (e) {
    console.error(`[Order] ${side} ${symbol} error:`, (e as Error).message);
    return null;
  }
}

// ─── Force Leverage ───
async function ensureLeverage(client: RestClientV5, symbol: string, leverage: number = LEVERAGE) {
  try {
    await client.setLeverage({
      category: "linear", symbol,
      buyLeverage: String(leverage), sellLeverage: String(leverage),
    });
    console.log(`[Leverage] Set ${symbol} to ${leverage}x`);
  } catch (e: any) {
    // 110043 = leverage not modified (already set) — safe to ignore
    if (!e?.message?.includes("110043") && !e?.message?.includes("not modified")) {
      console.warn(`[Leverage] ${symbol} error: ${e?.message}`);
    }
  }
}

// ─── AI Intelligence Layer ───
// v12.0: Connect Fear&Greed, Kelly Criterion, and learned weights to actual trading decisions
function getAIMultipliers(symbol: string, strategy: string, confidence: number, tradeAmount: number, balance: number): { sizeMultiplier: number; confidenceBoost: number; reasons: string[] } {
  const reasons: string[] = [];
  let sizeMultiplier = 1.0;
  let confidenceBoost = 0;

  // 1. Fear & Greed Index influence
  try {
    const fgSignal = getFearGreedSignal(null); // uses cached value
    if (fgSignal.strength > 30) {
      if (fgSignal.direction === "buy") {
        sizeMultiplier *= 1.15;
        confidenceBoost += 5;
        reasons.push(`F&G: greed → +15% size, +5 conf`);
      } else if (fgSignal.direction === "sell") {
        sizeMultiplier *= 0.8;
        confidenceBoost -= 5;
        reasons.push(`F&G: fear → -20% size, -5 conf`);
      }
    }
  } catch { /* silent */ }

  // 2. Kelly Criterion for position sizing
  try {
    const key = `${symbol}_${strategy}`;
    const data = tradeResults.get(key);
    if (data && data.lastResults.length >= 10) {
      const winRate = data.wins / (data.wins + data.losses);
      const avgWin = 0.005; // estimated 0.5% avg win
      const avgLoss = 0.003; // estimated 0.3% avg loss
      const kellyFraction = kellyOptimalSize(winRate, avgWin, avgLoss);
      const kellyMultiplier = Math.max(0.5, Math.min(2.0, kellyFraction / (tradeAmount / balance)));
      sizeMultiplier *= kellyMultiplier;
      reasons.push(`Kelly: ${kellyMultiplier.toFixed(2)}x (WR=${(winRate * 100).toFixed(0)}%)`);
    }
  } catch { /* silent */ }

  // 3. Learned weights from AI engine (hour-of-day, session patterns)
  try {
    const weights = getLearnedWeights(strategy, symbol);
    if (weights) {
      sizeMultiplier *= weights.sizeMultiplier;
      confidenceBoost += weights.confidenceBoost;
      if (weights.sizeMultiplier !== 1.0 || weights.confidenceBoost !== 0) {
        reasons.push(`AI-Learn: size=${weights.sizeMultiplier.toFixed(2)}x conf=${weights.confidenceBoost > 0 ? "+" : ""}${weights.confidenceBoost}`);
      }
    }
  } catch { /* silent */ }

  return { sizeMultiplier, confidenceBoost, reasons };
}

// ─── Calculate Real Today PnL from Trades ───
async function getRealTodayPnl(userId: number): Promise<number> {
  try {
    const allTrades = await db.getUserTrades(userId, 5000);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todaySells = allTrades.filter(t => new Date(t.createdAt) >= todayStart && t.side === "sell");
    return todaySells.reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0);
  } catch { return 0; }
}

// ─── Grid Level Generator ───
function generateGridLevels(currentPrice: number, numLevels: number, spreadPct: number): GridLevel[] {
  const levels: GridLevel[] = [];
  const step = currentPrice * spreadPct;
  const halfLevels = Math.floor(numLevels / 2);
  for (let i = -halfLevels; i <= halfLevels; i++) {
    if (i === 0) continue;
    levels.push({ price: currentPrice + step * i, side: i < 0 ? "Buy" : "Sell", filled: false });
  }
  return levels;
}

// ═══════════════════════════════════════════════════════════════
// ─── GRID STRATEGY v12.0 ───
// ═══════════════════════════════════════════════════════════════
async function runGridStrategy(engine: EngineState, symbol: string, category: "spot" | "linear" = "linear", dailyProfitMode: "normal" | "cautious" | "stopped" = "normal") {
  const ticker = await fetchTicker(engine.client, symbol, category);
  if (!ticker) return;

  const price = ticker.lastPrice;
  engine.lastPrices[symbol] = price;
  livePrices.set(symbol, ticker);

  if (!hasAdequateVolume(symbol)) {
    console.log(`[Grid] ${symbol} SKIP — insufficient volume/liquidity`);
    return;
  }

  if (dailyProfitMode === "stopped") {
    // Still allow sells to close existing positions, but skip buy logic
  }

  // ─── SMART ANALYSIS v12.0: Multi-indicator scoring + Market Regime ───
  let trendAllowsBuy = true;
  let trendLabel = "neutral";
  let smartScore: SignalScore | null = null;
  let marketRegime: MarketRegime = "ranging";
  let dynamicTrailingPct = 0.005;
  let positionSizeMultiplier = 1.0;

  try {
    const klines = await fetchKlines(engine.client, symbol, "15", 60, category);
    if (klines.closes.length >= 30) {
      smartScore = calculateSignalScore(klines, price);
      marketRegime = smartScore.regime;
      dynamicTrailingPct = smartScore.suggestedTrailingPct / 100;
      positionSizeMultiplier = smartScore.suggestedSizePct;

      // Loss cooldown
      positionSizeMultiplier *= getLossCooldownMultiplier(symbol, "grid");

      // Regime-based adjustments
      if (smartScore.regime === "strong_trend_down" && smartScore.confidence > 85) {
        trendLabel = "bearish-extreme";
        positionSizeMultiplier *= 0.5;
      } else if (smartScore.regime === "strong_trend_up") {
        trendLabel = "bullish-strong";
      } else if (smartScore.regime === "trend_up") {
        trendLabel = "bullish";
      } else if (smartScore.regime === "volatile") {
        trendLabel = "volatile";
        positionSizeMultiplier *= 0.7;
      } else if (smartScore.regime === "trend_down") {
        trendLabel = "bearish-mild";
      } else {
        trendLabel = "ranging";
        positionSizeMultiplier *= 1.1;
      }

      // Support/Resistance awareness
      const sr = findSupportResistance(klines.highs, klines.lows, klines.closes, klines.volumes, price);
      if (sr.nearestResistance && (sr.nearestResistance - price) / price < 0.003) {
        if (smartScore.direction === "buy") positionSizeMultiplier *= 0.7;
      }
      if (sr.nearestSupport && (price - sr.nearestSupport) / price < 0.003) {
        if (smartScore.direction === "buy") positionSizeMultiplier *= 1.2;
      }

      console.log(`[Grid] ${symbol} SMART: score=${smartScore.confidence} dir=${smartScore.direction} regime=${marketRegime} size=${positionSizeMultiplier.toFixed(2)}x trailing=${(dynamicTrailingPct * 100).toFixed(2)}%`);
    } else {
      // Simple EMA calculation inline (smartAnalysis doesn't export calculateEMA)
      const emaCalc = (data: number[], period: number) => {
        if (data.length < period) return data.length > 0 ? data[data.length - 1] : 0;
        const k = 2 / (period + 1);
        let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
        return ema;
      };
      const ema20 = emaCalc(klines.closes, 20);
      const ema50 = emaCalc(klines.closes, Math.min(50, klines.closes.length));
      trendLabel = ema20 < ema50 ? "bearish" : "bullish";
    }
  } catch { /* keep trendAllowsBuy = true on error */ }

  // ─── MASTER SIGNAL ───
  let masterSignal: MasterSignal | null = null;
  try {
    const klines5m = await fetchKlines(engine.client, symbol, "5", 60, category);
    const klines15m_mta = await fetchKlines(engine.client, symbol, "15", 60, category);
    const klines1h = await fetchKlines(engine.client, symbol, "60", 60, category);
    let orderBookData;
    try { orderBookData = await getOrderBookImbalance(engine.client, symbol, category); } catch { /* silent */ }
    const miState = await db.getOrCreateBotState(engine.userId);
    const miCapital = parseFloat(miState?.currentBalance ?? "5000");
    const miTodayPnl = parseFloat(miState?.todayPnl ?? "0");
    masterSignal = aggregateMasterSignal({
      symbol, currentPrice: price, klines5m, klines15m: klines15m_mta, klines1h,
      orderBookImbalance: orderBookData,
      totalCapital: miCapital, proposedAmount: miCapital * 0.05,
      todayPnl: miTodayPnl, currentBalance: miCapital, strategy: "grid",
    });
    if (masterSignal.blocked && masterSignal.confidence > 80) {
      trendLabel = `BLOCKED: ${masterSignal.blockReason}`;
      positionSizeMultiplier *= 0.3;
    } else if (masterSignal.direction === "sell" && masterSignal.confidence > 70) {
      positionSizeMultiplier *= 0.5;
    }
    positionSizeMultiplier *= masterSignal.sizingMultiplier;

    const manipulation = detectManipulation(klines15m_mta);
    if (manipulation.isFakeWick) {
      console.log(`[Grid] ${symbol} MANIPULATION: ${manipulation.reason}`);
      positionSizeMultiplier *= 0.3;
    }
    console.log(`[Grid] ${symbol} MASTER: dir=${masterSignal.direction} conf=${masterSignal.confidence} sizing=${masterSignal.sizingMultiplier.toFixed(2)}x blocked=${masterSignal.blocked}`);
  } catch (e) {
    console.warn(`[Grid] ${symbol} Master signal error: ${(e as Error).message}`);
  }

  // ─── v12.0: AI Intelligence Layer ───
  const state0 = await db.getOrCreateBotState(engine.userId);
  const balance0 = parseFloat(state0?.currentBalance ?? "5000");
  const aiMult = getAIMultipliers(symbol, "grid", smartScore?.confidence ?? 50, balance0 * 0.05, balance0);
  positionSizeMultiplier *= aiMult.sizeMultiplier;
  if (aiMult.reasons.length > 0) {
    console.log(`[Grid] ${symbol} AI: ${aiMult.reasons.join(" | ")}`);
  }

  // Read strategy config
  const strats = await db.getUserStrategies(engine.userId);
  const strat = strats.find(s => s.symbol === symbol);
  const config = strat?.config as any;
  let gridLevels = config?.gridLevels ?? 10;
  const baseGridSpread = config?.gridSpreadPct ? config.gridSpreadPct / 100 : 0.005;

  // ─── Dynamic Grid: ATR-based spread + regime adjustment ───
  let effectiveSpread = baseGridSpread;
  try {
    const klines = await fetchKlines(engine.client, symbol, "15", 30, category);
    if (klines.closes.length >= 10 && klines.highs.length >= 10) {
      const atrPct = calculateATRPercent(klines.highs, klines.lows, klines.closes);
      const volMultiplier = Math.max(1, Math.min(2.5, atrPct / 0.5));
      effectiveSpread = baseGridSpread * volMultiplier;
      const trendAdj = getTrendingGridAdjustment(marketRegime);
      effectiveSpread *= trendAdj.spreadMultiplier;
      gridLevels = Math.round(gridLevels * trendAdj.levelsMultiplier);
      if (marketRegime === "ranging") effectiveSpread *= 0.65;
    }
  } catch { /* use base spread */ }
  effectiveSpread = Math.max(effectiveSpread, 0.0015);

  // Initialize grid if not exists
  const isNewGrid = !engine.gridLevels[symbol] || engine.gridLevels[symbol].length === 0;
  if (isNewGrid) {
    engine.gridLevels[symbol] = generateGridLevels(price, gridLevels, effectiveSpread);
    console.log(`[Grid] ${symbol} initialized ${engine.gridLevels[symbol].length} levels around ${price} (spread=${(effectiveSpread * 100).toFixed(2)}%)`);
  }

  // Smart Regeneration
  const levels = engine.gridLevels[symbol];
  const gridPrices = levels.map(l => l.price);
  const gridCentre = (Math.max(...gridPrices) + Math.min(...gridPrices)) / 2;
  const driftPct = Math.abs(price - gridCentre) / gridCentre;
  if (driftPct > effectiveSpread * 1.5 && !isNewGrid) {
    engine.gridLevels[symbol] = generateGridLevels(price, gridLevels, effectiveSpread);
    console.log(`[Grid] ${symbol} RECENTRED grid around ${price.toFixed(2)} (drift=${(driftPct * 100).toFixed(2)}%, keeping ${(engine.openBuyPositions[symbol] ?? []).length} open positions)`);
  }

  let traded = false;
  const openPositions = engine.openBuyPositions[symbol] ?? [];

  // ─── Protection System: Trailing Stop (profit only) + Time-Profit ───
  const stratConfig = config ?? {};
  const configTrailingPct = (stratConfig.trailingStopPct ?? 0.5) / 100;
  const trailingPct = dynamicTrailingPct > 0 ? dynamicTrailingPct : configTrailingPct;
  const trailingActivation = (stratConfig.trailingActivationPct ?? 0.5) / 100;
  const maxHoldTimeMs = (stratConfig.maxHoldHours ?? 2) * 60 * 60 * 1000;
  const maxOpenPositions = stratConfig.maxOpenPositions ?? 15;
  const positionsToSell: { pos: OpenBuyPosition; reason: string }[] = [];

  for (let i = openPositions.length - 1; i >= 0; i--) {
    const pos = openPositions[i];
    const profitPct = (price - pos.buyPrice) / pos.buyPrice;
    const holdTimeMs = Date.now() - (pos.openedAt ?? Date.now());

    // NO STOP-LOSS — HOLD until profit
    if (profitPct < 0 && holdTimeMs > 3600000) {
      console.log(`[Grid] ${symbol} HOLD — ${((-profitPct) * 100).toFixed(2)}% loss, held ${(holdTimeMs / 3600000).toFixed(1)}h`);
    }

    // TIME-PROFIT
    if (maxHoldTimeMs > 0 && holdTimeMs > maxHoldTimeMs && profitPct > 0) {
      const estGrossPnl = (price - pos.buyPrice) * parseFloat(pos.qty);
      const estNetPnl = calcNetPnl(estGrossPnl, pos.tradeAmount, category, true, "bybit");
      if (estNetPnl >= pos.tradeAmount * MIN_PROFIT_PCT) {
        positionsToSell.push({ pos, reason: `TIME-PROFIT (held ${(holdTimeMs / 3600000).toFixed(1)}h, profit $${estNetPnl.toFixed(2)})` });
        openPositions.splice(i, 1);
        continue;
      }
    }

    // TRAILING STOP
    if (!pos.highestPrice || price > pos.highestPrice) pos.highestPrice = price;
    if (pos.highestPrice && pos.highestPrice > pos.buyPrice * (1 + trailingActivation)) {
      const dropFromHigh = (pos.highestPrice - price) / pos.highestPrice;
      if (dropFromHigh >= trailingPct) {
        const estGrossPnl = (price - pos.buyPrice) * parseFloat(pos.qty);
        const estNetPnl = calcNetPnl(estGrossPnl, pos.tradeAmount, category, true, "bybit");
        if (estNetPnl >= pos.tradeAmount * MIN_PROFIT_PCT) {
          positionsToSell.push({ pos, reason: `TRAILING-STOP (high=${pos.highestPrice.toFixed(2)}, drop=${(dropFromHigh * 100).toFixed(2)}%, net=$${estNetPnl.toFixed(2)})` });
          openPositions.splice(i, 1);
          continue;
        }
      }
    }
  }

  // Execute sells
  for (const { pos, reason } of positionsToSell) {
    const orderId = await placeOrder(engine, symbol, "Sell", pos.qty, category);
    if (!orderId && !engine.simulationMode) {
      const idx = engine.openBuyPositions[symbol]?.findIndex(p => p.buyPrice === pos.buyPrice && p.qty === pos.qty);
      if (idx !== undefined && idx >= 0) engine.openBuyPositions[symbol]!.splice(idx, 1);
      await db.deleteOpenPosition(engine.userId, symbol, pos.buyPrice, pos.qty, "bybit");
      continue;
    }
    if (orderId) {
      const grossPnl = (price - pos.buyPrice) * parseFloat(pos.qty);
      const pnl = calcNetPnl(grossPnl, pos.tradeAmount, category, true, "bybit");
      recordTradeResult(symbol, "grid", pnl > 0);

      await db.insertTrade({
        userId: engine.userId, symbol, side: "sell", price: price.toString(),
        qty: pos.qty, pnl: pnl.toFixed(2), strategy: "grid", orderId, simulated: engine.simulationMode,
      });

      const currentState = await db.getOrCreateBotState(engine.userId);
      if (currentState) {
        await db.updateBotState(engine.userId, {
          totalPnl: (parseFloat(currentState.totalPnl ?? "0") + pnl).toFixed(2),
          todayPnl: (parseFloat(currentState.todayPnl ?? "0") + pnl).toFixed(2),
          currentBalance: (parseFloat(currentState.currentBalance ?? "5000") + pnl).toFixed(2),
          totalTrades: (currentState.totalTrades ?? 0) + 1,
          winningTrades: (currentState.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
        });
      }
      if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
      const updatedState = await db.getOrCreateBotState(engine.userId);
      if (updatedState) {
        await db.upsertDailyPnl(engine.userId, parseFloat(updatedState.totalPnl ?? "0"), parseFloat(updatedState.currentBalance ?? "5000"), updatedState.totalTrades ?? 0);
      }
      if (pnl < 0) {
        const ddState = await db.getOrCreateBotState(engine.userId);
        const maxDrawdown = parseFloat(ddState?.maxDrawdown ?? "0");
        if (Math.abs(pnl) > maxDrawdown) await db.updateBotState(engine.userId, { maxDrawdown: Math.abs(pnl).toFixed(2) });
      }

      console.log(`[Grid] ${reason} ${symbol} @ ${price.toFixed(2)} buyPrice=${pos.buyPrice.toFixed(2)} pnl=${pnl.toFixed(2)}`);

      // AI feedback
      try {
        recordTradeForTuning("grid", pnl, (pnl / pos.tradeAmount) * 100);
        recordTradeResultOptimizer(pnl);
        recordTradeForTiming(pnl);
        recordTradeForLearning({ strategy: "grid", symbol, entryScore: smartScore?.confidence ?? 50, entryRegime: marketRegime, entrySession: getCurrentSession().session, entryFearGreed: 50, entryPatterns: smartScore?.reasons ?? [], pnlPercent: (pnl / pos.tradeAmount) * 100, holdTimeMinutes: (Date.now() - pos.openedAt) / 60000, timestamp: Date.now() });
      } catch { /* silent */ }

      if (pnl > 0) {
        await sendTelegramNotification(engine,
          `✅ <b>PHANTOM Grid Profit</b>\nPar: ${symbol}\nCompra: $${pos.buyPrice.toFixed(2)}\nVenta: $${price.toFixed(2)} (${reason.split(" ")[0]})\nGanancia: <b>$${pnl.toFixed(2)}</b>`
        );
      }
      traded = true;
    }
  }

  // Simulation initial buys
  if (isNewGrid && engine.simulationMode) {
    const allocation = strat?.allocationPct ?? 50;
    const state = await db.getOrCreateBotState(engine.userId);
    const balance = parseFloat(state?.currentBalance ?? "5000");
    const buyLevels = levels.filter(l => l.side === "Buy").sort((a, b) => b.price - a.price).slice(0, 3);
    for (const level of buyLevels) {
      const tradeAmount = (balance * allocation / 100) / (levels.length / 2);
      const qty = (tradeAmount / price).toFixed(6);
      const orderId = await placeOrder(engine, symbol, "Buy", qty, category);
      if (orderId) {
        level.filled = true; level.orderId = orderId;
        const grossPnl = (Math.random() * 0.008 - 0.002) * tradeAmount;
        const pnl = calcNetPnl(grossPnl, tradeAmount, category, false, "bybit");
        await db.insertTrade({ userId: engine.userId, symbol, side: "buy", price: level.price.toFixed(2), qty, pnl: pnl.toFixed(2), strategy: "grid", orderId, simulated: true });
        const cs = await db.getOrCreateBotState(engine.userId);
        if (cs) {
          await db.updateBotState(engine.userId, {
            totalPnl: (parseFloat(cs.totalPnl ?? "0") + pnl).toFixed(2),
            todayPnl: (parseFloat(cs.todayPnl ?? "0") + pnl).toFixed(2),
            currentBalance: (parseFloat(cs.currentBalance ?? "5000") + pnl).toFixed(2),
            totalTrades: (cs.totalTrades ?? 0) + 1,
            winningTrades: (cs.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
          });
        }
        if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
        traded = true;
      }
    }
  }

  // ─── Main Grid Loop ───
  for (const level of levels) {
    if (level.filled) continue;
    const tolerance = engine.simulationMode ? 0.0005 : 0.0002;
    const shouldFill = level.side === "Buy" ? price <= level.price * (1 + tolerance) : price >= level.price * (1 - tolerance);

    if (shouldFill) {
      if (level.side === "Buy" && dailyProfitMode === "stopped") continue;
      if (level.side === "Buy" && dailyProfitMode === "cautious" && (!smartScore || smartScore.confidence < 75 || smartScore.direction !== "buy")) continue;
      if (level.side === "Buy" && !trendAllowsBuy) continue;
      if (level.side === "Buy" && smartScore && smartScore.direction === "sell" && smartScore.confidence >= 70) continue;
      if (level.side === "Buy" && (engine.openBuyPositions[symbol]?.length ?? 0) >= maxOpenPositions) continue;

      // Profitability guard
      if (level.side === "Buy") {
        const requiredSellPrice = level.price * (1 + 0.002 + 0.001);
        if (!levels.some(l => l.side === "Sell" && !l.filled && l.price >= requiredSellPrice)) continue;
      }

      // Smart Sizing with AI
      const allocation = strat?.allocationPct ?? 50;
      const state = await db.getOrCreateBotState(engine.userId);
      const balance = parseFloat(state?.currentBalance ?? "5000");
      const baseTradeAmount = (balance * allocation / 100) / (levels.length / 2);
      const gridBoost = (smartScore?.confidence ?? 50) > 70 ? 2.0 : (smartScore?.confidence ?? 50) > 50 ? 1.5 : 1.2;
      const adaptiveSizing = getAdaptiveState();
      const tradeAmount = baseTradeAmount * positionSizeMultiplier * gridBoost * adaptiveSizing.aggressiveness;
      const qty = (tradeAmount / price).toFixed(6);

      const orderId = await placeOrder(engine, symbol, level.side, qty, category);
      if (orderId) {
        level.filled = true; level.orderId = orderId; level.filledPrice = price; level.qty = qty;
        let pnl = 0;

        if (level.side === "Buy") {
          if (!engine.openBuyPositions[symbol]) engine.openBuyPositions[symbol] = [];
          engine.openBuyPositions[symbol].push({
            symbol, buyPrice: price, qty, tradeAmount, category,
            gridLevelPrice: level.price, highestPrice: price, openedAt: Date.now(),
          });
          console.log(`[Grid] BUY ${symbol} @ ${price.toFixed(2)} qty=${qty} order=${orderId}`);
        } else {
          const openPos = engine.openBuyPositions[symbol] ?? [];
          const pairedBuy = openPos[0];
          if (pairedBuy) {
            const grossPnl = (price - pairedBuy.buyPrice) * parseFloat(qty);
            pnl = calcNetPnl(grossPnl, pairedBuy.tradeAmount, category, true, "bybit");
            if (pnl < pairedBuy.tradeAmount * MIN_PROFIT_PCT) { level.filled = false; continue; }
            openPos.shift();
          } else {
            const grossPnl = (price - level.price) * parseFloat(qty);
            pnl = calcNetPnl(grossPnl, tradeAmount, category, true, "bybit");
            if (pnl < tradeAmount * MIN_PROFIT_PCT) { level.filled = false; continue; }
          }
          if (pnl > 0) {
            await sendTelegramNotification(engine, `✅ <b>PHANTOM Grid Profit</b>\nPar: ${symbol}\nVenta: $${price.toFixed(2)}\nGanancia: <b>$${pnl.toFixed(2)}</b>`);
          }
        }

        await db.insertTrade({ userId: engine.userId, symbol, side: level.side.toLowerCase() as any, price: price.toString(), qty, pnl: pnl.toFixed(2), strategy: "grid", orderId, simulated: engine.simulationMode });
        const currentState = await db.getOrCreateBotState(engine.userId);
        if (currentState) {
          await db.updateBotState(engine.userId, {
            totalPnl: (parseFloat(currentState.totalPnl ?? "0") + pnl).toFixed(2),
            todayPnl: (parseFloat(currentState.todayPnl ?? "0") + pnl).toFixed(2),
            currentBalance: (parseFloat(currentState.currentBalance ?? "5000") + pnl).toFixed(2),
            totalTrades: (currentState.totalTrades ?? 0) + 1,
            winningTrades: (currentState.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
          });
        }
        if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
        if (level.side === "Sell" && pnl !== 0) {
          try {
            recordTradeForTuning("grid", pnl, (pnl / tradeAmount) * 100);
            recordTradeResultOptimizer(pnl);
            recordTradeForLearning({ strategy: "grid", symbol, entryScore: smartScore?.confidence ?? 50, entryRegime: marketRegime, entrySession: getCurrentSession().session, entryFearGreed: 50, entryPatterns: [], pnlPercent: (pnl / tradeAmount) * 100, holdTimeMinutes: 0, timestamp: Date.now() });
          } catch { /* silent */ }
        }
        traded = true;
      }
    }
  }

  // ─── DCA ───
  const dcaThreshold = 0.02;
  if (!engine.dcaPositions[symbol]) engine.dcaPositions[symbol] = { avgPrice: 0, totalQty: 0, totalCost: 0, entries: 0 };
  const dca = engine.dcaPositions[symbol];
  if (dca.entries > 0 && price < dca.avgPrice * (1 - dcaThreshold) && trendLabel !== "bearish") {
    const allocation = strat?.allocationPct ?? 50;
    const state = await db.getOrCreateBotState(engine.userId);
    const balance = parseFloat(state?.currentBalance ?? "5000");
    const dcaAmount = (balance * allocation / 100) * 0.05;
    const dcaQty = (dcaAmount / price).toFixed(6);
    if (dca.entries < 5) {
      const orderId = await placeOrder(engine, symbol, "Buy", dcaQty, category);
      if (orderId) {
        dca.totalCost += dcaAmount; dca.totalQty += parseFloat(dcaQty); dca.entries += 1;
        dca.avgPrice = dca.totalCost / dca.totalQty;
        await db.insertTrade({ userId: engine.userId, symbol, side: "buy", price: price.toString(), qty: dcaQty, pnl: "0.00", strategy: "grid", orderId, simulated: engine.simulationMode });
        if (!engine.openBuyPositions[symbol]) engine.openBuyPositions[symbol] = [];
        engine.openBuyPositions[symbol].push({ symbol, buyPrice: price, qty: dcaQty, tradeAmount: dcaAmount, category, gridLevelPrice: price, highestPrice: price, openedAt: Date.now() });
        console.log(`[Grid] DCA BUY ${symbol} @ ${price.toFixed(2)} entries=${dca.entries}/5`);
      }
    }
  }
  if (traded && openPositions.length > 0) {
    const lastBuy = openPositions[openPositions.length - 1];
    if (lastBuy) { dca.totalCost += lastBuy.tradeAmount; dca.totalQty += parseFloat(lastBuy.qty); dca.entries = Math.max(dca.entries, 1); dca.avgPrice = dca.totalCost / dca.totalQty; }
  }
  if (dca.entries > 0 && price > dca.avgPrice * 1.005) { dca.entries = 0; dca.totalCost = 0; dca.totalQty = 0; dca.avgPrice = 0; }

  // Regenerate grid if >60% filled
  const filledCount = levels.filter(l => l.filled).length;
  if (filledCount > levels.length * 0.6) {
    engine.gridLevels[symbol] = generateGridLevels(price, gridLevels, effectiveSpread);
    engine.openBuyPositions[symbol] = [];
    console.log(`[Grid] ${symbol} regenerated grid (>60% filled)`);
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── SCALPING STRATEGY v12.0 ───
// ═══════════════════════════════════════════════════════════════
async function runScalpingStrategy(engine: EngineState, symbol: string, category: "spot" | "linear" = "linear", dailyProfitMode: "normal" | "cautious" | "stopped" = "normal") {
  const ticker = await fetchTicker(engine.client, symbol, category);
  if (!ticker) return;

  const price = ticker.lastPrice;
  engine.lastPrices[symbol] = price;
  livePrices.set(symbol, ticker);

  if (!hasAdequateVolume(symbol)) return;

  // ─── SMART ANALYSIS ───
  let smartScore: SignalScore | null = null;
  let marketRegime: MarketRegime = "ranging";
  let positionSizeMultiplier = 1.0;

  try {
    const klines = await fetchKlines(engine.client, symbol, "5", 60, category);
    if (klines.closes.length >= 30) {
      smartScore = calculateSignalScore(klines, price);
      marketRegime = smartScore.regime;
      positionSizeMultiplier = smartScore.suggestedSizePct;
      positionSizeMultiplier *= getLossCooldownMultiplier(symbol, "scalping");

      // Regime adjustments
      if (smartScore.regime === "strong_trend_down") positionSizeMultiplier *= 0.4;
      else if (smartScore.regime === "volatile") positionSizeMultiplier *= 0.6;
      else if (smartScore.regime === "ranging") positionSizeMultiplier *= 1.2;
    }
  } catch { /* keep defaults */ }

  // ─── MASTER SIGNAL ───
  let masterSignal: MasterSignal | null = null;
  try {
    const klines5m = await fetchKlines(engine.client, symbol, "5", 60, category);
    const klines15m = await fetchKlines(engine.client, symbol, "15", 60, category);
    const klines1h = await fetchKlines(engine.client, symbol, "60", 60, category);
    let orderBookData;
    try { orderBookData = await getOrderBookImbalance(engine.client, symbol, category); } catch { /* silent */ }
    const miState = await db.getOrCreateBotState(engine.userId);
    const miCapital = parseFloat(miState?.currentBalance ?? "5000");
    masterSignal = aggregateMasterSignal({
      symbol, currentPrice: price, klines5m, klines15m, klines1h,
      orderBookImbalance: orderBookData,
      totalCapital: miCapital, proposedAmount: miCapital * 0.03,
      todayPnl: parseFloat(miState?.todayPnl ?? "0"), currentBalance: miCapital, strategy: "scalping",
    });
    if (masterSignal.blocked) positionSizeMultiplier *= 0.2;
    else if (masterSignal.direction === "sell" && masterSignal.confidence > 70) positionSizeMultiplier *= 0.4;
    positionSizeMultiplier *= masterSignal.sizingMultiplier;
  } catch { /* silent */ }

  // ─── v12.0: AI Intelligence Layer ───
  const state0 = await db.getOrCreateBotState(engine.userId);
  const balance0 = parseFloat(state0?.currentBalance ?? "5000");
  const aiMult = getAIMultipliers(symbol, "scalping", smartScore?.confidence ?? 50, balance0 * 0.03, balance0);
  positionSizeMultiplier *= aiMult.sizeMultiplier;
  if (aiMult.reasons.length > 0) {
    console.log(`[Scalp] ${symbol} AI: ${aiMult.reasons.join(" | ")}`);
  }

  // ─── ProfitMaximizer signals ───
  let breakoutSignal: any = null;
  let meanRevSignal: any = null;
  try {
    const klines5m = await fetchKlines(engine.client, symbol, "5", 60, category);
    breakoutSignal = detectBreakoutSignal(klines5m, price);
    meanRevSignal = detectMeanReversionPM(klines5m, price);
  } catch { /* silent */ }

  // ─── Nocturnal Mode ───
  const nocturnal = getNocturnalMultiplier();
  positionSizeMultiplier *= nocturnal.sizeMultiplier;

  // ─── Scalp Sell Logic ───
  const positions = engine.scalpPositions[symbol] ?? [];
  const strats = await db.getUserStrategies(engine.userId);
  const strat = strats.find(s => s.symbol === symbol && s.strategyType === "scalping");
  const config = strat?.config as any;
  const minProfitPct = (config?.minProfitPct ?? 0.2) / 100;
  const trailingPct = (config?.trailingStopPct ?? 0.3) / 100;
  const trailingActivation = (config?.trailingActivationPct ?? 0.3) / 100;
  const maxHoldMs = (config?.maxHoldMinutes ?? 30) * 60 * 1000;
  const maxPositions = symbol === "XAUUSDT" ? 10 : 6;

  for (let i = positions.length - 1; i >= 0; i--) {
    const pos = positions[i];
    const profitPct = (price - pos.buyPrice) / pos.buyPrice;
    const holdMs = Date.now() - pos.openedAt;

    // NO STOP-LOSS — HOLD until profit (philosophy: never sell at loss)
    if (profitPct < 0) {
      if (holdMs > 1800000) {
        console.log(`[Scalp] ${symbol} HOLD — ${((-profitPct) * 100).toFixed(2)}% loss, held ${(holdMs / 60000).toFixed(0)}m`);
      }
      continue;
    }

    // Dynamic trailing stop from ProfitMaximizer
    let effectiveTrailingPct = trailingPct;
    try {
      const dynTrailing = calculateDynamicTrailingStop(pos.buyPrice, price, pos.highestPrice ?? price, holdMs, marketRegime);
      effectiveTrailingPct = dynTrailing.trailingPct;
    } catch { /* use default */ }

    // TRAILING STOP
    if (!pos.highestPrice || price > pos.highestPrice) pos.highestPrice = price;
    if (pos.highestPrice > pos.buyPrice * (1 + trailingActivation)) {
      const dropFromHigh = (pos.highestPrice - price) / pos.highestPrice;
      if (dropFromHigh >= effectiveTrailingPct && profitPct >= minProfitPct) {
        const qty = pos.qty;
        const tradeAmount = pos.buyPrice * parseFloat(qty);
        const grossPnl = (price - pos.buyPrice) * parseFloat(qty);
        const pnl = calcNetPnl(grossPnl, tradeAmount, category, true, "bybit", holdMs);

        if (pnl > tradeAmount * MIN_PROFIT_PCT) {
          const orderId = await placeOrder(engine, symbol, "Sell", qty, category);
          if (orderId) {
            positions.splice(i, 1);
            recordTradeResult(symbol, "scalping", pnl > 0);

            await db.insertTrade({ userId: engine.userId, symbol, side: "sell", price: price.toString(), qty, pnl: pnl.toFixed(2), strategy: "scalping", orderId, simulated: engine.simulationMode });
            const cs = await db.getOrCreateBotState(engine.userId);
            if (cs) {
              await db.updateBotState(engine.userId, {
                totalPnl: (parseFloat(cs.totalPnl ?? "0") + pnl).toFixed(2),
                todayPnl: (parseFloat(cs.todayPnl ?? "0") + pnl).toFixed(2),
                currentBalance: (parseFloat(cs.currentBalance ?? "5000") + pnl).toFixed(2),
                totalTrades: (cs.totalTrades ?? 0) + 1,
                winningTrades: (cs.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
              });
            }
            if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
            const us = await db.getOrCreateBotState(engine.userId);
            if (us) await db.upsertDailyPnl(engine.userId, parseFloat(us.totalPnl ?? "0"), parseFloat(us.currentBalance ?? "5000"), us.totalTrades ?? 0);

            // AI feedback
            try {
              recordTradeForTuning("scalping", pnl, (pnl / tradeAmount) * 100);
              recordTradeResultOptimizer(pnl);
              recordTradeForTiming(pnl);
              recordTradeForLearning({ strategy: "scalping", symbol, entryScore: smartScore?.confidence ?? 50, entryRegime: marketRegime, entrySession: getCurrentSession().session, entryFearGreed: 50, entryPatterns: smartScore?.reasons ?? [], pnlPercent: (pnl / tradeAmount) * 100, holdTimeMinutes: holdMs / 60000, timestamp: Date.now() });
            } catch { /* silent */ }

            console.log(`[Scalp] TRAILING-SELL ${symbol} @ ${price.toFixed(2)} pnl=$${pnl.toFixed(2)}`);
            await sendTelegramNotification(engine, `⚡ <b>PHANTOM Scalp Profit</b>\nPar: ${symbol}\nCompra: $${pos.buyPrice.toFixed(2)}\nVenta: $${price.toFixed(2)}\nGanancia: <b>$${pnl.toFixed(2)}</b>`);
          }
        }
      }
    }

    // TIME-PROFIT
    if (holdMs > maxHoldMs && profitPct >= minProfitPct) {
      const qty = pos.qty;
      const tradeAmount = pos.buyPrice * parseFloat(qty);
      const grossPnl = (price - pos.buyPrice) * parseFloat(qty);
      const pnl = calcNetPnl(grossPnl, tradeAmount, category, true, "bybit", holdMs);
      if (pnl > tradeAmount * MIN_PROFIT_PCT) {
        const orderId = await placeOrder(engine, symbol, "Sell", qty, category);
        if (orderId) {
          positions.splice(i, 1);
          recordTradeResult(symbol, "scalping", pnl > 0);
          await db.insertTrade({ userId: engine.userId, symbol, side: "sell", price: price.toString(), qty, pnl: pnl.toFixed(2), strategy: "scalping", orderId, simulated: engine.simulationMode });
          const cs = await db.getOrCreateBotState(engine.userId);
          if (cs) {
            await db.updateBotState(engine.userId, {
              totalPnl: (parseFloat(cs.totalPnl ?? "0") + pnl).toFixed(2),
              todayPnl: (parseFloat(cs.todayPnl ?? "0") + pnl).toFixed(2),
              currentBalance: (parseFloat(cs.currentBalance ?? "5000") + pnl).toFixed(2),
              totalTrades: (cs.totalTrades ?? 0) + 1,
              winningTrades: (cs.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
            });
          }
          if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
          console.log(`[Scalp] TIME-PROFIT ${symbol} @ ${price.toFixed(2)} pnl=$${pnl.toFixed(2)}`);
          await sendTelegramNotification(engine, `⚡ <b>PHANTOM Scalp Profit</b>\nPar: ${symbol}\nGanancia: <b>$${pnl.toFixed(2)}</b>`);
        }
      }
    }
  }

  // ─── Scalp Buy Logic ───
  if (dailyProfitMode === "stopped") return;
  if (positions.length >= maxPositions) return;

  // Confidence gate
  const baseMinConfidence = symbol === "XAUUSDT" ? 15 : 20;
  const minConfidence = baseMinConfidence + (dailyProfitMode === "cautious" ? 15 : 0) - nocturnal.confidenceReduction * 100;
  if (!smartScore || smartScore.confidence < minConfidence) return;
  if (smartScore.direction !== "buy") return;

  // Breakout/MeanReversion boost
  let scalpBoost = 1.0;
  if (breakoutSignal?.isBreakout && breakoutSignal.direction === "up") scalpBoost = 1.3;
  if (meanRevSignal?.isMeanReversion && meanRevSignal.direction === "up") scalpBoost = 1.2;

  // XAU boost
  const xauBoost = symbol === "XAUUSDT" ? 2.5 : 1.0; // XAU always boosted

  // Market timing
  let timingMultiplier = 1.0;
  try {
    const timing = getMarketTimingSignal();
    timingMultiplier = timing.sizingMultiplier;
  } catch { /* silent */ }

  // Calculate trade amount
  const allocation = strat?.allocationPct ?? 50;
  const state = await db.getOrCreateBotState(engine.userId);
  const balance = parseFloat(state?.currentBalance ?? "5000");
  const baseAmount = (balance * allocation / 100) * 0.15;
  const tradeAmount = baseAmount * positionSizeMultiplier * scalpBoost * xauBoost * timingMultiplier;
  const qty = (tradeAmount / price).toFixed(6);

  const orderId = await placeOrder(engine, symbol, "Buy", qty, category);
  if (orderId) {
    if (!engine.scalpPositions[symbol]) engine.scalpPositions[symbol] = [];
    engine.scalpPositions[symbol].push({
      symbol, buyPrice: price, qty, orderId, exchange: "bybit",
      category, openedAt: Date.now(), highestPrice: price,
    });
    await db.insertTrade({ userId: engine.userId, symbol, side: "buy", price: price.toString(), qty, pnl: "0.00", strategy: "scalping", orderId, simulated: engine.simulationMode });
    console.log(`[Scalp] BUY ${symbol} @ ${price.toFixed(2)} qty=${qty} conf=${smartScore.confidence} regime=${marketRegime}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── SHORT SCALPING STRATEGY v12.0 ───
// Opens SHORT positions when market is in downtrend. Profits from price drops.
// ═══════════════════════════════════════════════════════════════
async function runShortScalpingStrategy(engine: EngineState, symbol: string, category: "linear" = "linear") {
  const ticker = await fetchTicker(engine.client, symbol, category);
  if (!ticker) return;

  const price = ticker.lastPrice;
  engine.lastPrices[symbol] = price;
  livePrices.set(symbol, ticker);

  if (!hasAdequateVolume(symbol)) return;

  // ─── SMART ANALYSIS ───
  let smartScore: SignalScore | null = null;
  let marketRegime: MarketRegime = "ranging";
  let positionSizeMultiplier = 1.0;

  try {
    const klines = await fetchKlines(engine.client, symbol, "5", 60, category);
    if (klines.closes.length >= 30) {
      smartScore = calculateSignalScore(klines, price);
      marketRegime = smartScore.regime;
      positionSizeMultiplier = smartScore.suggestedSizePct;
      positionSizeMultiplier *= getLossCooldownMultiplier(symbol, "short_scalping");
    }
  } catch { /* keep defaults */ }

  // ─── AI Intelligence Layer ───
  const state0 = await db.getOrCreateBotState(engine.userId);
  const balance0 = parseFloat(state0?.currentBalance ?? "5000");
  const aiMult = getAIMultipliers(symbol, "short_scalping", smartScore?.confidence ?? 50, balance0 * 0.03, balance0);
  positionSizeMultiplier *= aiMult.sizeMultiplier;

  // ─── Nocturnal Mode ───
  const nocturnal = getNocturnalMultiplier();
  positionSizeMultiplier *= nocturnal.sizeMultiplier;

  // ─── Short Sell Logic (close shorts = buy to cover) ───
  const positions = engine.shortPositions[symbol] ?? [];
  const shortPositionsForStrategy = positions.filter(p => p.strategy === "short_scalping");
  const strats = await db.getUserStrategies(engine.userId);
  const strat = strats.find(s => s.symbol === symbol && s.strategyType === "short_scalping");
  const config = strat?.config as any;
  const minProfitPct = (config?.minProfitPct ?? 0.2) / 100;
  const trailingPct = (config?.trailingStopPct ?? 0.4) / 100;
  const trailingActivation = (config?.trailingActivationPct ?? 0.3) / 100;
  const maxHoldMs = (config?.maxHoldMinutes ?? 45) * 60 * 1000;
  const maxPositions = symbol === "XAUUSDT" ? 8 : 5;

  for (let i = shortPositionsForStrategy.length - 1; i >= 0; i--) {
    const pos = shortPositionsForStrategy[i];
    // For shorts: profit when price DROPS below entry
    const profitPct = (pos.entryPrice - price) / pos.entryPrice;
    const holdMs = Date.now() - pos.openedAt;

    // NO STOP-LOSS philosophy for shorts too — hold until profit
    // But add a safety cap: if price rises 3% above entry, cut loss
    if (profitPct < -0.03) {
      const qty = pos.qty;
      const tradeAmount = pos.entryPrice * parseFloat(qty);
      const grossPnl = (pos.entryPrice - price) * parseFloat(qty); // negative
      const pnl = calcNetPnl(grossPnl, tradeAmount, "linear", true, "bybit", holdMs);
      const orderId = await placeOrder(engine, symbol, "Buy", qty, "linear", { reduceOnly: true });
      if (orderId) {
        const allShorts = engine.shortPositions[symbol] ?? [];
        const idx = allShorts.findIndex(p => p.orderId === pos.orderId);
        if (idx >= 0) allShorts.splice(idx, 1);
        recordTradeResult(symbol, "short_scalping", false);
        await db.insertTrade({ userId: engine.userId, symbol, side: "buy", price: price.toString(), qty, pnl: pnl.toFixed(2), strategy: "short_scalping", orderId, simulated: engine.simulationMode });
        const cs = await db.getOrCreateBotState(engine.userId);
        if (cs) {
          await db.updateBotState(engine.userId, {
            totalPnl: (parseFloat(cs.totalPnl ?? "0") + pnl).toFixed(2),
            todayPnl: (parseFloat(cs.todayPnl ?? "0") + pnl).toFixed(2),
            currentBalance: (parseFloat(cs.currentBalance ?? "5000") + pnl).toFixed(2),
            totalTrades: (cs.totalTrades ?? 0) + 1,
            winningTrades: (cs.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
          });
        }
        if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
        console.log(`[ShortScalp] STOP-LOSS ${symbol} @ ${price.toFixed(2)} entry=${pos.entryPrice.toFixed(2)} pnl=$${pnl.toFixed(2)}`);
        await sendTelegramNotification(engine, `🔴 <b>PHANTOM Short Stop</b>\nPar: ${symbol}\nEntrada: $${pos.entryPrice.toFixed(2)}\nSalida: $${price.toFixed(2)}\nPérdida: <b>$${pnl.toFixed(2)}</b>`);
      }
      continue;
    }

    if (profitPct < 0) continue; // underwater, hold

    // Track lowest price for trailing
    if (!pos.lowestPrice || price < pos.lowestPrice) pos.lowestPrice = price;

    // TRAILING STOP for shorts: price bounces UP from lowest
    if (pos.lowestPrice && pos.lowestPrice < pos.entryPrice * (1 - trailingActivation)) {
      const bounceFromLow = (price - pos.lowestPrice) / pos.lowestPrice;
      if (bounceFromLow >= trailingPct && profitPct >= minProfitPct) {
        const qty = pos.qty;
        const tradeAmount = pos.entryPrice * parseFloat(qty);
        const grossPnl = (pos.entryPrice - price) * parseFloat(qty);
        const pnl = calcNetPnl(grossPnl, tradeAmount, "linear", true, "bybit", holdMs);

        if (pnl > tradeAmount * MIN_PROFIT_PCT) {
          const orderId = await placeOrder(engine, symbol, "Buy", qty, "linear", { reduceOnly: true });
          if (orderId) {
            const allShorts = engine.shortPositions[symbol] ?? [];
            const idx = allShorts.findIndex(p => p.orderId === pos.orderId);
            if (idx >= 0) allShorts.splice(idx, 1);
            recordTradeResult(symbol, "short_scalping", pnl > 0);
            await db.insertTrade({ userId: engine.userId, symbol, side: "buy", price: price.toString(), qty, pnl: pnl.toFixed(2), strategy: "short_scalping", orderId, simulated: engine.simulationMode });
            const cs = await db.getOrCreateBotState(engine.userId);
            if (cs) {
              await db.updateBotState(engine.userId, {
                totalPnl: (parseFloat(cs.totalPnl ?? "0") + pnl).toFixed(2),
                todayPnl: (parseFloat(cs.todayPnl ?? "0") + pnl).toFixed(2),
                currentBalance: (parseFloat(cs.currentBalance ?? "5000") + pnl).toFixed(2),
                totalTrades: (cs.totalTrades ?? 0) + 1,
                winningTrades: (cs.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
              });
            }
            if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
            try { recordTradeForTuning("short_scalping", pnl, (pnl / tradeAmount) * 100); recordTradeResultOptimizer(pnl); } catch { /* silent */ }
            console.log(`[ShortScalp] TRAILING-COVER ${symbol} @ ${price.toFixed(2)} entry=${pos.entryPrice.toFixed(2)} pnl=$${pnl.toFixed(2)}`);
            await sendTelegramNotification(engine, `📉 <b>PHANTOM Short Profit</b>\nPar: ${symbol}\nEntrada: $${pos.entryPrice.toFixed(2)}\nCobertura: $${price.toFixed(2)}\nGanancia: <b>$${pnl.toFixed(2)}</b>`);
          }
        }
      }
    }

    // TIME-PROFIT for shorts
    if (holdMs > maxHoldMs && profitPct >= minProfitPct) {
      const qty = pos.qty;
      const tradeAmount = pos.entryPrice * parseFloat(qty);
      const grossPnl = (pos.entryPrice - price) * parseFloat(qty);
      const pnl = calcNetPnl(grossPnl, tradeAmount, "linear", true, "bybit", holdMs);
      if (pnl > tradeAmount * MIN_PROFIT_PCT) {
        const orderId = await placeOrder(engine, symbol, "Buy", qty, "linear", { reduceOnly: true });
        if (orderId) {
          const allShorts = engine.shortPositions[symbol] ?? [];
          const idx = allShorts.findIndex(p => p.orderId === pos.orderId);
          if (idx >= 0) allShorts.splice(idx, 1);
          recordTradeResult(symbol, "short_scalping", pnl > 0);
          await db.insertTrade({ userId: engine.userId, symbol, side: "buy", price: price.toString(), qty, pnl: pnl.toFixed(2), strategy: "short_scalping", orderId, simulated: engine.simulationMode });
          const cs = await db.getOrCreateBotState(engine.userId);
          if (cs) {
            await db.updateBotState(engine.userId, {
              totalPnl: (parseFloat(cs.totalPnl ?? "0") + pnl).toFixed(2),
              todayPnl: (parseFloat(cs.todayPnl ?? "0") + pnl).toFixed(2),
              currentBalance: (parseFloat(cs.currentBalance ?? "5000") + pnl).toFixed(2),
              totalTrades: (cs.totalTrades ?? 0) + 1,
              winningTrades: (cs.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
            });
          }
          if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
          console.log(`[ShortScalp] TIME-COVER ${symbol} @ ${price.toFixed(2)} pnl=$${pnl.toFixed(2)}`);
          await sendTelegramNotification(engine, `📉 <b>PHANTOM Short Profit</b>\nPar: ${symbol}\nGanancia: <b>$${pnl.toFixed(2)}</b>`);
        }
      }
    }
  }

  // ─── Short Entry Logic ───
  if (shortPositionsForStrategy.length >= maxPositions) return;

  // Only enter shorts when market is bearish
  const baseMinConfidence = symbol === "XAUUSDT" ? 20 : 25;
  const minConfidence = baseMinConfidence - nocturnal.confidenceReduction * 100;
  if (!smartScore || smartScore.confidence < minConfidence) return;
  // Direction MUST be "sell" (bearish signal)
  if (smartScore.direction !== "sell") return;
  // Regime must be bearish
  if (marketRegime !== "trend_down" && marketRegime !== "strong_trend_down" && marketRegime !== "volatile") return;

  // Calculate trade amount (conservative for shorts)
  const allocation = strat?.allocationPct ?? 30;
  const state = await db.getOrCreateBotState(engine.userId);
  const balance = parseFloat(state?.currentBalance ?? "5000");
  const baseAmount = (balance * allocation / 100) * 0.10; // 10% per position (conservative)
  const tradeAmount = baseAmount * positionSizeMultiplier;
  const qty = (tradeAmount / price).toFixed(6);

  // Open SHORT (Sell without reduceOnly)
  const orderId = await placeOrder(engine, symbol, "Sell", qty, "linear", { isOpenShort: true });
  if (orderId) {
    if (!engine.shortPositions[symbol]) engine.shortPositions[symbol] = [];
    engine.shortPositions[symbol].push({
      symbol, entryPrice: price, qty, orderId, exchange: "bybit",
      category: "linear", openedAt: Date.now(), lowestPrice: price, strategy: "short_scalping",
    });
    await db.insertTrade({ userId: engine.userId, symbol, side: "sell", price: price.toString(), qty, pnl: "0.00", strategy: "short_scalping", orderId, simulated: engine.simulationMode });
    console.log(`[ShortScalp] OPEN SHORT ${symbol} @ ${price.toFixed(2)} qty=${qty} conf=${smartScore.confidence} regime=${marketRegime}`);
    await sendTelegramNotification(engine, `📉 <b>PHANTOM Short Abierto</b>\nPar: ${symbol}\nEntrada: $${price.toFixed(2)}\nConfianza: ${smartScore.confidence}%\nRégimen: ${marketRegime}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── MEAN REVERSION STRATEGY v12.0 ───
// Buys extreme oversold bounces, sells overbought for shorts. Works in ANY market.
// ═══════════════════════════════════════════════════════════════
async function runMeanReversionStrategy(engine: EngineState, symbol: string, category: "linear" = "linear") {
  const ticker = await fetchTicker(engine.client, symbol, category);
  if (!ticker) return;

  const price = ticker.lastPrice;
  engine.lastPrices[symbol] = price;
  livePrices.set(symbol, ticker);

  if (!hasAdequateVolume(symbol)) return;

  const strats = await db.getUserStrategies(engine.userId);
  const strat = strats.find(s => s.symbol === symbol && s.strategyType === "mean_reversion");
  const config = strat?.config as any;
  const maxLongPositions = config?.maxOpenPositions ?? 4;
  const maxShortPositions = config?.maxOpenPositions ?? 3;
  const takeProfitPct = (config?.takeProfitPct ?? 0.4) / 100; // 0.4% default target
  const maxHoldMs = (config?.maxHoldMinutes ?? 60) * 60 * 1000;

  // ─── Detect Mean Reversion Signal ───
  let meanRevSignal: any = null;
  try {
    const klines = await fetchKlines(engine.client, symbol, "5", 60, category);
    meanRevSignal = detectMeanReversionPM(klines, price);
  } catch { return; }

  if (!meanRevSignal) return;

  // ─── Close existing mean reversion positions (both longs and shorts) ───
  // Long positions (stored in scalpPositions with strategy label)
  const scalpPositions = engine.scalpPositions[symbol] ?? [];
  const meanRevLongs = scalpPositions.filter(p => (p as any).__strategy === "mean_reversion");

  for (let i = meanRevLongs.length - 1; i >= 0; i--) {
    const pos = meanRevLongs[i];
    const profitPct = (price - pos.buyPrice) / pos.buyPrice;
    const holdMs = Date.now() - pos.openedAt;

    // Take profit at target OR time-based exit
    if (profitPct >= takeProfitPct || (holdMs > maxHoldMs && profitPct > 0)) {
      const qty = pos.qty;
      const tradeAmount = pos.buyPrice * parseFloat(qty);
      const grossPnl = (price - pos.buyPrice) * parseFloat(qty);
      const pnl = calcNetPnl(grossPnl, tradeAmount, "linear", true, "bybit", holdMs);

      if (pnl > tradeAmount * MIN_PROFIT_PCT) {
        const orderId = await placeOrder(engine, symbol, "Sell", qty, "linear");
        if (orderId) {
          const allScalps = engine.scalpPositions[symbol] ?? [];
          const idx = allScalps.findIndex(p => p.orderId === pos.orderId);
          if (idx >= 0) allScalps.splice(idx, 1);
          recordTradeResult(symbol, "mean_reversion", pnl > 0);
          await db.insertTrade({ userId: engine.userId, symbol, side: "sell", price: price.toString(), qty, pnl: pnl.toFixed(2), strategy: "mean_reversion", orderId, simulated: engine.simulationMode });
          const cs = await db.getOrCreateBotState(engine.userId);
          if (cs) {
            await db.updateBotState(engine.userId, {
              totalPnl: (parseFloat(cs.totalPnl ?? "0") + pnl).toFixed(2),
              todayPnl: (parseFloat(cs.todayPnl ?? "0") + pnl).toFixed(2),
              currentBalance: (parseFloat(cs.currentBalance ?? "5000") + pnl).toFixed(2),
              totalTrades: (cs.totalTrades ?? 0) + 1,
              winningTrades: (cs.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
            });
          }
          if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
          try { recordTradeForTuning("mean_reversion", pnl, (pnl / tradeAmount) * 100); recordTradeResultOptimizer(pnl); } catch { /* silent */ }
          console.log(`[MeanRev] SELL ${symbol} @ ${price.toFixed(2)} entry=${pos.buyPrice.toFixed(2)} pnl=$${pnl.toFixed(2)} (${profitPct >= takeProfitPct ? "TP" : "TIME"})`);
          await sendTelegramNotification(engine, `🎯 <b>PHANTOM MeanRev Profit</b>\nPar: ${symbol}\nCompra: $${pos.buyPrice.toFixed(2)}\nVenta: $${price.toFixed(2)}\nGanancia: <b>$${pnl.toFixed(2)}</b>`);
        }
      }
    }
  }

  // Short positions for mean reversion (close when price drops to target)
  const shortPositions = engine.shortPositions[symbol] ?? [];
  const meanRevShorts = shortPositions.filter(p => p.strategy === "mean_reversion");

  for (let i = meanRevShorts.length - 1; i >= 0; i--) {
    const pos = meanRevShorts[i];
    const profitPct = (pos.entryPrice - price) / pos.entryPrice;
    const holdMs = Date.now() - pos.openedAt;

    if (profitPct >= takeProfitPct || (holdMs > maxHoldMs && profitPct > 0)) {
      const qty = pos.qty;
      const tradeAmount = pos.entryPrice * parseFloat(qty);
      const grossPnl = (pos.entryPrice - price) * parseFloat(qty);
      const pnl = calcNetPnl(grossPnl, tradeAmount, "linear", true, "bybit", holdMs);

      if (pnl > tradeAmount * MIN_PROFIT_PCT) {
        const orderId = await placeOrder(engine, symbol, "Buy", qty, "linear", { reduceOnly: true });
        if (orderId) {
          const allShorts = engine.shortPositions[symbol] ?? [];
          const idx = allShorts.findIndex(p => p.orderId === pos.orderId);
          if (idx >= 0) allShorts.splice(idx, 1);
          recordTradeResult(symbol, "mean_reversion", pnl > 0);
          await db.insertTrade({ userId: engine.userId, symbol, side: "buy", price: price.toString(), qty, pnl: pnl.toFixed(2), strategy: "mean_reversion", orderId, simulated: engine.simulationMode });
          const cs = await db.getOrCreateBotState(engine.userId);
          if (cs) {
            await db.updateBotState(engine.userId, {
              totalPnl: (parseFloat(cs.totalPnl ?? "0") + pnl).toFixed(2),
              todayPnl: (parseFloat(cs.todayPnl ?? "0") + pnl).toFixed(2),
              currentBalance: (parseFloat(cs.currentBalance ?? "5000") + pnl).toFixed(2),
              totalTrades: (cs.totalTrades ?? 0) + 1,
              winningTrades: (cs.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
            });
          }
          if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
          try { recordTradeForTuning("mean_reversion", pnl, (pnl / tradeAmount) * 100); recordTradeResultOptimizer(pnl); } catch { /* silent */ }
          console.log(`[MeanRev] COVER SHORT ${symbol} @ ${price.toFixed(2)} entry=${pos.entryPrice.toFixed(2)} pnl=$${pnl.toFixed(2)}`);
          await sendTelegramNotification(engine, `🎯 <b>PHANTOM MeanRev Short Profit</b>\nPar: ${symbol}\nGanancia: <b>$${pnl.toFixed(2)}</b>`);
        }
      }
    }
  }

  // ─── Entry Logic ───
  if (!meanRevSignal.detected || meanRevSignal.confidence < 45) return;

  const allocation = strat?.allocationPct ?? 25;
  const state = await db.getOrCreateBotState(engine.userId);
  const balance = parseFloat(state?.currentBalance ?? "5000");
  const positionSizeMultiplier = getLossCooldownMultiplier(symbol, "mean_reversion");
  const baseAmount = (balance * allocation / 100) * 0.12;
  const tradeAmount = baseAmount * positionSizeMultiplier * (meanRevSignal.confidence / 60);
  const qty = (tradeAmount / price).toFixed(6);

  if (meanRevSignal.direction === "long" && meanRevLongs.length < maxLongPositions) {
    // OVERSOLD → Buy long
    const orderId = await placeOrder(engine, symbol, "Buy", qty, "linear");
    if (orderId) {
      if (!engine.scalpPositions[symbol]) engine.scalpPositions[symbol] = [];
      const newPos: ScalpPosition & { __strategy?: string } = {
        symbol, buyPrice: price, qty, orderId, exchange: "bybit",
        category: "linear", openedAt: Date.now(), highestPrice: price,
      };
      (newPos as any).__strategy = "mean_reversion";
      engine.scalpPositions[symbol].push(newPos);
      await db.insertTrade({ userId: engine.userId, symbol, side: "buy", price: price.toString(), qty, pnl: "0.00", strategy: "mean_reversion", orderId, simulated: engine.simulationMode });
      console.log(`[MeanRev] BUY OVERSOLD ${symbol} @ ${price.toFixed(2)} RSI=${meanRevSignal.rsiValue?.toFixed(1)} conf=${meanRevSignal.confidence}`);
      await sendTelegramNotification(engine, `🎯 <b>PHANTOM MeanRev Compra</b>\nPar: ${symbol}\nPrecio: $${price.toFixed(2)}\nRSI: ${meanRevSignal.rsiValue?.toFixed(1)}\nConfianza: ${meanRevSignal.confidence}%\nRazón: ${meanRevSignal.reason}`);
    }
  } else if (meanRevSignal.direction === "short" && meanRevShorts.length < maxShortPositions) {
    // OVERBOUGHT → Open short
    const orderId = await placeOrder(engine, symbol, "Sell", qty, "linear", { isOpenShort: true });
    if (orderId) {
      if (!engine.shortPositions[symbol]) engine.shortPositions[symbol] = [];
      engine.shortPositions[symbol].push({
        symbol, entryPrice: price, qty, orderId, exchange: "bybit",
        category: "linear", openedAt: Date.now(), lowestPrice: price, strategy: "mean_reversion",
      });
      await db.insertTrade({ userId: engine.userId, symbol, side: "sell", price: price.toString(), qty, pnl: "0.00", strategy: "mean_reversion", orderId, simulated: engine.simulationMode });
      console.log(`[MeanRev] SHORT OVERBOUGHT ${symbol} @ ${price.toFixed(2)} RSI=${meanRevSignal.rsiValue?.toFixed(1)} conf=${meanRevSignal.confidence}`);
      await sendTelegramNotification(engine, `🎯 <b>PHANTOM MeanRev Short</b>\nPar: ${symbol}\nPrecio: $${price.toFixed(2)}\nRSI: ${meanRevSignal.rsiValue?.toFixed(1)}\nConfianza: ${meanRevSignal.confidence}%`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── BIDIRECTIONAL GRID STRATEGY v12.0 ───
// Grid with BOTH longs and shorts simultaneously. AI decides ratio.
// ═══════════════════════════════════════════════════════════════
async function runBidirectionalGridStrategy(engine: EngineState, symbol: string, category: "linear" = "linear") {
  const ticker = await fetchTicker(engine.client, symbol, category);
  if (!ticker) return;

  const price = ticker.lastPrice;
  engine.lastPrices[symbol] = price;
  livePrices.set(symbol, ticker);

  if (!hasAdequateVolume(symbol)) return;

  // ─── SMART ANALYSIS ───
  let smartScore: SignalScore | null = null;
  let marketRegime: MarketRegime = "ranging";
  let positionSizeMultiplier = 1.0;

  try {
    const klines = await fetchKlines(engine.client, symbol, "15", 60, category);
    if (klines.closes.length >= 30) {
      smartScore = calculateSignalScore(klines, price);
      marketRegime = smartScore.regime;
      positionSizeMultiplier = smartScore.suggestedSizePct;
      positionSizeMultiplier *= getLossCooldownMultiplier(symbol, "bidirectional_grid");
    }
  } catch { /* keep defaults */ }

  const strats = await db.getUserStrategies(engine.userId);
  const strat = strats.find(s => s.symbol === symbol && s.strategyType === "bidirectional_grid");
  const config = strat?.config as any;
  const gridSpreadPct = (config?.gridSpreadPct ?? 0.3) / 100;
  const maxLongPositions = config?.maxOpenPositions ?? 6;
  const maxShortPositions = Math.max(3, Math.floor((config?.maxOpenPositions ?? 6) * 0.7));
  const trailingPct = (config?.trailingStopPct ?? 0.3) / 100;

  // ─── AI decides long/short ratio based on regime ───
  let longRatio = 0.5; // 50/50 default
  let shortRatio = 0.5;
  if (marketRegime === "trend_up" || marketRegime === "strong_trend_up") {
    longRatio = 0.7; shortRatio = 0.3;
  } else if (marketRegime === "trend_down" || marketRegime === "strong_trend_down") {
    longRatio = 0.3; shortRatio = 0.7;
  } else if (marketRegime === "volatile") {
    longRatio = 0.5; shortRatio = 0.5;
  }

  // ─── Close existing positions ───
  // Close long positions (in openBuyPositions with biGrid tag or general trailing)
  const longPositions = engine.openBuyPositions[symbol] ?? [];
  for (let i = longPositions.length - 1; i >= 0; i--) {
    const pos = longPositions[i];
    if ((pos as any).__biGrid !== true) continue; // only manage our own positions
    const profitPct = (price - pos.buyPrice) / pos.buyPrice;

    // Trailing stop for longs
    if (!pos.highestPrice || price > pos.highestPrice) pos.highestPrice = price;
    if (pos.highestPrice && profitPct > 0) {
      const dropFromHigh = (pos.highestPrice - price) / pos.highestPrice;
      if (dropFromHigh >= trailingPct && profitPct >= 0.001) {
        const qty = pos.qty;
        const tradeAmount = pos.tradeAmount;
        const grossPnl = (price - pos.buyPrice) * parseFloat(qty);
        const pnl = calcNetPnl(grossPnl, tradeAmount, "linear", true, "bybit");
        if (pnl > tradeAmount * MIN_PROFIT_PCT) {
          const orderId = await placeOrder(engine, symbol, "Sell", qty, "linear");
          if (orderId) {
            longPositions.splice(i, 1);
            recordTradeResult(symbol, "bidirectional_grid", pnl > 0);
            await db.insertTrade({ userId: engine.userId, symbol, side: "sell", price: price.toString(), qty, pnl: pnl.toFixed(2), strategy: "bidirectional_grid", orderId, simulated: engine.simulationMode });
            const cs = await db.getOrCreateBotState(engine.userId);
            if (cs) {
              await db.updateBotState(engine.userId, {
                totalPnl: (parseFloat(cs.totalPnl ?? "0") + pnl).toFixed(2),
                todayPnl: (parseFloat(cs.todayPnl ?? "0") + pnl).toFixed(2),
                currentBalance: (parseFloat(cs.currentBalance ?? "5000") + pnl).toFixed(2),
                totalTrades: (cs.totalTrades ?? 0) + 1,
                winningTrades: (cs.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
              });
            }
            if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
            try { recordTradeForTuning("bidirectional_grid", pnl, (pnl / tradeAmount) * 100); recordTradeResultOptimizer(pnl); } catch { /* silent */ }
            console.log(`[BiGrid] SELL LONG ${symbol} @ ${price.toFixed(2)} pnl=$${pnl.toFixed(2)}`);
            if (pnl > 0) await sendTelegramNotification(engine, `🔄 <b>PHANTOM BiGrid Long Profit</b>\nPar: ${symbol}\nGanancia: <b>$${pnl.toFixed(2)}</b>`);
          }
        }
      }
    }
  }

  // Close short positions
  const shortPositions = engine.shortPositions[symbol] ?? [];
  const biGridShorts = shortPositions.filter(p => p.strategy === "bidirectional_grid");
  for (let i = biGridShorts.length - 1; i >= 0; i--) {
    const pos = biGridShorts[i];
    const profitPct = (pos.entryPrice - price) / pos.entryPrice;

    if (!pos.lowestPrice || price < pos.lowestPrice) pos.lowestPrice = price;
    if (pos.lowestPrice && profitPct > 0) {
      const bounceFromLow = (price - pos.lowestPrice) / pos.lowestPrice;
      if (bounceFromLow >= trailingPct && profitPct >= 0.001) {
        const qty = pos.qty;
        const tradeAmount = pos.entryPrice * parseFloat(qty);
        const grossPnl = (pos.entryPrice - price) * parseFloat(qty);
        const pnl = calcNetPnl(grossPnl, tradeAmount, "linear", true, "bybit");
        if (pnl > tradeAmount * MIN_PROFIT_PCT) {
          const orderId = await placeOrder(engine, symbol, "Buy", qty, "linear", { reduceOnly: true });
          if (orderId) {
            const allShorts = engine.shortPositions[symbol] ?? [];
            const idx = allShorts.findIndex(p => p.orderId === pos.orderId);
            if (idx >= 0) allShorts.splice(idx, 1);
            recordTradeResult(symbol, "bidirectional_grid", pnl > 0);
            await db.insertTrade({ userId: engine.userId, symbol, side: "buy", price: price.toString(), qty, pnl: pnl.toFixed(2), strategy: "bidirectional_grid", orderId, simulated: engine.simulationMode });
            const cs = await db.getOrCreateBotState(engine.userId);
            if (cs) {
              await db.updateBotState(engine.userId, {
                totalPnl: (parseFloat(cs.totalPnl ?? "0") + pnl).toFixed(2),
                todayPnl: (parseFloat(cs.todayPnl ?? "0") + pnl).toFixed(2),
                currentBalance: (parseFloat(cs.currentBalance ?? "5000") + pnl).toFixed(2),
                totalTrades: (cs.totalTrades ?? 0) + 1,
                winningTrades: (cs.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
              });
            }
            if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
            try { recordTradeForTuning("bidirectional_grid", pnl, (pnl / tradeAmount) * 100); recordTradeResultOptimizer(pnl); } catch { /* silent */ }
            console.log(`[BiGrid] COVER SHORT ${symbol} @ ${price.toFixed(2)} pnl=$${pnl.toFixed(2)}`);
            if (pnl > 0) await sendTelegramNotification(engine, `🔄 <b>PHANTOM BiGrid Short Profit</b>\nPar: ${symbol}\nGanancia: <b>$${pnl.toFixed(2)}</b>`);
          }
        }
      }
    }

    // Safety stop for shorts at -3%
    if (profitPct < -0.03) {
      const qty = pos.qty;
      const tradeAmount = pos.entryPrice * parseFloat(qty);
      const grossPnl = (pos.entryPrice - price) * parseFloat(qty);
      const pnl = calcNetPnl(grossPnl, tradeAmount, "linear", true, "bybit");
      const orderId = await placeOrder(engine, symbol, "Buy", qty, "linear", { reduceOnly: true });
      if (orderId) {
        const allShorts = engine.shortPositions[symbol] ?? [];
        const idx = allShorts.findIndex(p => p.orderId === pos.orderId);
        if (idx >= 0) allShorts.splice(idx, 1);
        recordTradeResult(symbol, "bidirectional_grid", false);
        await db.insertTrade({ userId: engine.userId, symbol, side: "buy", price: price.toString(), qty, pnl: pnl.toFixed(2), strategy: "bidirectional_grid", orderId, simulated: engine.simulationMode });
        const cs = await db.getOrCreateBotState(engine.userId);
        if (cs) {
          await db.updateBotState(engine.userId, {
            totalPnl: (parseFloat(cs.totalPnl ?? "0") + pnl).toFixed(2),
            todayPnl: (parseFloat(cs.todayPnl ?? "0") + pnl).toFixed(2),
            currentBalance: (parseFloat(cs.currentBalance ?? "5000") + pnl).toFixed(2),
            totalTrades: (cs.totalTrades ?? 0) + 1,
            winningTrades: (cs.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
          });
        }
        console.log(`[BiGrid] STOP SHORT ${symbol} @ ${price.toFixed(2)} pnl=$${pnl.toFixed(2)}`);
      }
    }
  }

  // ─── Entry Logic: Place grid entries at spread intervals ───
  const biGridLongs = longPositions.filter(p => (p as any).__biGrid === true);
  const currentBiGridShorts = (engine.shortPositions[symbol] ?? []).filter(p => p.strategy === "bidirectional_grid");

  // Only enter if confidence is reasonable
  if (!smartScore || smartScore.confidence < 15) return;

  const allocation = strat?.allocationPct ?? 30;
  const state = await db.getOrCreateBotState(engine.userId);
  const balance = parseFloat(state?.currentBalance ?? "5000");
  const baseAmount = (balance * allocation / 100) * 0.08;

  // ─── Long entries (below current price) ───
  if (biGridLongs.length < maxLongPositions * longRatio) {
    // Check if price dropped enough from last long entry
    const lastLongPrice = biGridLongs.length > 0 ? Math.min(...biGridLongs.map(p => p.buyPrice)) : price * (1 + gridSpreadPct);
    if (price < lastLongPrice * (1 - gridSpreadPct)) {
      const tradeAmount = baseAmount * positionSizeMultiplier * longRatio;
      const qty = (tradeAmount / price).toFixed(6);
      const orderId = await placeOrder(engine, symbol, "Buy", qty, "linear");
      if (orderId) {
        if (!engine.openBuyPositions[symbol]) engine.openBuyPositions[symbol] = [];
        const newPos: OpenBuyPosition & { __biGrid?: boolean } = {
          symbol, buyPrice: price, qty, tradeAmount, category: "linear",
          gridLevelPrice: price, highestPrice: price, openedAt: Date.now(),
        };
        (newPos as any).__biGrid = true;
        engine.openBuyPositions[symbol].push(newPos);
        await db.insertTrade({ userId: engine.userId, symbol, side: "buy", price: price.toString(), qty, pnl: "0.00", strategy: "bidirectional_grid", orderId, simulated: engine.simulationMode });
        console.log(`[BiGrid] BUY LONG ${symbol} @ ${price.toFixed(2)} qty=${qty} ratio=L${(longRatio*100).toFixed(0)}/S${(shortRatio*100).toFixed(0)}`);
      }
    }
  }

  // ─── Short entries (above current price) ───
  if (currentBiGridShorts.length < maxShortPositions * shortRatio) {
    const lastShortPrice = currentBiGridShorts.length > 0 ? Math.max(...currentBiGridShorts.map(p => p.entryPrice)) : price * (1 - gridSpreadPct);
    if (price > lastShortPrice * (1 + gridSpreadPct)) {
      const tradeAmount = baseAmount * positionSizeMultiplier * shortRatio;
      const qty = (tradeAmount / price).toFixed(6);
      const orderId = await placeOrder(engine, symbol, "Sell", qty, "linear", { isOpenShort: true });
      if (orderId) {
        if (!engine.shortPositions[symbol]) engine.shortPositions[symbol] = [];
        engine.shortPositions[symbol].push({
          symbol, entryPrice: price, qty, orderId, exchange: "bybit",
          category: "linear", openedAt: Date.now(), lowestPrice: price, strategy: "bidirectional_grid",
        });
        await db.insertTrade({ userId: engine.userId, symbol, side: "sell", price: price.toString(), qty, pnl: "0.00", strategy: "bidirectional_grid", orderId, simulated: engine.simulationMode });
        console.log(`[BiGrid] OPEN SHORT ${symbol} @ ${price.toFixed(2)} qty=${qty} ratio=L${(longRatio*100).toFixed(0)}/S${(shortRatio*100).toFixed(0)}`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── OPPORTUNITY SCANNER v12.0 ───
// ═══════════════════════════════════════════════════════════════
async function runOpportunityScanner(engine: EngineState) {
  try {
    for (const symbol of SCANNER_COINS) {
      const ticker = livePrices.get(symbol);
      if (!ticker) continue;
      const price = ticker.lastPrice;

      try {
        const klines = await fetchKlines(engine.client, symbol, "15", 60, "linear");
        if (klines.closes.length < 30) continue;
        const score = calculateSignalScore(klines, price);
        if (score.confidence >= 80 && score.direction === "buy") {
          console.log(`[Scanner] ${symbol} HIGH CONFIDENCE: ${score.confidence}% ${score.direction} regime=${score.regime}`);
          await sendTelegramNotification(engine, buildOpportunityAlert(symbol, score.confidence, score.direction, score.regime, 0, 0, "scanner"));
        }
      } catch { /* skip symbol */ }
    }
  } catch (e) {
    console.error("[Scanner] Error:", (e as Error).message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── POSITION RECONCILIATION v12.0 ───
// Sync DB positions with actual Bybit positions on startup
// ═══════════════════════════════════════════════════════════════
async function reconcilePositions(engine: EngineState) {
  if (engine.simulationMode) return;
  console.log("[Reconcile] Starting position reconciliation with Bybit...");

  try {
    // Get all linear positions from Bybit
    const res = await withRetry(() => engine.client.getPositionInfo({ category: "linear", settleCoin: "USDT" }), "Reconcile positions");
    if (res.retCode !== 0) {
      console.warn("[Reconcile] Failed to fetch Bybit positions:", res.retMsg);
      return;
    }

    const bybitPositions = (res.result?.list ?? []) as any[];
    const activeBybitSymbols = new Map<string, { size: number; avgPrice: number }>();

    for (const pos of bybitPositions) {
      const size = parseFloat(pos.size ?? "0");
      if (size > 0 && pos.side === "Buy") {
        activeBybitSymbols.set(pos.symbol, {
          size,
          avgPrice: parseFloat(pos.avgPrice ?? "0"),
        });
      }
    }

    console.log(`[Reconcile] Bybit has ${activeBybitSymbols.size} active long positions`);

    // Check each DB position against Bybit
    const allSymbols = new Set([
      ...Object.keys(engine.openBuyPositions),
      ...Object.keys(engine.scalpPositions),
    ]);

    for (const symbol of Array.from(allSymbols)) {
      const bybitPos = activeBybitSymbols.get(symbol);

      // Grid positions
      const gridPositions = engine.openBuyPositions[symbol] ?? [];
      if (gridPositions.length > 0 && !bybitPos) {
        console.warn(`[Reconcile] ${symbol} has ${gridPositions.length} grid positions in DB but NO position on Bybit — clearing DB`);
        engine.openBuyPositions[symbol] = [];
        await db.clearAllOpenPositions(engine.userId);
      }

      // Scalp positions
      const scalpPositions = engine.scalpPositions[symbol] ?? [];
      if (scalpPositions.length > 0 && !bybitPos) {
        console.warn(`[Reconcile] ${symbol} has ${scalpPositions.length} scalp positions in DB but NO position on Bybit — clearing`);
        engine.scalpPositions[symbol] = [];
      }
    }

    // Check if Bybit has positions we don't know about
    for (const [symbol, bybitPos] of Array.from(activeBybitSymbols.entries())) {
      const hasGrid = (engine.openBuyPositions[symbol]?.length ?? 0) > 0;
      const hasScalp = (engine.scalpPositions[symbol]?.length ?? 0) > 0;
      if (!hasGrid && !hasScalp) {
        console.warn(`[Reconcile] ${symbol} has position on Bybit (size=${bybitPos.size}, avg=${bybitPos.avgPrice}) but NOT in DB — adding as grid position`);
        if (!engine.openBuyPositions[symbol]) engine.openBuyPositions[symbol] = [];
        engine.openBuyPositions[symbol].push({
          symbol, buyPrice: bybitPos.avgPrice, qty: bybitPos.size.toString(),
          tradeAmount: bybitPos.avgPrice * bybitPos.size, category: "linear",
          gridLevelPrice: bybitPos.avgPrice, highestPrice: bybitPos.avgPrice, openedAt: Date.now(),
        });
      }
    }

    console.log("[Reconcile] Position reconciliation complete");
  } catch (e) {
    console.error("[Reconcile] Error:", (e as Error).message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── STALE POSITION CLOSER v12.0 ───
// Actually close stale positions instead of just logging them
// ═══════════════════════════════════════════════════════════════
async function closeStalePositions(engine: EngineState) {
  const allScalpPositions = Object.entries(engine.scalpPositions).flatMap(([sym, positions]) =>
    positions.map((p, idx) => ({ symbol: sym, pos: p, idx, strategy: "scalping" as const }))
  );
  const allGridPositions = Object.entries(engine.openBuyPositions).flatMap(([sym, positions]) =>
    positions.map((p, idx) => ({ symbol: sym, pos: p, idx, strategy: "grid" as const }))
  );

  for (const item of [...allScalpPositions, ...allGridPositions]) {
    const price = engine.lastPrices[item.symbol] ?? livePrices.get(item.symbol)?.lastPrice ?? 0;
    if (price <= 0) continue;

    const buyPrice = item.strategy === "scalping" ? (item.pos as ScalpPosition).buyPrice : (item.pos as OpenBuyPosition).buyPrice;
    const openedAt = item.strategy === "scalping" ? (item.pos as ScalpPosition).openedAt : (item.pos as OpenBuyPosition).openedAt;
    const holdHours = (Date.now() - openedAt) / 3600000;
    const profitPct = (price - buyPrice) / buyPrice;

    // Stale thresholds: scalp > 4h, grid > 12h
    const staleHours = item.strategy === "scalping" ? 4 : 12;
    if (holdHours < staleHours) continue;

    // Only close if in profit (no stop-loss philosophy)
    if (profitPct <= 0) {
      console.log(`[Stale] ${item.symbol} ${item.strategy} held ${holdHours.toFixed(1)}h at ${(profitPct * 100).toFixed(2)}% — HOLD (no stop-loss)`);
      continue;
    }

    const qty = item.strategy === "scalping" ? (item.pos as ScalpPosition).qty : (item.pos as OpenBuyPosition).qty;
    const tradeAmount = buyPrice * parseFloat(qty);
    const grossPnl = (price - buyPrice) * parseFloat(qty);
    const pnl = calcNetPnl(grossPnl, tradeAmount, "linear", true, "bybit", Date.now() - openedAt);

    if (pnl <= tradeAmount * MIN_PROFIT_PCT) continue;

    const orderId = await placeOrder(engine, item.symbol, "Sell", qty, "linear");
    if (orderId) {
      // Remove from positions
      if (item.strategy === "scalping") {
        const arr = engine.scalpPositions[item.symbol];
        if (arr) {
          const idx = arr.findIndex(p => p.buyPrice === buyPrice && p.qty === qty);
          if (idx >= 0) arr.splice(idx, 1);
        }
      } else {
        const arr = engine.openBuyPositions[item.symbol];
        if (arr) {
          const idx = arr.findIndex(p => p.buyPrice === buyPrice && p.qty === qty);
          if (idx >= 0) arr.splice(idx, 1);
        }
      }

      recordTradeResult(item.symbol, item.strategy, pnl > 0);
      await db.insertTrade({ userId: engine.userId, symbol: item.symbol, side: "sell", price: price.toString(), qty, pnl: pnl.toFixed(2), strategy: item.strategy, orderId, simulated: engine.simulationMode });
      const cs = await db.getOrCreateBotState(engine.userId);
      if (cs) {
        await db.updateBotState(engine.userId, {
          totalPnl: (parseFloat(cs.totalPnl ?? "0") + pnl).toFixed(2),
          todayPnl: (parseFloat(cs.todayPnl ?? "0") + pnl).toFixed(2),
          currentBalance: (parseFloat(cs.currentBalance ?? "5000") + pnl).toFixed(2),
          totalTrades: (cs.totalTrades ?? 0) + 1,
          winningTrades: (cs.winningTrades ?? 0) + (pnl > 0 ? 1 : 0),
        });
      }

      console.log(`[Stale] CLOSED ${item.symbol} ${item.strategy} held ${holdHours.toFixed(1)}h pnl=$${pnl.toFixed(2)}`);
      await sendTelegramNotification(engine, `🕐 <b>PHANTOM Stale Close</b>\nPar: ${item.symbol}\nEstrategia: ${item.strategy}\nTiempo: ${holdHours.toFixed(1)}h\nGanancia: <b>$${pnl.toFixed(2)}</b>`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── START ENGINE v12.0 ───
// ═══════════════════════════════════════════════════════════════
export async function startEngine(userId: number, options: {
  exchange: string; apiKey: string; apiSecret: string;
  passphrase?: string; simulationMode?: boolean;
  telegramBotToken?: string; telegramChatId?: string;
}): Promise<{ success: boolean }> {
  if (engines.has(userId)) {
    console.log(`[Engine] Already running for user ${userId}`);
    return { success: true };
  }

  const client = new RestClientV5({
    key: options.simulationMode ? undefined : options.apiKey,
    secret: options.simulationMode ? undefined : options.apiSecret,
  });

  const engine: EngineState = {
    userId, exchange: "bybit", client,
    isRunning: true, simulationMode: options.simulationMode ?? false,
    gridLevels: {}, lastPrices: {},
    openBuyPositions: {}, dcaPositions: {},
    scalpPositions: {}, shortPositions: {},
    telegramBotToken: options.telegramBotToken,
    telegramChatId: options.telegramChatId,
    pnlAlertsSentToday: new Set<string>(),
  };

  engines.set(userId, engine);
  engineCycles.set(userId, 0);

  // ─── v12.0: Force leverage 5x on all active symbols ───
  if (!engine.simulationMode) {
    const strats = await db.getUserStrategies(userId);
    const activeSymbols = new Set(strats.filter(s => s.enabled).map(s => s.symbol));
    for (const symbol of Array.from(activeSymbols)) {
      await ensureLeverage(client, symbol, LEVERAGE);
    }
    console.log(`[Engine] Leverage set to ${LEVERAGE}x for ${activeSymbols.size} symbols`);
  }

  // ─── Restore positions from DB ───
  try {
    const savedPositions = await db.loadOpenPositions(userId, "bybit");
    let totalRestored = 0;
    for (const [symbol, positions] of Object.entries(savedPositions)) {
      if (!engine.openBuyPositions[symbol]) engine.openBuyPositions[symbol] = [];
      for (const pos of positions) {
        engine.openBuyPositions[symbol].push(pos);
        totalRestored++;
      }
    }
    if (totalRestored > 0) console.log(`[Engine] Restored ${totalRestored} positions from DB`);
  } catch (e) {
    console.error("[Engine] Failed to restore positions:", (e as Error).message);
  }

  // ─── v12.0: Reconcile with Bybit ───
  await reconcilePositions(engine);

  // ─── Fetch Fear & Greed Index ───
  try {
    const fg = await fetchFearGreedIndex();
    if (fg) console.log(`[Engine] Fear & Greed Index: ${fg.score} (${fg.label})`);
  } catch { /* silent */ }

  // ─── AutoTune parameters ───
  try {
    const tuneResult = autoTuneParameters();
    console.log(`[Engine] AutoTune: gridSpread=${tuneResult.gridSpreadMultiplier.toFixed(2)}, posSize=${tuneResult.positionSizeMultiplier.toFixed(2)}`);
  } catch { /* silent */ }

  await db.updateBotState(userId, { isRunning: true });
  console.log(`[Engine] v12.0 STARTED for user ${userId} | exchange=bybit | sim=${engine.simulationMode} | leverage=${LEVERAGE}x`);

  await sendTelegramNotification(engine,
    `🚀 <b>PHANTOM v12.0 — Motor Iniciado</b>\n` +
    `Modo: ${engine.simulationMode ? "🧪 Simulación" : "🔴 LIVE"}\n` +
    `Leverage: ${LEVERAGE}x\n` +
    `Exchange: Bybit\n` +
    `Inteligencia: AI + Kelly + F&G conectados\n` +
    `Protección: Trailing + Time-Profit (sin stop-loss)`
  );

  // ═══ MAIN TRADING LOOP ═══
  engine.intervalId = setInterval(async () => {
    if (!engine.isRunning) return;
    try {
      const cycle = (engineCycles.get(userId) ?? 0) + 1;
      engineCycles.set(userId, cycle);

      // ─── v12.0: Emergency Stop using REAL today PnL from trades ───
      const realTodayPnl = await getRealTodayPnl(userId);
      if (realTodayPnl <= EMERGENCY_STOP_THRESHOLD) {
        console.error(`[Engine] 🚨 EMERGENCY STOP — Today PnL: $${realTodayPnl.toFixed(2)} <= $${EMERGENCY_STOP_THRESHOLD}`);
        await sendTelegramNotification(engine,
          `🚨 <b>PHANTOM — FRENO DE EMERGENCIA</b>\nPérdida hoy: $${realTodayPnl.toFixed(2)}\nLímite: $${EMERGENCY_STOP_THRESHOLD}\nBot DETENIDO automáticamente.`
        );
        await stopEngine(userId);
        return;
      }

      // ─── PnL Alerts ───
      const todayStr = new Date().toISOString().slice(0, 10);
      if (realTodayPnl <= WARNING_THRESHOLD) {
        const alertKey = `warn_${todayStr}`;
        if (!engine.pnlAlertsSentToday?.has(alertKey)) {
          engine.pnlAlertsSentToday?.add(alertKey);
          await sendTelegramNotification(engine, `⚠️ <b>PHANTOM Alerta</b>\nPérdida hoy: $${realTodayPnl.toFixed(2)}\nUmbral: $${WARNING_THRESHOLD}`);
        }
      }

      // ─── Daily Profit Mode ───
      let dailyProfitMode: "normal" | "cautious" | "stopped" = "normal";
      if (realTodayPnl <= -200) dailyProfitMode = "stopped";
      else if (realTodayPnl <= -100) dailyProfitMode = "cautious";

      // ─── Periodic tasks ───
      // Fear & Greed refresh every 20 cycles (~2 min)
      if (cycle % 20 === 0) {
        try { await fetchFearGreedIndex(); } catch { /* silent */ }
      }
      // AutoConvert every 50 cycles (~5 min)
      if (cycle % 50 === 0) {
        try { await autoConvertCoinsToUSDT(engine.client, engine.userId, engine.simulationMode); } catch { /* silent */ }
      }
      // Anomaly detection every 30 cycles
      if (cycle % 30 === 0) {
        for (const symbol of Object.keys(engine.lastPrices)) {
          try {
            const klines = await fetchKlines(engine.client, symbol, "5", 60, "linear");
            const anomaly = detectAnomaly(klines, engine.lastPrices[symbol]);
            if (anomaly.isAnomaly) {
              console.log(`[AI] ${symbol} ANOMALY: ${anomaly.reason}`);
              await sendTelegramNotification(engine, `🔍 <b>Anomalía Detectada</b>\n${symbol}: ${anomaly.reason}`);
            }
          } catch { /* silent */ }
        }
      }

      // ─── Execute strategies ───
      const strats = await db.getUserStrategies(userId);
      console.log(`[Engine] Cycle ${cycle}: ${strats.filter(s => s.enabled).length} strategies enabled (mode=${dailyProfitMode})`);

      for (const strat of strats) {
        if (!strat.enabled) continue;

        console.log(`[Engine] Running ${strat.strategyType} for ${strat.symbol} on Bybit LINEAR`);
        if (strat.strategyType === "scalping") {
          await runScalpingStrategy(engine, strat.symbol, "linear", dailyProfitMode);
        } else if (strat.strategyType === "short_scalping") {
          if (dailyProfitMode !== "stopped") await runShortScalpingStrategy(engine, strat.symbol, "linear");
        } else if (strat.strategyType === "mean_reversion") {
          if (dailyProfitMode !== "stopped") await runMeanReversionStrategy(engine, strat.symbol, "linear");
        } else if (strat.strategyType === "bidirectional_grid") {
          await runBidirectionalGridStrategy(engine, strat.symbol, "linear");
        } else {
          await runGridStrategy(engine, strat.symbol, "linear", dailyProfitMode);
        }
      }
    } catch (e) {
      console.error("[Engine] Trading loop error:", (e as Error).message);
    }
  }, 6_000); // 6s cycle

  // ─── Opportunity Scanner (every 45s) ───
  engine.scannerIntervalId = setInterval(async () => {
    if (!engine.isRunning) return;
    await runOpportunityScanner(engine);
  }, 45_000);
  setTimeout(() => runOpportunityScanner(engine), 3000);

  // ─── First trading cycle (immediate) ───
  setTimeout(async () => {
    const strats = await db.getUserStrategies(userId);
    for (const strat of strats) {
      if (!strat.enabled) continue;
      console.log(`[Engine] First cycle: ${strat.strategyType} ${strat.symbol} LINEAR`);
      if (strat.strategyType === "scalping") await runScalpingStrategy(engine, strat.symbol, "linear");
      else if (strat.strategyType === "short_scalping") await runShortScalpingStrategy(engine, strat.symbol, "linear");
      else if (strat.strategyType === "mean_reversion") await runMeanReversionStrategy(engine, strat.symbol, "linear");
      else if (strat.strategyType === "bidirectional_grid") await runBidirectionalGridStrategy(engine, strat.symbol, "linear");
      else await runGridStrategy(engine, strat.symbol, "linear");
    }
  }, 2000);

  // ─── Daily Summary (23:00) ───
  let lastSummaryDate = "";
  engine.dailySummaryId = setInterval(async () => {
    if (!engine.isRunning) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    if (now.getHours() === 23 && now.getMinutes() === 0 && dateStr !== lastSummaryDate) {
      lastSummaryDate = dateStr;
      await sendDailySummary(engine);
      if (now.getDay() === 0) {
        try { await sendWeeklySummary(engine); } catch { /* silent */ }
      }
    }
  }, 60_000);

  // ─── Compounding + Rebalancing + Stale Closer (every 5 min) ───
  let rebalanceCycleCount = 0;
  engine.autoReinvestId = setInterval(async () => {
    if (!engine.isRunning) return;
    try {
      rebalanceCycleCount++;

      // 1. Compound profits
      const reinvestResult = await checkAutoReinvest(engine.userId, 5);
      if (reinvestResult?.reinvested) {
        console.log(`[Compound] $${reinvestResult.amount.toFixed(2)} → ${reinvestResult.target}`);
        await sendTelegramNotification(engine, `💰 <b>Compounding</b>\nMonto: $${reinvestResult.amount.toFixed(2)}\nDestino: ${reinvestResult.target}`);
      }

      // 2. Close stale positions (v12.0: actually close them)
      await closeStalePositions(engine);

      // 3. Liquidity analysis
      const botState = await db.getOrCreateBotState(engine.userId);
      const currentBal = parseFloat(botState?.currentBalance ?? "5000");
      const totalPositions = Object.values(engine.scalpPositions).reduce((a, b) => a + b.length, 0) + Object.values(engine.openBuyPositions).reduce((a, b) => a + b.length, 0);
      const deployedEstimate = currentBal * 0.7;
      // Inline liquidity check (v12.0)
      const deployedPct = deployedEstimate / currentBal;
      const liqRecommendation = deployedPct > 0.85 ? "reduce_exposure" : deployedPct > 0.7 ? "hold_cash" : "ok";
      if (liqRecommendation !== "ok") {
        console.log(`[Liquidity] ${liqRecommendation}: deployed=${(deployedPct * 100).toFixed(0)}% positions=${totalPositions}`);
      }

      // 4. Rebalance every 4 cycles (20 min)
      if (rebalanceCycleCount % 4 === 0) {
        const allocResult = await rebalanceCapital(engine.userId);
        if (allocResult.decisions.length > 0) {
          console.log(`[Allocator] REBALANCE: ${allocResult.decisions.length} changes`);
          let msg = `🔄 <b>Capital Rebalanceado</b>\n`;
          for (const d of allocResult.decisions) {
            msg += `${d.newAllocationPct > d.oldAllocationPct ? "⬆️" : "⬇️"} ${d.strategy} ${d.symbol}: ${d.oldAllocationPct}% → ${d.newAllocationPct}%\n`;
          }
          await sendTelegramNotification(engine, msg);
        }
      }

      // 5. Sync balance with Bybit every 12 cycles (1 hour)
      if (rebalanceCycleCount % 12 === 0 && !engine.simulationMode) {
        try {
          const res = await withRetry(() => engine.client.getWalletBalance({ accountType: "UNIFIED" }), "Balance sync");
          if (res.retCode === 0) {
            const realBalance = parseFloat((res.result as any)?.list?.[0]?.totalEquity ?? "0");
            if (realBalance > 0) {
              await db.updateBotState(engine.userId, { currentBalance: realBalance.toFixed(2) });
              console.log(`[Sync] Balance synced from Bybit: $${realBalance.toFixed(2)}`);
            }
          }
        } catch { /* silent */ }
      }
    } catch (e) {
      console.error("[Allocator] Error:", (e as Error).message);
    }
  }, 5 * 60 * 1000);

  // ─── Telegram Polling ───
  if (engine.telegramBotToken && engine.telegramChatId) {
    engine.telegramPollingOffset = 0;
    engine.telegramPollingId = setInterval(async () => {
      if (!engine.isRunning || !engine.telegramBotToken) return;
      try {
        const url = `https://api.telegram.org/bot${engine.telegramBotToken}/getUpdates?offset=${engine.telegramPollingOffset ?? 0}&timeout=0&allowed_updates=["message"]`;
        const res = await fetch(url);
        const data = await res.json() as any;
        if (!data.ok || !data.result?.length) return;
        for (const update of data.result) {
          engine.telegramPollingOffset = update.update_id + 1;
          const text = update.message?.text?.trim();
          const chatId = String(update.message?.chat?.id);
          if (chatId !== engine.telegramChatId) continue;
          if (text === "/status" || text === "/estado") {
            await sendStatusReport(engine);
          } else if (text === "/stats" || text === "/estadisticas") {
            try {
              const report = await buildStatsReport(engine.userId);
              await sendTelegramNotification(engine, report);
            } catch (e) { await sendTelegramNotification(engine, `❌ Error: ${(e as Error).message}`); }
          } else if (text === "/allocation" || text === "/capital") {
            try {
              const perfs = await analyzeStrategyPerformance(engine.userId);
              let msg = `📊 <b>Capital Allocation</b>\n`;
              for (const p of perfs.slice(0, 10)) {
                const emoji = p.score >= 60 ? "🟢" : p.score >= 30 ? "🟡" : "🔴";
                msg += `${emoji} ${p.strategy} ${p.symbol}: ${p.currentAllocation}% → ${p.suggestedAllocation}% (score=${p.score})\n`;
              }
              await sendTelegramNotification(engine, msg);
            } catch (e) { await sendTelegramNotification(engine, `❌ Error: ${(e as Error).message}`); }
          } else if (text === "/reinvest" || text === "/reinvertir") {
            try {
              const result = await checkAutoReinvest(engine.userId);
              if (result?.reinvested) {
                await sendTelegramNotification(engine, `💰 Reinversión: $${result.amount.toFixed(2)} → ${result.target}`);
              } else {
                await sendTelegramNotification(engine, `ℹ️ No hay ganancias suficientes para reinvertir.`);
              }
            } catch (e) { await sendTelegramNotification(engine, `❌ Error: ${(e as Error).message}`); }
          } else if (text === "/help" || text === "/ayuda") {
            await sendTelegramNotification(engine,
              `👻 <b>PHANTOM v12.0 — Comandos</b>\n\n` +
              `/status — Estado actual\n/stats — Estadísticas completas\n/allocation — Distribución de capital\n/reinvest — Forzar reinversión\n/help — Este mensaje`
            );
          }
        }
      } catch { /* silent */ }
    }, 10_000);
    console.log(`[Engine] Telegram polling started`);
  }

  return { success: true };
}

// ═══════════════════════════════════════════════════════════════
// ─── STATUS REPORT ───
// ═══════════════════════════════════════════════════════════════
async function sendStatusReport(engine: EngineState) {
  try {
    const state = await db.getOrCreateBotState(engine.userId);
    const initialDeposit = parseFloat(state?.initialBalance ?? "2500");
    const gridCount = Object.values(engine.openBuyPositions).reduce((s, a) => s + a.length, 0);
    const scalpCount = Object.values(engine.scalpPositions).reduce((s, a) => s + a.length, 0);
    const shortCount = Object.values(engine.shortPositions).reduce((s, a) => s + a.length, 0);

    let bybitBalNum = 0;
    try {
      if (!engine.simulationMode) {
        const res = await withRetry(() => engine.client.getWalletBalance({ accountType: "UNIFIED" }), "Status balance");
        if (res.retCode === 0) bybitBalNum = parseFloat((res.result as any)?.list?.[0]?.totalEquity ?? "0");
      }
    } catch { /* skip */ }

    const totalBal = bybitBalNum > 0 ? bybitBalNum : parseFloat(state?.currentBalance ?? "0");
    const realProfit = totalBal - initialDeposit;
    const realProfitPct = initialDeposit > 0 ? ((realProfit / initialDeposit) * 100).toFixed(1) : "0";

    const allTrades = await db.getUserTrades(engine.userId, 5000);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayTrades = allTrades.filter(t => new Date(t.createdAt) >= todayStart);
    const todaySells = todayTrades.filter(t => t.side === "sell");
    const todayPnl = todaySells.reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0);
    const sellTrades = allTrades.filter(t => t.side === "sell");
    const winRate = sellTrades.length > 0 ? ((sellTrades.filter(t => parseFloat(t.pnl ?? "0") > 0).length / sellTrades.length) * 100).toFixed(1) : "0";

    const stratBreakdown: Record<string, { count: number; pnl: number }> = {};
    for (const t of todaySells) {
      const key = t.strategy ?? "unknown";
      if (!stratBreakdown[key]) stratBreakdown[key] = { count: 0, pnl: 0 };
      stratBreakdown[key].count++;
      stratBreakdown[key].pnl += parseFloat(t.pnl ?? "0");
    }
    let stratLines = "";
    for (const [strat, data] of Object.entries(stratBreakdown)) {
      stratLines += `\n  ${data.pnl >= 0 ? "🟢" : "🔴"} ${strat}: ${data.count} ops, ${data.pnl >= 0 ? "+" : ""}$${data.pnl.toFixed(2)}`;
    }

    const mode = engine.simulationMode ? "🧪 SIMULACIÓN" : "🔴 LIVE";
    const message = `👻 <b>PHANTOM v12.0 — Estado</b>\n${mode} | ✅ Activo | ${LEVERAGE}x\n\n` +
      `💰 <b>Balance</b>: $${totalBal.toFixed(2)}\nCapital: $${initialDeposit.toFixed(2)}\n\n` +
      `${todayPnl >= 0 ? "🟢" : "🔴"} <b>Hoy</b>: ${todayPnl >= 0 ? "+" : ""}$${todayPnl.toFixed(2)} (${todaySells.length} ventas)\n` +
      `${realProfit >= 0 ? "🟢" : "🔴"} <b>Total</b>: ${realProfit >= 0 ? "+" : ""}$${realProfit.toFixed(2)} (${realProfitPct}%)\n\n` +
      `📦 <b>Posiciones</b>: Grid=${gridCount} Scalp=${scalpCount} Short=${shortCount}\n` +
      `🏆 <b>Win Rate</b>: ${winRate}%\n` +
      (stratLines ? `\n📊 <b>Desglose</b>:${stratLines}\n` : "") +
      `\n—\n<i>PHANTOM v12.0 • AI + Kelly + F&G</i>`;

    await sendTelegramNotification(engine, message);
  } catch (e) {
    console.error("[Status] Error:", (e as Error).message);
  }
}

// ─── Stats Report Builder ───
async function buildStatsReport(userId: number): Promise<string> {
  const allTrades = await db.getUserTrades(userId, 10000);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(todayStart); monthStart.setDate(monthStart.getDate() - 30);

  const calcPnl = (trades: any[]) => trades.filter(t => t.side === "sell").reduce((s, t) => s + parseFloat(t.pnl ?? "0"), 0);
  const todayPnl = calcPnl(allTrades.filter(t => new Date(t.createdAt) >= todayStart));
  const weekPnl = calcPnl(allTrades.filter(t => new Date(t.createdAt) >= weekStart));
  const monthPnl = calcPnl(allTrades.filter(t => new Date(t.createdAt) >= monthStart));
  const totalPnl = calcPnl(allTrades);

  const sells = allTrades.filter(t => t.side === "sell");
  const wins = sells.filter(t => parseFloat(t.pnl ?? "0") > 0);
  const winRate = sells.length > 0 ? ((wins.length / sells.length) * 100).toFixed(1) : "0";

  const byStrategy: Record<string, { pnl: number; count: number }> = {};
  for (const t of sells) {
    const key = t.strategy ?? "unknown";
    if (!byStrategy[key]) byStrategy[key] = { pnl: 0, count: 0 };
    byStrategy[key].pnl += parseFloat(t.pnl ?? "0");
    byStrategy[key].count++;
  }

  let stratLines = "";
  for (const [s, d] of Object.entries(byStrategy).sort((a, b) => b[1].pnl - a[1].pnl)) {
    stratLines += `\n  ${d.pnl >= 0 ? "🟢" : "🔴"} ${s}: $${d.pnl.toFixed(2)} (${d.count} trades)`;
  }

  return `📊 <b>PHANTOM — Estadísticas</b>\n\n` +
    `Hoy: ${todayPnl >= 0 ? "+" : ""}$${todayPnl.toFixed(2)}\n` +
    `Semana: ${weekPnl >= 0 ? "+" : ""}$${weekPnl.toFixed(2)}\n` +
    `Mes: ${monthPnl >= 0 ? "+" : ""}$${monthPnl.toFixed(2)}\n` +
    `Total: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}\n\n` +
    `Win Rate: ${winRate}% (${sells.length} ventas)\n` +
    `${stratLines}\n\n<i>PHANTOM v12.0</i>`;
}

// ─── Daily Summary ───
async function sendDailySummary(engine: EngineState) {
  if (!engine.telegramBotToken || !engine.telegramChatId) return;
  try {
    const allTrades = await db.getUserTrades(engine.userId, 5000);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayTrades = allTrades.filter(t => new Date(t.createdAt) >= todayStart);
    const todaySells = todayTrades.filter(t => t.side === "sell");
    const todayPnl = todaySells.reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0);
    const todayWins = todaySells.filter(t => parseFloat(t.pnl ?? "0") > 0);
    const winRate = todaySells.length > 0 ? ((todayWins.length / todaySells.length) * 100).toFixed(1) : "0";

    const state = await db.getOrCreateBotState(engine.userId);
    const initialDeposit = parseFloat(state?.initialBalance ?? "2500");
    const gridCount = Object.values(engine.openBuyPositions).reduce((s, a) => s + a.length, 0);
    const scalpCount = Object.values(engine.scalpPositions).reduce((s, a) => s + a.length, 0);

    let realBalance = parseFloat(state?.currentBalance ?? "0");
    try {
      if (!engine.simulationMode) {
        const res = await withRetry(() => engine.client.getWalletBalance({ accountType: "UNIFIED" }), "DailySummary balance");
        if (res.retCode === 0) realBalance = parseFloat((res.result as any)?.list?.[0]?.totalEquity ?? "0");
      }
    } catch { /* skip */ }

    const totalProfit = realBalance - initialDeposit;
    const message = `📋 <b>PHANTOM — Resumen Diario</b>\n\n` +
      `${todayPnl >= 0 ? "🟢" : "🔴"} PnL Hoy: ${todayPnl >= 0 ? "+" : ""}$${todayPnl.toFixed(2)}\n` +
      `Operaciones: ${todayTrades.length} (${todaySells.length} ventas)\nWin Rate: ${winRate}%\n\n` +
      `📦 Posiciones: Grid=${gridCount} Scalp=${scalpCount}\n` +
      `💰 Balance: $${realBalance.toFixed(2)}\n` +
      `📈 Ganancia Total: ${totalProfit >= 0 ? "+" : ""}$${totalProfit.toFixed(2)}\n\n` +
      `—\n<i>PHANTOM v12.0 • Resumen automático</i>`;

    await sendTelegramNotification(engine, message);
    await db.upsertDailyPnl(engine.userId, parseFloat(state?.totalPnl ?? "0"), realBalance, state?.totalTrades ?? 0);
  } catch (e) {
    console.error("[DailySummary] Error:", (e as Error).message);
  }
}

// ─── Weekly Summary ───
async function sendWeeklySummary(engine: EngineState) {
  if (!engine.telegramBotToken || !engine.telegramChatId) return;
  try {
    const allTrades = await db.getUserTrades(engine.userId, 10000);
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 7);
    const weekTrades = allTrades.filter(t => new Date(t.createdAt) >= weekStart && t.side === "sell");
    const weekTotal = weekTrades.reduce((s, t) => s + parseFloat(t.pnl ?? "0"), 0);

    const state = await db.getOrCreateBotState(engine.userId);
    const initialDeposit = parseFloat(state?.initialBalance ?? "2500");
    let realBalance = parseFloat(state?.currentBalance ?? "0");
    try {
      if (!engine.simulationMode) {
        const res = await withRetry(() => engine.client.getWalletBalance({ accountType: "UNIFIED" }), "WeeklySummary balance");
        if (res.retCode === 0) realBalance = parseFloat((res.result as any)?.list?.[0]?.totalEquity ?? "0");
      }
    } catch { /* skip */ }

    const weeklyROI = initialDeposit > 0 ? ((weekTotal / initialDeposit) * 100).toFixed(2) : "0";
    const avgDaily = weekTotal / 7;

    const message = `📈 <b>PHANTOM — Resumen Semanal</b>\n\n` +
      `💰 PnL Semanal: ${weekTotal >= 0 ? "+" : ""}$${weekTotal.toFixed(2)} (${weeklyROI}%)\n` +
      `📊 Promedio diario: ${avgDaily >= 0 ? "+" : ""}$${avgDaily.toFixed(2)}\n` +
      `📅 Proyección mensual: ${(avgDaily * 30) >= 0 ? "+" : ""}$${(avgDaily * 30).toFixed(2)}\n\n` +
      `💵 Balance: $${realBalance.toFixed(2)}\n` +
      `📈 Ganancia total: ${(realBalance - initialDeposit) >= 0 ? "+" : ""}$${(realBalance - initialDeposit).toFixed(2)}\n\n` +
      `—\n<i>PHANTOM v12.0 • Resumen semanal</i>`;

    await sendTelegramNotification(engine, message);
  } catch (e) {
    console.error("[WeeklySummary] Error:", (e as Error).message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ─── EXPORTS ───
// ═══════════════════════════════════════════════════════════════
export async function stopEngine(userId: number): Promise<{ success: boolean }> {
  const engine = engines.get(userId);
  if (!engine) return { success: true };

  engine.isRunning = false;
  if (engine.intervalId) clearInterval(engine.intervalId);
  if (engine.scannerIntervalId) clearInterval(engine.scannerIntervalId);
  if (engine.priceIntervalId) clearInterval(engine.priceIntervalId);
  if (engine.dailySummaryId) clearInterval(engine.dailySummaryId);
  if (engine.telegramPollingId) clearInterval(engine.telegramPollingId);
  if (engine.autoReinvestId) clearInterval(engine.autoReinvestId);

  // Save positions to DB
  try {
    const posCount = Object.values(engine.openBuyPositions).reduce((sum, arr) => sum + arr.length, 0);
    if (posCount > 0) {
      await db.saveOpenPositions(userId, engine.openBuyPositions, "bybit");
      console.log(`[Engine] Saved ${posCount} positions to DB`);
    }
  } catch (e) {
    console.error("[Engine] Failed to save positions:", (e as Error).message);
  }

  engines.delete(userId);
  engineCycles.delete(userId);
  await db.updateBotState(userId, { isRunning: false });
  console.log(`[Engine] Stopped for user ${userId}`);
  return { success: true };
}

export async function emergencyStopEngine(userId: number): Promise<{ success: boolean }> {
  await stopEngine(userId);
  await db.updateBotState(userId, { isRunning: false, dailyLoss: "0" });
  console.log(`[Engine] EMERGENCY STOP for user ${userId}`);
  return { success: true };
}

export function getLivePrices(): Record<string, TickerData> {
  const result: Record<string, TickerData> = {};
  livePrices.forEach((v, k) => { result[k] = v; });
  return result;
}

export function isEngineRunning(userId: number): boolean {
  return engines.has(userId);
}

export function getEngineCycles(userId: number): number {
  return engineCycles.get(userId) ?? 0;
}

export function getOpenPositions(userId: number): { grid: { symbol: string; buyPrice: number; currentPrice: number; qty: string; unrealizedPnl: number; holdTime: number; highestPrice: number }[]; futures: { symbol: string; entryPrice: number; currentPrice: number; qty: string; leverage: number; unrealizedPnl: number; holdTime: number }[]; shorts: { symbol: string; entryPrice: number; currentPrice: number; qty: string; unrealizedPnl: number; holdTime: number; lowestPrice: number; strategy: string }[] } {
  const engine = engines.get(userId);
  if (!engine) return { grid: [], futures: [], shorts: [] };

  const gridPositions: any[] = [];
  for (const [symbol, positions] of Object.entries(engine.openBuyPositions)) {
    const currentPrice = engine.lastPrices[symbol] ?? livePrices.get(symbol)?.lastPrice ?? 0;
    for (const pos of positions) {
      gridPositions.push({
        symbol, buyPrice: pos.buyPrice, currentPrice, qty: pos.qty,
        unrealizedPnl: (currentPrice - pos.buyPrice) * parseFloat(pos.qty),
        holdTime: Date.now() - (pos.openedAt ?? Date.now()),
        highestPrice: pos.highestPrice ?? currentPrice,
      });
    }
  }

  // Scalp positions shown as grid for simplicity
  for (const [symbol, positions] of Object.entries(engine.scalpPositions)) {
    const currentPrice = engine.lastPrices[symbol] ?? livePrices.get(symbol)?.lastPrice ?? 0;
    for (const pos of positions) {
      gridPositions.push({
        symbol, buyPrice: pos.buyPrice, currentPrice, qty: pos.qty,
        unrealizedPnl: (currentPrice - pos.buyPrice) * parseFloat(pos.qty),
        holdTime: Date.now() - pos.openedAt,
        highestPrice: pos.highestPrice ?? currentPrice,
      });
    }
  }

  // Short positions
  const shortPositions: any[] = [];
  for (const [symbol, positions] of Object.entries(engine.shortPositions)) {
    const currentPrice = engine.lastPrices[symbol] ?? livePrices.get(symbol)?.lastPrice ?? 0;
    for (const pos of positions) {
      shortPositions.push({
        symbol, entryPrice: pos.entryPrice, currentPrice, qty: pos.qty,
        unrealizedPnl: (pos.entryPrice - currentPrice) * parseFloat(pos.qty),
        holdTime: Date.now() - pos.openedAt,
        lowestPrice: pos.lowestPrice ?? currentPrice,
        strategy: pos.strategy,
      });
    }
  }

  return { grid: gridPositions, futures: [], shorts: shortPositions };
}

// ═══════════════════════════════════════════════════════════════
// ─── WEBSOCKET PRICE FEED (Bybit only) ───
// ═══════════════════════════════════════════════════════════════
let wsSpot: WebSocket | null = null;
let wsLinear: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsInitialized = false;

const SPOT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const LINEAR_SYMBOLS = ["XAUUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT"];

function parseWsTickerMsg(data: Buffer | string): void {
  try {
    const msg = JSON.parse(data.toString()) as any;
    if (!msg.data) return;
    const t = msg.data;
    if (!t.symbol || !t.lastPrice) return;
    const existing = livePrices.get(t.symbol);
    livePrices.set(t.symbol, {
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      bid1Price: parseFloat(t.bid1Price ?? t.lastPrice),
      ask1Price: parseFloat(t.ask1Price ?? t.lastPrice),
      price24hPcnt: parseFloat(t.price24hPcnt ?? existing?.price24hPcnt ?? "0"),
      highPrice24h: parseFloat(t.highPrice24h ?? existing?.highPrice24h ?? t.lastPrice),
      lowPrice24h: parseFloat(t.lowPrice24h ?? existing?.lowPrice24h ?? t.lastPrice),
      volume24h: parseFloat(t.volume24h ?? existing?.volume24h ?? "0"),
      turnover24h: parseFloat(t.turnover24h ?? existing?.turnover24h ?? "0"),
    });
  } catch { /* ignore */ }
}

function connectBybitWS(url: string, symbols: string[], label: string): WebSocket {
  const ws = new WebSocket(url);
  ws.on("open", () => {
    console.log(`[PriceFeed] ${label} WS connected — ${symbols.length} symbols`);
    const args = symbols.map(s => `tickers.${s}`);
    for (let i = 0; i < args.length; i += 10) {
      ws.send(JSON.stringify({ op: "subscribe", args: args.slice(i, i + 10) }));
    }
  });
  ws.on("message", (data) => {
    parseWsTickerMsg(data as Buffer);
    if (!wsInitialized && livePrices.size >= 2) {
      wsInitialized = true;
      console.log(`[PriceFeed] Initial prices loaded (${livePrices.size} symbols)`);
    }
  });
  ws.on("error", (e) => console.error(`[PriceFeed] ${label} error:`, e.message));
  ws.on("close", () => {
    console.warn(`[PriceFeed] ${label} closed — reconnecting in 5s`);
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(() => startBybitWebSocketFeed(), 5000);
  });
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: "ping" }));
    else clearInterval(pingInterval);
  }, 20_000);
  return ws;
}

export function startBackgroundPriceFeed() {
  startBybitWebSocketFeed();
}

function startBybitWebSocketFeed() {
  if (wsSpot && wsSpot.readyState !== WebSocket.CLOSED) wsSpot.terminate();
  if (wsLinear && wsLinear.readyState !== WebSocket.CLOSED) wsLinear.terminate();
  console.log("[PriceFeed] Starting Bybit WebSocket feed...");
  wsSpot = connectBybitWS("wss://stream.bybit.com/v5/public/spot", SPOT_SYMBOLS, "Spot");
  wsLinear = connectBybitWS("wss://stream.bybit.com/v5/public/linear", LINEAR_SYMBOLS, "Linear");
}

// Auto-start on module load
startBybitWebSocketFeed();
