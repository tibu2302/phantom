import { autoConvertCoinsToUSDT } from "./autoConvert";
/**
 * PHANTOM Trading Engine — Multi-Exchange (Bybit + KuCoin)
 * Grid Trading, Scalping, Futures Long-Only
 * Full feature set: Trailing Stop, DCA, Multi-Timeframe, Volume Filter,
 * Trading Hours, Dynamic Grid, Auto-Reinvestment, Telegram Notifications
 *
 * v5.0 — Complete Upgrade:
 *  - Trailing Stop on Grid sells (follow price up, sell on reversal)
 *  - Reinvestment: profits increase order sizes automatically
 *  - Dynamic Grid: spread adjusts based on market volatility
 *  - Scalping on BTC, ETH, SOL (in addition to XAU)
 *  - Telegram notifications on completed cycles
 *  - Trading hours filter (9am-5pm NY = high volume)
 *  - Volume filter (skip low-liquidity periods)
 *  - Futures Long-Only with Take Profit (no stop loss)
 *  - DCA: accumulate on dips, sell on recovery
 *  - Multi-Timeframe Analysis (1m, 15m, 1h alignment)
 *  - New coins: SOL, XRP, DOGE, ADA, AVAX, LINK, ARB, SUI
 */
import { RestClientV5 } from "bybit-api";
import * as db from "./db";
import { WebSocket } from "ws";
import {
  calculateSignalScore, calculateATR, calculateATRPercent, calculateADX,
  detectMarketRegime, findSupportResistance, recordTradeResult, getLossCooldownMultiplier,
  type MarketRegime, type SignalScore
} from "./smartAnalysis";
import {
  updateBTCState, getBTCCorrelationFilter, detectVolumeSpike,
  getOrderBookImbalance, getFundingRateSignal, detectSqueeze,
  detectMeanReversion, detectBreakout, detectManipulation,
  calculateAdaptiveGrid, getCurrentSession, getIntradayMomentumBoost,
  updateDrawdownState, getDrawdownMultiplier, resetDailyDrawdown,
  checkDiversification, updateSymbolExposure, clearSymbolExposure,
  recordStrategyPerformance, getCapitalAllocation, kellyOptimalSize,
  scanArbitrage, updateArbPrice, aggregateMasterSignal,
  type MasterSignal, type MarketSession
} from "./marketIntelligence";
import {
  analyzeSentiment, getFearGreedSignal, fetchFearGreedIndex,
  detectCandlePatterns, detectAnomaly, recordTradeForLearning,
  getRLMultiplier, getLearningInsights, getAISignal,
  type AISignal, type SentimentResult, type PatternResult, type AnomalyResult
} from "./aiEngine";
import {
  getAdvancedDataSignal, getOnChainSignal, getOpenInterestSignal,
  detectWhaleActivity, getCrossExchangeSignal,
  type AdvancedDataSignal
} from "./advancedData";
import {
  getAdvancedStrategySignal, updatePairPrice, updateMomentumData,
  calculateSmartExit, type AdvancedStrategySignal
} from "./advancedStrategies";
import {
  autoTuneParameters, recordTradeForTuning, getAdaptiveState,
  recordTradeResult as recordTradeResultOptimizer, getOptimizerSignal,
  recordDailyReturn, generatePerformanceReport,
  type OptimizerSignal
} from "./autoOptimizer";
import {
  analyzeStrategyPerformance, rebalanceCapital, checkAutoReinvest,
  calculateDynamicTrailingStop, getXAUBoostMultiplier, getTrendingGridAdjustment,
  buildOpportunityAlert, buildStatsReport, isNocturnalHours, getNocturnalMultiplier,
  VOLATILE_SCALPING_PAIRS, type AllocatorState, type StrategyPerformance
} from "./capitalAllocator";
import {
  detectBreakoutSignal, detectMeanReversion as detectMeanReversionPM,
  analyzeFundingArbitrage, detectLiquidationOpportunity,
  analyzeVolumeProfile, detectCorrelationArbitrage,
  getMarketTimingSignal, analyzeMultiTFAlignment,
  analyzeStalePosition, analyzeLiquidity,
  getProfitMaximizerSignal, recordTradeForTiming,
  type ProfitMaximizerSignal
} from "./profitMaximizer";

// ─── Fee Constants (per exchange) ───
const FEES: Record<string, { spot: number; linear: number }> = {
  bybit:  { spot: 0.001,   linear: 0.00055 },  // 0.1% / 0.055%
  kucoin: { spot: 0.001,   linear: 0.0006  },  // 0.1% / 0.06%
};
const SPOT_FEE_RATE = 0.001;
const LINEAR_FEE_RATE = 0.00055;

// ─── Types ───
interface TickerData {
  symbol: string;
  lastPrice: number;
  bid1Price: number;
  ask1Price: number;
  price24hPcnt: number;
  highPrice24h: number;
  lowPrice24h: number;
  volume24h: number;
  turnover24h: number;
}

interface ScalpPosition {
  symbol: string;
  buyPrice: number;
  qty: string;
  orderId: string;
  exchange: string; // "bybit" | "kucoin"
  category: "spot" | "linear";
  openedAt: number;
  highestPrice?: number; // for dynamic trailing stop
  trailingActivated?: boolean; // trailing stop active
}

interface GridLevel {
  price: number;
  side: "Buy" | "Sell";
  filled: boolean;
  orderId?: string;
  filledPrice?: number;
  qty?: string;
}

interface OpenBuyPosition {
  symbol: string;
  buyPrice: number;
  qty: string;
  tradeAmount: number;
  category: "spot" | "linear";
  gridLevelPrice: number;
  // Trailing stop fields
  highestPrice?: number; // highest price since buy (for trailing)
  // Stop-loss fields
  openedAt: number; // timestamp when position was opened
  stopLossPct?: number; // custom stop-loss % (default from config)
}

interface FuturesPosition {
  symbol: string;
  entryPrice: number;
  qty: string;
  leverage: number;
  takeProfitPct: number;
  tradeAmount: number;
  openedAt: number;
  direction: "long" | "short";
  highestPrice?: number;  // for long trailing stop
  lowestPrice?: number;   // for short trailing stop
}

export interface EngineState {
  userId: number;
  exchange: string; // "bybit" | "kucoin" | "both"
  client: RestClientV5;
  kucoinClient: any | null;
  isRunning: boolean;
  simulationMode: boolean;
  gridLevels: Record<string, GridLevel[]>;
  lastPrices: Record<string, number>;
  openBuyPositions: Record<string, OpenBuyPosition[]>;
  futuresPositions: Record<string, FuturesPosition[]>;
  dcaPositions: Record<string, { avgPrice: number; totalQty: number; totalCost: number; entries: number }>;
  scalpPositions: Record<string, ScalpPosition[]>;
  intervalId?: ReturnType<typeof setInterval>;
  scannerIntervalId?: ReturnType<typeof setInterval>;
  priceIntervalId?: ReturnType<typeof setInterval>;
  dailySummaryId?: ReturnType<typeof setInterval>;
  telegramPollingId?: ReturnType<typeof setInterval>;
  autoReinvestId?: ReturnType<typeof setInterval>;
  telegramPollingOffset?: number;
  lastDrawdownAlertDate?: string; // YYYY-MM-DD to avoid spam
  lastReinvestDate?: string; // YYYY-MM-DD to avoid double reinvest
  telegramChatId?: string;
  telegramBotToken?: string;
}

// ─── Global State ───
const engines: Map<number, EngineState> = new Map();
const livePrices: Map<string, TickerData> = new Map();
const engineCycles: Map<number, number> = new Map();
// Anti-spam: track last error notification per symbol+side to avoid flooding Telegram
const lastErrorNotif: Map<string, number> = new Map();
const ERROR_NOTIF_COOLDOWN = 1_800_000; // 30 minutes between same error notifications
// Balance errors: only notify ONCE per bot session (these are persistent, won't resolve on their own)
const balanceErrorNotified: Set<string> = new Set();

function shouldNotifyError(key: string, isBalanceError = false): boolean {
  // Balance errors: NEVER notify via Telegram (only logged to console)
  // These are persistent issues that won't resolve on their own
  if (isBalanceError) return false;
  // Other errors: 30 min cooldown
  const now = Date.now();
  const last = lastErrorNotif.get(key) ?? 0;
  if (now - last < ERROR_NOTIF_COOLDOWN) return false;
  lastErrorNotif.set(key, now);
  return true;
}

// ─── Network Error Detection & Retry ───
const NETWORK_ERROR_CODES = ["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"];

function isNetworkError(err: unknown): boolean {
  const msg = (err as any)?.message ?? String(err);
  const code = (err as any)?.code ?? "";
  return NETWORK_ERROR_CODES.some(c => msg.includes(c) || code === c) || msg.includes("fetch failed") || msg.includes("network");
}

export async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isNetworkError(e) || attempt === maxRetries) throw e;
      const delayMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      console.warn(`[Retry] ${label} attempt ${attempt}/${maxRetries} failed (${(e as Error).message}), retrying in ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export function getEngineCycles(userId: number): number {
  return engineCycles.get(userId) ?? 0;
}

// Coins to scan for opportunities
const SCANNER_COINS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT",
  "ADAUSDT", "AVAXUSDT", "LINKUSDT", "ARBUSDT", "SUIUSDT",
];

// ─── Trading Hours Filter ───
// High volume hours: 9am-5pm New York (EST/EDT)
function isHighVolumeHours(): boolean {
  const now = new Date();
  // Get NY time (UTC-5 in winter, UTC-4 in summer)
  const nyOffset = isDST(now) ? -4 : -5;
  const nyHour = (now.getUTCHours() + nyOffset + 24) % 24;
  return nyHour >= 9 && nyHour < 17;
}

function isDST(date: Date): boolean {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return Math.max(jan, jul) !== date.getTimezoneOffset();
}

// ─── Volume Filter ───
function hasAdequateVolume(symbol: string): boolean {
  const ticker = livePrices.get(symbol);
  if (!ticker) return true; // allow if no data
  // Minimum 24h turnover thresholds (in USDT)
  const minTurnover: Record<string, number> = {
    BTCUSDT: 50_000_000,
    ETHUSDT: 20_000_000,
    XAUUSDT: 5_000_000,
    default: 1_000_000,
  };
  const threshold = minTurnover[symbol] ?? minTurnover.default;
  return ticker.turnover24h >= threshold;
}

// ─── Telegram Notifications ───
async function sendTelegramNotification(engine: EngineState, message: string) {
  if (!engine.telegramBotToken || !engine.telegramChatId) return;
  try {
    const url = `https://api.telegram.org/bot${engine.telegramBotToken}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: engine.telegramChatId,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch (e) {
    console.error("[Telegram] Failed to send notification:", (e as Error).message);
  }
}

// ─── Technical Indicators ───
function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calculateBollingerBands(closes: number[], period = 20, stdDev = 2) {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: mean + stdDev * std, middle: mean, lower: mean - stdDev * std };
}

function calculateMACD(closes: number[]) {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calculateEMA(macdLine.slice(-9), 9);
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { macd, signal, histogram: macd - signal };
}

// ─── Volatility Calculator (for Dynamic Grid) ───
function calculateVolatility(closes: number[]): number {
  if (closes.length < 10) return 0.01; // default 1%
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.abs(closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  return avg;
}

// ─── Multi-Timeframe Analysis ───
// Returns true if all timeframes agree on direction
async function multiTimeframeCheck(client: RestClientV5 | null, symbol: string, category: "spot" | "linear"): Promise<{ aligned: boolean; direction: "bullish" | "bearish" | "mixed" }> {
  try {
    // Use cached klines at different intervals
    const klines15m = await fetchKlines(client, symbol, "15", 60, category);
    const klines1h = await fetchKlines(client, symbol, "60", 60, category);
    
    if (klines15m.closes.length < 50 || klines1h.closes.length < 30) {
      return { aligned: true, direction: "mixed" }; // allow trading if data insufficient
    }

    // Check trend on each timeframe using EMA 20/50
    const check = (closes: number[]) => {
      const ema20 = calculateEMA(closes, 20);
      const ema50 = calculateEMA(closes, Math.min(50, closes.length));
      const e20 = ema20[ema20.length - 1];
      const e50 = ema50[ema50.length - 1];
      if (e20 > e50 * 1.001) return "bullish";
      if (e20 < e50 * 0.999) return "bearish";
      return "neutral";
    };

    const tf15m = check(klines15m.closes);
    const tf1h = check(klines1h.closes);

    // Aligned if both non-bearish (bullish or neutral)
    if (tf15m !== "bearish" && tf1h !== "bearish") {
      return { aligned: true, direction: "bullish" };
    }
    // Both bearish
    if (tf15m === "bearish" && tf1h === "bearish") {
      return { aligned: true, direction: "bearish" };
    }
    return { aligned: false, direction: "mixed" };
  } catch {
    return { aligned: true, direction: "mixed" }; // allow on error
  }
}

// ─── Bybit API Helpers ───
async function fetchTicker(_client: RestClientV5 | null, symbol: string, category: "spot" | "linear" = "spot"): Promise<TickerData | null> {
  const cached = livePrices.get(symbol);
  if (cached) return cached;
  try {
    const url = `https://api.bybit.com/v5/market/tickers?category=${category}&symbol=${symbol}`;
    const res = await withRetry(() => fetch(url, { signal: AbortSignal.timeout(5000) }), `fetchTicker ${symbol}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as any;
    const t = data?.result?.list?.[0];
    if (!t) return null;
    const ticker: TickerData = {
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      bid1Price: parseFloat(t.bid1Price ?? t.lastPrice),
      ask1Price: parseFloat(t.ask1Price ?? t.lastPrice),
      price24hPcnt: parseFloat(t.price24hPcnt ?? "0"),
      highPrice24h: parseFloat(t.highPrice24h ?? t.lastPrice),
      lowPrice24h: parseFloat(t.lowPrice24h ?? t.lastPrice),
      volume24h: parseFloat(t.volume24h ?? "0"),
      turnover24h: parseFloat(t.turnover24h ?? "0"),
    };
    livePrices.set(symbol, ticker);
    return ticker;
  } catch (e) {
    console.error(`[Engine] Failed to fetch ticker ${symbol}:`, (e as Error).message);
    return null;
  }
}

interface KlineData {
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
}

// ─── CoinGecko Cache (5-minute TTL) ───
interface CacheEntry {
  data: KlineData;
  expiresAt: number;
}
const klineCache: Map<string, CacheEntry> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

const COINGECKO_IDS: Record<string, string> = {
  BTCUSDT: "bitcoin", ETHUSDT: "ethereum", SOLUSDT: "solana",
  BNBUSDT: "binancecoin", ADAUSDT: "cardano", DOGEUSDT: "dogecoin",
  XRPUSDT: "ripple", AVAXUSDT: "avalanche-2", DOTUSDT: "polkadot",
  MATICUSDT: "matic-network", LINKUSDT: "chainlink", LTCUSDT: "litecoin",
  UNIUSDT: "uniswap", ATOMUSDT: "cosmos", NEARUSDT: "near",
  FTMUSDT: "fantom", AAVEUSDT: "aave", ALGOUSDT: "algorand",
  ICPUSDT: "internet-computer", FILUSDT: "filecoin", XLMUSDT: "stellar",
  VETUSDT: "vechain", TRXUSDT: "tron", EOSUSDT: "eos",
  SANDUSDT: "the-sandbox", MANAUSDT: "decentraland", AXSUSDT: "axie-infinity",
  GALAUSDT: "gala", CHZUSDT: "chiliz", APEUSDT: "apecoin",
  OPUSDT: "optimism", ARBUSDT: "arbitrum", SHIBUSDT: "shiba-inu",
  APTUSDT: "aptos", SUIUSDT: "sui", SEIUSDT: "sei-network",
  TIAUSDT: "celestia", INJUSDT: "injective-protocol", FETUSDT: "fetch-ai",
  RENDERUSDT: "render-token", WIFUSDT: "dogwifcoin", PEPEUSDT: "pepe",
  FLOKIUSDT: "floki", BONKUSDT: "bonk", JUPUSDT: "jupiter-exchange-solana",
  MKRUSDT: "maker",
};
const YAHOO_TICKERS: Record<string, string> = {
  XAUUSDT: "GC=F",
  XAGUSD: "SI=F",
  SPXUSDT: "%5EGSPC",
};

// Bybit klines API as fallback for linear symbols
const BYBIT_KLINE_SYMBOLS = new Set(["XAUUSDT", "SPXUSDT", "SP500USDT", "BTCUSDT", "ETHUSDT", "SOLUSDT"]);

async function fetchKlines(_client: RestClientV5 | null, symbol: string, _interval: any = "15", limit: number = 50, _category: "spot" | "linear" = "spot"): Promise<KlineData> {
  // Check cache first
  const cacheKey = `${symbol}_${_interval}_${limit}`;
  const cached = klineCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // ─── Source 1: Bybit REST API (PREFERRED — works on VPS, no rate limits) ───
  const bybitCategory = _category === "linear" ? "linear" : "spot";
  try {
    const intervalMap: Record<string, string> = { "1": "1", "5": "5", "15": "15", "60": "60", "240": "240" };
    const bybitInterval = intervalMap[_interval] ?? "15";
    const bybitUrl = `https://api.bybit.com/v5/market/kline?category=${bybitCategory}&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`;
    const res = await withRetry(() => fetch(bybitUrl, { signal: AbortSignal.timeout(8000) }), `fetchKlines ${symbol}`);
    if (res.ok) {
      const data = await res.json() as any;
      const klines = data?.result?.list;
      if (klines && klines.length > 0) {
        const reversed = [...klines].reverse();
        const result: KlineData = {
          opens: reversed.map((k: string[]) => parseFloat(k[1])),
          highs: reversed.map((k: string[]) => parseFloat(k[2])),
          lows: reversed.map((k: string[]) => parseFloat(k[3])),
          closes: reversed.map((k: string[]) => parseFloat(k[4])),
          volumes: reversed.map((k: string[]) => parseFloat(k[5])),
        };
        klineCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
        return result;
      }
    }
  } catch (e) {
    console.warn(`[Engine] Bybit klines ${symbol}:`, (e as Error).message);
  }

  // ─── Source 2: Yahoo Finance (for TradFi symbols) ───
  const yahooTicker = YAHOO_TICKERS[symbol];
  if (yahooTicker) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?interval=30m&range=5d`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
      const data = await res.json() as any;
      const result = data?.chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0] ?? {};
      const closes = (quote.close ?? []).filter((c: any) => c != null);
      const opens = (quote.open ?? []).filter((c: any) => c != null);
      const yahooHighs = (quote.high ?? []).filter((c: any) => c != null);
      const yahooLows = (quote.low ?? []).filter((c: any) => c != null);
      const volumes = (quote.volume ?? []).filter((v: any) => v != null);
      if (closes.length > 0) {
        const klineResult: KlineData = {
          opens: opens.slice(-limit).length > 0 ? opens.slice(-limit) : closes.slice(-limit),
          highs: yahooHighs.slice(-limit).length > 0 ? yahooHighs.slice(-limit) : closes.slice(-limit),
          lows: yahooLows.slice(-limit).length > 0 ? yahooLows.slice(-limit) : closes.slice(-limit),
          closes: closes.slice(-limit),
          volumes: volumes.slice(-limit),
        };
        klineCache.set(cacheKey, { data: klineResult, expiresAt: Date.now() + CACHE_TTL_MS });
        return klineResult;
      }
    } catch (e) {
      console.warn(`[Engine] Yahoo klines ${symbol}:`, (e as Error).message);
    }
  }

  // ─── Source 3: CoinGecko (LAST RESORT — has aggressive rate limits) ───
  const geckoId = COINGECKO_IDS[symbol];
  if (geckoId) {
    const days = limit <= 48 ? 1 : limit <= 96 ? 2 : 7;
    const url = `https://api.coingecko.com/api/v3/coins/${geckoId}/ohlc?vs_currency=usd&days=${days}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json() as number[][];
        const sliced = data.slice(-limit);
        const result: KlineData = {
          opens: sliced.map(k => k[1]),
          highs: sliced.map(k => k[2]),
          lows: sliced.map(k => k[3]),
          closes: sliced.map(k => k[4]),
          volumes: sliced.map(() => 1000),
        };
        klineCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
        return result;
      }
      if (res.status === 429) {
        console.warn(`[Engine] CoinGecko 429 for ${symbol} — using Bybit/synthetic fallback`);
      }
    } catch (e) {
      console.warn(`[Engine] CoinGecko klines ${symbol}:`, (e as Error).message);
    }
  }

  // ─── Source 4: Synthetic klines from WebSocket price ───
  const cachedPrice = livePrices.get(symbol);
  if (cachedPrice) {
    const base = cachedPrice.lastPrice;
    const synCloses = Array.from({ length: limit }, () => base * (1 + (Math.random() - 0.5) * 0.002));
    return {
      opens: synCloses.map(c => c * (1 + (Math.random() - 0.5) * 0.001)),
      highs: synCloses.map(c => c * (1 + Math.random() * 0.002)),
      lows: synCloses.map(c => c * (1 - Math.random() * 0.002)),
      closes: synCloses,
      volumes: Array(limit).fill(1000),
    };
  }
  return { opens: [], highs: [], lows: [], closes: [], volumes: [] };
}

// ─── v9.0: USDT LIQUIDITY MANAGEMENT ───
// Rule: maintain minimum 60% of capital in USDT available
// Don't buy more altcoins if USDT < threshold
// For big opportunities → use futures (USDT-settled) instead of spot
const USDT_MIN_RESERVE_PCT = 0.0; // v10.1: NO RESERVE — deploy 100% of capital
const USDT_CHECK_CACHE: { lastCheck: number; bybitUsdt: number; kucoinUsdt: number; totalBalance: number } = {
  lastCheck: 0, bybitUsdt: 0, kucoinUsdt: 0, totalBalance: 0
};

async function getUsdtAvailable(engine: EngineState): Promise<{ bybitUsdt: number; kucoinUsdt: number; totalUsdt: number; totalBalance: number; usdtPct: number }> {
  // Cache for 30 seconds to avoid hammering APIs
  if (Date.now() - USDT_CHECK_CACHE.lastCheck < 30_000 && USDT_CHECK_CACHE.totalBalance > 0) {
    const totalUsdt = USDT_CHECK_CACHE.bybitUsdt + USDT_CHECK_CACHE.kucoinUsdt;
    return {
      bybitUsdt: USDT_CHECK_CACHE.bybitUsdt,
      kucoinUsdt: USDT_CHECK_CACHE.kucoinUsdt,
      totalUsdt,
      totalBalance: USDT_CHECK_CACHE.totalBalance,
      usdtPct: USDT_CHECK_CACHE.totalBalance > 0 ? totalUsdt / USDT_CHECK_CACHE.totalBalance : 1,
    };
  }
  let bybitUsdt = 0, kucoinUsdt = 0, totalBal = 0;
  try {
    if (engine.client) {
      const res = await withRetry(() => engine.client.getWalletBalance({ accountType: "UNIFIED" }), "USDT check Bybit");
      if (res.retCode === 0) {
        const coins = (res.result as any)?.list?.[0]?.coin ?? [];
        for (const c of coins) {
          if (c.coin === "USDT") bybitUsdt = parseFloat(c.availableToWithdraw ?? c.walletBalance ?? "0");
        }
        totalBal += parseFloat((res.result as any)?.list?.[0]?.totalEquity ?? "0");
      }
    }
  } catch { /* silent */ }
  try {
    if (engine.kucoinClient) {
      const tradeRes = await withRetry(() => engine.kucoinClient!.getBalances({ type: "trade" }), "USDT check KuCoin");
      if ((tradeRes as any)?.code === "200000") {
        const prices = getLivePrices();
        for (const acc of ((tradeRes as any).data as any[] ?? [])) {
          const cur = acc.currency;
          const bal = parseFloat(acc.available ?? "0");
          if (cur === "USDT") kucoinUsdt += bal;
          const p = cur === "USDT" ? 1 : (prices[`${cur}USDT`]?.lastPrice ?? 0);
          totalBal += bal * p;
        }
      }
    }
  } catch { /* silent */ }
  USDT_CHECK_CACHE.lastCheck = Date.now();
  USDT_CHECK_CACHE.bybitUsdt = bybitUsdt;
  USDT_CHECK_CACHE.kucoinUsdt = kucoinUsdt;
  USDT_CHECK_CACHE.totalBalance = totalBal;
  const totalUsdt = bybitUsdt + kucoinUsdt;
  return {
    bybitUsdt, kucoinUsdt, totalUsdt, totalBalance: totalBal,
    usdtPct: totalBal > 0 ? totalUsdt / totalBal : 1,
  };
}

/** v10.1: USDT guard disabled — deploy 100% of capital. Always returns true. */
async function hasUsdtLiquidity(engine: EngineState, tradeAmount: number, strategy: string): Promise<boolean> {
  // v10.1: NO RESERVE — use all capital, always allow trades
  return true;
}

/** v10.1: No longer redirect to futures — trade directly wherever signal appears */
function shouldUseFuturesForOpportunity(confidence: number, category: "spot" | "linear"): boolean {
  // v10.1: DISABLED — trade directly, don't redirect
  return false;
}

async function placeOrder(engine: EngineState, symbol: string, side: "Buy" | "Sell", qty: string, category: "spot" | "linear" = "spot"): Promise<string | null> {
  if (engine.simulationMode) {
    return `SIM_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  try {
    if (engine.exchange === "both") {
      const orderIds: string[] = [];
      // KuCoin (skip XAUUSDT and XAGUSD — not supported)
      // KuCoin minimum order sizes (in base currency)
      const KC_MIN_SIZE: Record<string, number> = {
        "BTC-USDT": 0.00001, "ETH-USDT": 0.0001, "SOL-USDT": 0.01,
        "XRP-USDT": 0.1, "ADA-USDT": 1, "DOGE-USDT": 1,
        "AVAX-USDT": 0.01, "LINK-USDT": 0.01, "ARB-USDT": 0.1,
        "SUI-USDT": 0.1, "OP-USDT": 0.1, "APT-USDT": 0.01,
        "SEI-USDT": 1, "SHIB-USDT": 1,
      };
      if (engine.kucoinClient && symbol !== "XAUUSDT" && symbol !== "XAGUSD" && symbol !== "SPXUSDT" && symbol !== "SP500USDT" && category === "spot") {
        try {
          const kucoinSymbol = symbol.replace("USDT", "-USDT");
          const minSize = KC_MIN_SIZE[kucoinSymbol] ?? 0.1;
          const qtyNum = parseFloat(qty);
          if (qtyNum < minSize) {
            console.log(`[Engine] SKIP KuCoin ${side} ${symbol} — qty ${qty} below min ${minSize}`);
          } else {
            // KuCoin market orders use 'funds' (USDT amount) instead of 'size' for buys
            const orderParams: any = {
              clientOid: `phantom_kc_${Date.now()}`,
              side: side.toLowerCase(),
              symbol: kucoinSymbol,
              type: "market",
            };
            if (side === "Buy") {
              // For market buys, use 'funds' (USDT amount) — more reliable than 'size'
              const price = engine.lastPrices[symbol] ?? 0;
              const funds = (qtyNum * price).toFixed(2);
              if (parseFloat(funds) < 1) {
                console.log(`[Engine] SKIP KuCoin ${side} ${symbol} — funds $${funds} below $1 minimum`);
              } else {
                orderParams.funds = funds;
                const res: any = await withRetry(() => engine.kucoinClient.submitOrder(orderParams), `KuCoin Buy ${symbol}`);
                const kcId = res?.data?.orderId;
                if (kcId) { orderIds.push(`KC:${kcId}`); console.log(`[Engine] BOTH/KuCoin order: ${side} ${symbol} funds=$${funds} id=${kcId}`); }
                else {
                  const errDetail = JSON.stringify(res?.data ?? res);
                  console.log(`[Engine] KuCoin order no ID: ${errDetail}`);
                  const isBal = true; // KuCoin no-ID = balance/rejection issue
                  if (shouldNotifyError(`kc_${symbol}_${side}_noId`, isBal)) {
                    await sendTelegramNotification(engine, `⚠️ <b>Orden Rechazada</b>\nExchange: KuCoin\nPar: ${symbol}\nLado: ${side}\nFunds: $${funds}\nError: ${errDetail}`);
                  }
                }
              }
            } else {
              orderParams.size = qty;
              const res: any = await withRetry(() => engine.kucoinClient.submitOrder(orderParams), `KuCoin Sell ${symbol}`);
              const kcId = res?.data?.orderId;
              if (kcId) { orderIds.push(`KC:${kcId}`); console.log(`[Engine] BOTH/KuCoin order: ${side} ${symbol} qty=${qty} id=${kcId}`); }
              else {
                const errDetail = JSON.stringify(res?.data ?? res);
                console.log(`[Engine] KuCoin order no ID: ${errDetail}`);
                const isBal2 = true; // KuCoin no-ID = balance/rejection issue
                if (shouldNotifyError(`kc_${symbol}_${side}_noId2`, isBal2)) {
                  await sendTelegramNotification(engine, `⚠️ <b>Orden Rechazada</b>\nExchange: KuCoin\nPar: ${symbol}\nLado: ${side}\nQty: ${qty}\nError: ${errDetail}`);
                }
              }
            }
          }
        } catch (e) {
          const errMsg = (e as Error).message;
          console.error(`[Engine] BOTH/KuCoin order failed:`, errMsg);
          const isBalanceErr = errMsg === "OK" || errMsg.includes("Balance insufficient") || errMsg.includes("balance");
          const isNetErr = isNetworkError(e);
          const nKey = `kc_${symbol}_${side}`;
          if (!isNetErr && shouldNotifyError(nKey, isBalanceErr)) {
            const reason = isBalanceErr ? "Balance insuficiente en KuCoin" : errMsg;
            await sendTelegramNotification(engine, `❌ <b>Orden Fallida</b>\nExchange: KuCoin\nPar: ${symbol}\nLado: ${side}\nQty: ${qty}\nRazón: ${reason}`);
          }
        }
      }
      // Bybit
      try {
        const res = await withRetry(() => engine.client.submitOrder({ category, symbol, side, orderType: "Market", qty }), `Bybit ${side} ${symbol}`);
        const bybitId = res.result?.orderId;
        if (bybitId) { orderIds.push(`BY:${bybitId}`); console.log(`[Engine] BOTH/Bybit order: ${side} ${symbol} qty=${qty} id=${bybitId}`); }
      } catch (e) {
        const errMsg = (e as Error).message;
        console.error(`[Engine] BOTH/Bybit order failed:`, errMsg);
        const isBalanceErr2 = errMsg.includes("Balance insufficient") || errMsg.includes("balance") || errMsg.includes("Insufficient");
        const isNetErr = isNetworkError(e);
        const nKey = `by_${symbol}_${side}`;
        if (!isNetErr && shouldNotifyError(nKey, isBalanceErr2)) {
          await sendTelegramNotification(engine, `❌ <b>Orden Fallida</b>\nExchange: Bybit\nPar: ${symbol}\nLado: ${side}\nQty: ${qty}\nError: ${errMsg}`);
        }
      }
      return orderIds.length > 0 ? orderIds.join(",") : null;
    } else if (engine.exchange === "kucoin" && engine.kucoinClient) {
      const kucoinSymbol = symbol.replace("USDT", "-USDT");
      // KuCoin minimum order sizes (in base currency)
      const KC_MIN_SIZE_KC: Record<string, number> = {
        "BTC-USDT": 0.00001, "ETH-USDT": 0.0001, "SOL-USDT": 0.01,
        "XRP-USDT": 0.1, "ADA-USDT": 1, "DOGE-USDT": 1,
        "AVAX-USDT": 0.01, "LINK-USDT": 0.01, "ARB-USDT": 0.1,
        "SUI-USDT": 0.1, "OP-USDT": 0.1, "APT-USDT": 0.01,
        "SEI-USDT": 1, "SHIB-USDT": 1,
      };
      const minSize = KC_MIN_SIZE_KC[kucoinSymbol] ?? 0.1;
      const qtyNum = parseFloat(qty);
      if (qtyNum < minSize) {
        console.log(`[Engine] SKIP KuCoin-only ${side} ${symbol} — qty ${qty} below min ${minSize}`);
        return null;
      }
      const orderParams: any = {
        clientOid: `phantom_${Date.now()}`,
        side: side.toLowerCase(),
        symbol: kucoinSymbol,
        type: "market",
      };
      // KuCoin market buys MUST use 'funds' (USDT amount), sells use 'size' (crypto qty)
      if (side === "Buy") {
        const price = engine.lastPrices[symbol] ?? 0;
        const funds = (qtyNum * price).toFixed(2);
        if (parseFloat(funds) < 1) {
          console.log(`[Engine] SKIP KuCoin-only ${side} ${symbol} — funds $${funds} below $1 minimum`);
          return null;
        }
        orderParams.funds = funds;
      } else {
        orderParams.size = qty;
      }
      const res: any = await withRetry(() => engine.kucoinClient.submitOrder(orderParams), `KuCoin-only ${side} ${symbol}`);
      const kcOrderId = res?.data?.orderId;
      if (kcOrderId) {
        console.log(`[Engine] KuCoin order OK: ${side} ${symbol} ${side === "Buy" ? `funds=$${orderParams.funds}` : `qty=${qty}`} id=${kcOrderId}`);
        return kcOrderId;
      } else {
        // KuCoin returned success HTTP but no orderId (insufficient balance, min size, etc.)
        const errMsg = res?.msg || res?.code || JSON.stringify(res?.data ?? res);
        console.log(`[Engine] KuCoin order rejected ${side} ${symbol}: ${errMsg}`);
        const isBalRej = errMsg === "OK" || errMsg.includes("Balance") || errMsg.includes("balance") || errMsg.includes("insufficient");
        const nKey = `kc_${symbol}_${side}_rej`;
        if (shouldNotifyError(nKey, isBalRej)) {
          const reason = errMsg === "OK" ? "Balance insuficiente o par no disponible" : errMsg;
          await sendTelegramNotification(engine, `⚠️ <b>Orden Rechazada</b>\nExchange: KuCoin\nPar: ${symbol}\nLado: ${side}\nRazón: ${reason}`);
        }
        return null;
      }
    } else {
      const res = await withRetry(() => engine.client.submitOrder({ category, symbol, side, orderType: "Market", qty }), `Bybit-only ${side} ${symbol}`);
      return res.result?.orderId ?? null;
    }
  } catch (e) {
    const errMsg = (e as Error).message;
    console.error(`[Engine] Order failed ${side} ${symbol} (${engine.exchange}):`, errMsg);
    const isBalanceErr = errMsg === "OK" || errMsg.includes("Balance insufficient") || errMsg.includes("balance") || errMsg.includes("Insufficient");
    const isNetErr = isNetworkError(e);
    const nKey = `${engine.exchange}_${symbol}_${side}`;
    // Network errors: suppress from Telegram (transient, already retried 3x)
    if (!isNetErr && shouldNotifyError(nKey, isBalanceErr)) {
      const reason = isBalanceErr ? `Balance insuficiente en ${engine.exchange}` : errMsg;
      await sendTelegramNotification(engine, `❌ <b>Orden Fallida</b>\nExchange: ${engine.exchange}\nPar: ${symbol}\nLado: ${side}\nQty: ${qty}\nRazón: ${reason}`);
    }
    return null;
  }
}

function calcNetPnl(grossPnl: number, tradeAmount: number, category: "spot" | "linear", roundTrip = true, exchange = "bybit", holdTimeMs = 0): number {
  const exchangeFees = FEES[exchange] ?? FEES.bybit;
  const feeRate = category === "linear" ? exchangeFees.linear : exchangeFees.spot;
  const feeLegs = roundTrip ? 2 : 1;
  const tradingFees = tradeAmount * feeRate * feeLegs;
  // Estimate funding rate cost for perpetual futures (charged every 8h, ~0.01% avg)
  let fundingCost = 0;
  if (category === "linear" && holdTimeMs > 0) {
    const FUNDING_RATE_PER_8H = 0.0001; // 0.01% average
    const fundingPeriods = Math.floor(holdTimeMs / (8 * 3600 * 1000));
    fundingCost = tradeAmount * FUNDING_RATE_PER_8H * fundingPeriods;
  }
  return grossPnl - tradingFees - fundingCost;
}

// ─── Grid Trading Strategy (with Trailing Stop, Dynamic Spread, DCA, MTF, Volume Filter, Hours) ───
function generateGridLevels(currentPrice: number, gridCount: number = 10, gridSpread: number = 0.005): GridLevel[] {
  const levels: GridLevel[] = [];
  const step = currentPrice * gridSpread / (gridCount / 2);
  for (let i = -gridCount / 2; i <= gridCount / 2; i++) {
    if (i === 0) continue;
    levels.push({
      price: currentPrice + step * i,
      side: i < 0 ? "Buy" : "Sell",
      filled: false,
    });
  }
  return levels;
}

async function runGridStrategy(engine: EngineState, symbol: string, category: "spot" | "linear" = "spot", dailyProfitMode: "normal" | "cautious" | "stopped" = "normal") {
  const ticker = await fetchTicker(engine.client, symbol, category);
  if (!ticker) return;

  const price = ticker.lastPrice;
  engine.lastPrices[symbol] = price;
  livePrices.set(symbol, ticker);

  // ─── Trading Hours Filter (configurable, default: always trade crypto) ───
  // Crypto markets are 24/7 but volume is highest during NY hours
  // Only apply strict hours filter for non-crypto (commodities)
  // Crypto markets are 24/7 — removed strict hours filter
  // Grid operates at all hours, protection system handles risk

  // ─── Volume Filter ───
  if (!hasAdequateVolume(symbol)) {
    console.log(`[Grid] ${symbol} SKIP — insufficient volume/liquidity`);
    return;
  }

  // ─── Daily Profit Target Guard ───
  // In "stopped" mode: skip new buys entirely (existing positions still close normally)
  // In "cautious" mode: only buy if smart score >= 75 (exceptional opportunity)
  if (dailyProfitMode === "stopped") {
    // Still allow sells/trailing stops to close existing positions
    // But skip the entire buy logic below
  }

  // ─── SMART ANALYSIS v6.0: Multi-indicator scoring + Market Regime ───
  let trendAllowsBuy = true;
  let trendLabel = "neutral";
  let smartScore: SignalScore | null = null;
  let marketRegime: MarketRegime = "ranging";
  let dynamicTrailingPct = 0.005; // default 0.5%
  let positionSizeMultiplier = 1.0;
  try {
    const klines = await fetchKlines(engine.client, symbol, "15", 60, category);
    if (klines.closes.length >= 30) {
      // Full smart analysis
      smartScore = calculateSignalScore(klines, price);
      marketRegime = smartScore.regime;
      dynamicTrailingPct = smartScore.suggestedTrailingPct / 100;
      positionSizeMultiplier = smartScore.suggestedSizePct;

      // Loss cooldown: reduce size after consecutive losses
      const cooldownMult = getLossCooldownMultiplier(symbol, "grid");
      positionSizeMultiplier *= cooldownMult;

      // Market regime determines buy permission
      if (smartScore.regime === "strong_trend_down") {
        trendAllowsBuy = false;
        trendLabel = "bearish-strong";
      } else if (smartScore.regime === "trend_down" && smartScore.confidence > 50) {
        trendAllowsBuy = false;
        trendLabel = "bearish";
      } else if (smartScore.regime === "strong_trend_up") {
        trendLabel = "bullish-strong";
      } else if (smartScore.regime === "trend_up") {
        trendLabel = "bullish";
      } else if (smartScore.regime === "volatile") {
        trendLabel = "volatile";
        // In volatile market, only buy if score says buy with high confidence
        if (smartScore.direction !== "buy" || smartScore.confidence < 50) {
          trendAllowsBuy = false;
        }
      } else {
        trendLabel = "ranging";
      }

      // Regime-based spread adjustment
      if (marketRegime === "volatile") {
        // Wider spread in volatile markets
        positionSizeMultiplier *= 0.7; // smaller positions
      } else if (marketRegime === "ranging") {
        // Tighter spread in ranging — more cycles
        positionSizeMultiplier *= 1.1;
      }

      // Support/Resistance awareness
      const sr = findSupportResistance(klines.highs, klines.lows, klines.closes, klines.volumes, price);
      // If price is near strong resistance, reduce buy confidence
      if (sr.nearestResistance && (sr.nearestResistance - price) / price < 0.003) {
        if (smartScore.direction === "buy") positionSizeMultiplier *= 0.7;
      }
      // If price is near strong support, boost buy confidence
      if (sr.nearestSupport && (price - sr.nearestSupport) / price < 0.003) {
        if (smartScore.direction === "buy") positionSizeMultiplier *= 1.2;
      }

      console.log(`[Grid] ${symbol} SMART: score=${smartScore.confidence} dir=${smartScore.direction} regime=${marketRegime} size=${positionSizeMultiplier.toFixed(2)}x trailing=${(dynamicTrailingPct * 100).toFixed(2)}% reasons=${smartScore.reasons.length}`);
    } else {
      // Fallback to simple EMA
      const ema20 = calculateEMA(klines.closes, 20);
      const ema50 = calculateEMA(klines.closes, Math.min(50, klines.closes.length));
      if (ema20.length > 0 && ema50.length > 0) {
        if (ema20[ema20.length - 1] < ema50[ema50.length - 1]) { trendAllowsBuy = false; trendLabel = "bearish"; }
        else trendLabel = "bullish";
      }
    }
  } catch { /* keep trendAllowsBuy = true on error */ }

  // ─── MARKET INTELLIGENCE v7.0: Master Signal Integration ───
  let masterSignal: MasterSignal | null = null;
  try {
    // Fetch multi-timeframe klines for MTA
    const klines5m = await fetchKlines(engine.client, symbol, "5", 60, category);
    const klines15m_mta = await fetchKlines(engine.client, symbol, "15", 60, category);
    const klines1h = await fetchKlines(engine.client, symbol, "60", 60, category);
    
    // Get order book imbalance
    let orderBookData;
    try { orderBookData = await getOrderBookImbalance(engine.client, symbol, category); } catch { /* silent */ }
    
    // Get bot state for capital info
    const miState = await db.getOrCreateBotState(engine.userId);
    const miCapital = parseFloat(miState?.currentBalance ?? "5000");
    const miTodayPnl = parseFloat(miState?.todayPnl ?? "0");
    
    masterSignal = aggregateMasterSignal({
      symbol,
      currentPrice: price,
      klines5m,
      klines15m: klines15m_mta,
      klines1h,
      orderBookImbalance: orderBookData,
      totalCapital: miCapital,
      proposedAmount: miCapital * 0.05,
      todayPnl: miTodayPnl,
      currentBalance: miCapital,
      strategy: "grid",
    });
    
    // Apply master signal to buy permission
    if (masterSignal.blocked) {
      trendAllowsBuy = false;
      trendLabel = `BLOCKED: ${masterSignal.blockReason}`;
    } else if (masterSignal.direction === "sell" && masterSignal.confidence > 40) {
      trendAllowsBuy = false;
      trendLabel = `master-sell-${masterSignal.confidence}`;
    }
    
    // Apply master sizing multiplier
    positionSizeMultiplier *= masterSignal.sizingMultiplier;
    
    // Anti-manipulation check
    const manipulation = detectManipulation(klines15m_mta);
    if (manipulation.isFakeWick) {
      console.log(`[Grid] ${symbol} MANIPULATION: ${manipulation.reason}`);
      positionSizeMultiplier *= 0.3;
    }
    
    console.log(`[Grid] ${symbol} MASTER: dir=${masterSignal.direction} conf=${masterSignal.confidence} sizing=${masterSignal.sizingMultiplier.toFixed(2)}x blocked=${masterSignal.blocked} reasons=${masterSignal.reasons.length}`);
  } catch (e) {
    console.warn(`[Grid] ${symbol} Master signal error: ${(e as Error).message}`);
  }
  
  // Legacy MTA fallback
  const mtf = await multiTimeframeCheck(engine.client, symbol, category);
  if (mtf.direction === "bearish" && mtf.aligned && !masterSignal) {
    trendAllowsBuy = false;
    trendLabel = "bearish-mtf";
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
      // Use ATR for more accurate volatility measurement
      const atrPct = calculateATRPercent(klines.highs, klines.lows, klines.closes);
      // Scale spread: ATR 0.5% → base, ATR 2% → 2x base
      const volMultiplier = Math.max(1, Math.min(2.5, atrPct / 0.5));
      effectiveSpread = baseGridSpread * volMultiplier;
      // v8.2: AI Trending Grid Adjustment — tighter spread + more levels in trending
      const trendAdj = getTrendingGridAdjustment(marketRegime);
      effectiveSpread *= trendAdj.spreadMultiplier;
      gridLevels = Math.round(gridLevels * trendAdj.levelsMultiplier);
      if (trendAdj.spreadMultiplier !== 1.0) {
        console.log(`[Grid] ${symbol} TRENDING ADJ: spread×${trendAdj.spreadMultiplier} levels×${trendAdj.levelsMultiplier} regime=${marketRegime}`);
      }
      // Additional ranging tightening for max cycles
      if (marketRegime === "ranging") effectiveSpread *= 0.65;
    }
  } catch { /* use base spread */ }

  // Minimum profitable spread (lower = more cycles = more USDT gains)
  const minProfitableSpread = 0.0015; // v10.4: 0.15% minimum — ultra-aggressive for fast cycles
  effectiveSpread = Math.max(effectiveSpread, minProfitableSpread);

  // Initialize grid if not exists
  const isNewGrid = !engine.gridLevels[symbol] || engine.gridLevels[symbol].length === 0;
  if (isNewGrid) {
    engine.gridLevels[symbol] = generateGridLevels(price, gridLevels, effectiveSpread);
    console.log(`[Grid] ${symbol} initialized ${engine.gridLevels[symbol].length} levels around ${price} (spread=${(effectiveSpread * 100).toFixed(2)}%, levels=${gridLevels}, trend=${trendLabel})`);
  }

  // ─── Smart Regeneration ───
  const levels = engine.gridLevels[symbol];
  const gridPrices = levels.map(l => l.price);
  const gridCentre = (Math.max(...gridPrices) + Math.min(...gridPrices)) / 2;
  const driftPct = Math.abs(price - gridCentre) / gridCentre;
  const driftThreshold = effectiveSpread * 1.5;
  if (driftPct > driftThreshold && !isNewGrid) {
    engine.gridLevels[symbol] = generateGridLevels(price, gridLevels, effectiveSpread);
    // IMPORTANT: Do NOT clear openBuyPositions on recentering!
    // Clearing them causes the bot to lose track of real positions and sell at a loss.
    // Open positions are managed by the protection system (trailing stop, stop-loss).
    console.log(`[Grid] ${symbol} RECENTRED grid around ${price.toFixed(2)} (drift=${(driftPct * 100).toFixed(2)}%, spread=${(effectiveSpread * 100).toFixed(2)}%, trend=${trendLabel}, keeping ${(engine.openBuyPositions[symbol] ?? []).length} open positions)`);
  }

  let traded = false;

  // Log grid status
  const unfilledBuys = levels.filter(l => !l.filled && l.side === "Buy");
  const unfilledSells = levels.filter(l => !l.filled && l.side === "Sell");
  if (unfilledBuys.length > 0 || unfilledSells.length > 0) {
    const nearestBuy = unfilledBuys.sort((a, b) => b.price - a.price)[0];
    const nearestSell = unfilledSells.sort((a, b) => a.price - b.price)[0];
    console.log(`[Grid] ${symbol} price=${price.toFixed(2)} nearestBuy=${nearestBuy?.price?.toFixed(2) ?? 'none'} nearestSell=${nearestSell?.price?.toFixed(2) ?? 'none'} unfilled=${unfilledBuys.length}B/${unfilledSells.length}S trend=${trendLabel}`);
  }

  const openPositions = engine.openBuyPositions[symbol] ?? [];

  // ─── Protection System: Trailing Stop (profit only) + Time-Profit ───
  // Philosophy: NEVER sell at a loss. Smart entries + patience = always win.
  const stratConfig = config ?? {};
  // stopLossPct is IGNORED — no stop-loss philosophy: HOLD until profit
  // const stopLossPct = (stratConfig.stopLossPct ?? 0) / 100;
  // Dynamic trailing: use ATR-based trailing from smart analysis, fallback to config
  const configTrailingPct = (stratConfig.trailingStopPct ?? 0.5) / 100;
  const trailingPct = dynamicTrailingPct > 0 ? dynamicTrailingPct : configTrailingPct; // ATR-based trailing
  const trailingActivation = (stratConfig.trailingActivationPct ?? 0.5) / 100;
  const maxHoldTimeMs = (stratConfig.maxHoldHours ?? 4) * 60 * 60 * 1000; // Default 4 hours — fast USDT rotation
  const maxOpenPositions = stratConfig.maxOpenPositions ?? 5; // Max open positions per symbol — more positions = more cycles = more USDT gains
  // Minimum 0.5% net profit on ALL sells — NEVER sell below this threshold
  const MIN_PROFIT_PCT = 0.002; // v10.4: 0.2% minimum net profit (was 0.3%) — faster USDT recovery
  const positionsToSell: { pos: OpenBuyPosition; reason: string }[] = [];

  for (let i = openPositions.length - 1; i >= 0; i--) {
    const pos = openPositions[i];
    const lossPct = (pos.buyPrice - price) / pos.buyPrice;
    const profitPct = (price - pos.buyPrice) / pos.buyPrice;
    const holdTimeMs = Date.now() - (pos.openedAt ?? Date.now());

    // 1. NO STOP-LOSS — NUNCA vender a pérdida. HOLD hasta que recupere.
    // La inteligencia del bot está en ENTRAR bien, no en cortar pérdidas.
    if (profitPct < 0) {
      // Log only every ~50 cycles to avoid spam
      if (holdTimeMs > 3600000) { // Only log if held > 1h
        console.log(`[Grid] ${symbol} HOLD — ${(lossPct * 100).toFixed(2)}% loss, held ${(holdTimeMs / 3600000).toFixed(1)}h, waiting for recovery`);
      }
    }

    // 2. TIME-PROFIT: If held long AND net profit >= 0.5%, close to rotate capital
    if (maxHoldTimeMs > 0 && holdTimeMs > maxHoldTimeMs && profitPct > 0) {
      const estGrossPnl = (price - pos.buyPrice) * parseFloat(pos.qty);
      const estNetPnl = calcNetPnl(estGrossPnl, pos.tradeAmount, category, true, engine.exchange);
      const minProfitForPos = pos.tradeAmount * MIN_PROFIT_PCT;
      if (estNetPnl >= minProfitForPos) {
        positionsToSell.push({ pos, reason: `TIME-PROFIT (held ${(holdTimeMs / 3600000).toFixed(1)}h, profit $${estNetPnl.toFixed(2)} >= ${(MIN_PROFIT_PCT * 100).toFixed(1)}%)` });
        openPositions.splice(i, 1);
        continue;
      } else if (estNetPnl > 0) {
        console.log(`[Grid] ${symbol} HOLD — time-profit $${estNetPnl.toFixed(2)} < min ${(MIN_PROFIT_PCT * 100).toFixed(1)}% ($${minProfitForPos.toFixed(2)}), waiting`);
      }
    }

    // 3. TRAILING STOP: Lock in profits (only if net profit >= 0.5%)
    if (!pos.highestPrice || price > pos.highestPrice) {
      pos.highestPrice = price;
    }
    if (pos.highestPrice && pos.highestPrice > pos.buyPrice * (1 + trailingActivation)) {
      const dropFromHigh = (pos.highestPrice - price) / pos.highestPrice;
      if (dropFromHigh >= trailingPct) {
        const estGrossPnl = (price - pos.buyPrice) * parseFloat(pos.qty);
        const estNetPnl = calcNetPnl(estGrossPnl, pos.tradeAmount, category, true, engine.exchange);
        const minProfitForPos = pos.tradeAmount * MIN_PROFIT_PCT;
        if (estNetPnl >= minProfitForPos) {
          positionsToSell.push({ pos, reason: `TRAILING-STOP (high=${pos.highestPrice.toFixed(2)}, drop=${(dropFromHigh * 100).toFixed(2)}%, net=$${estNetPnl.toFixed(2)} >= ${(MIN_PROFIT_PCT * 100).toFixed(1)}%)` });
          openPositions.splice(i, 1);
          continue;
        } else if (estNetPnl <= 0) {
          console.log(`[Grid] ${symbol} BLOCK SELL — trailing triggered but net PnL $${estNetPnl.toFixed(2)} is NEGATIVE, holding`);
        } else {
          console.log(`[Grid] ${symbol} HOLD — trailing profit $${estNetPnl.toFixed(2)} < min ${(MIN_PROFIT_PCT * 100).toFixed(1)}% ($${minProfitForPos.toFixed(2)})`);
        }
      }
    }
  }

  for (const { pos, reason } of positionsToSell) {
    const orderId = await placeOrder(engine, symbol, "Sell", pos.qty, category);
    if (!orderId && !engine.simulationMode) {
      // Sell failed (likely insufficient balance) — remove phantom position from memory AND DB
      const idx = engine.openBuyPositions[symbol]?.findIndex(p => p.buyPrice === pos.buyPrice && p.qty === pos.qty);
      if (idx !== undefined && idx >= 0) {
        engine.openBuyPositions[symbol]!.splice(idx, 1);
        console.log(`[Grid] Removed phantom position ${symbol} buyPrice=${pos.buyPrice} qty=${pos.qty} — sell failed, likely no balance`);
      }
      // Also delete from DB so it doesn't come back on restart
      await db.deleteOpenPosition(engine.userId, symbol, pos.buyPrice, pos.qty, engine.exchange === "both" ? "bybit" : engine.exchange);
      await db.deleteOpenPosition(engine.userId, symbol, pos.buyPrice, pos.qty, "kucoin");
      continue;
    }
    if (orderId) {
      const grossPnl = (price - pos.buyPrice) * parseFloat(pos.qty);
      const pnl = calcNetPnl(grossPnl, pos.tradeAmount, category, true, engine.exchange);
      // Track win/loss for cooldown system
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

      // Track max drawdown
      if (pnl < 0) {
        const state = await db.getOrCreateBotState(engine.userId);
        const currentDrawdown = Math.abs(pnl);
        const maxDrawdown = parseFloat(state?.maxDrawdown ?? "0");
        if (currentDrawdown > maxDrawdown) {
          await db.updateBotState(engine.userId, { maxDrawdown: currentDrawdown.toFixed(2) });
        }
      }

      console.log(`[Grid] ${reason} ${symbol} @ ${price.toFixed(2)} buyPrice=${pos.buyPrice.toFixed(2)} high=${pos.highestPrice?.toFixed(2)} pnl=${pnl.toFixed(2)} order=${orderId}`);

      // AI + Optimizer feedback: record trade for learning
      try {
        recordTradeForTuning("grid", pnl, (pnl / pos.tradeAmount) * 100);
        recordTradeResultOptimizer(pnl);
        recordTradeForTiming(pnl); // v9.0: Market Timing learning
        recordTradeForLearning({ strategy: "grid", symbol, entryScore: smartScore?.confidence ?? 50, entryRegime: "unknown", entrySession: "unknown", entryFearGreed: 50, entryPatterns: [], pnlPercent: (pnl / pos.tradeAmount) * 100, holdTimeMinutes: 0, timestamp: Date.now() });
      } catch { /* silent */ }

      // Telegram notification — only send for profitable exits
      if (pnl > 0) {
        await sendTelegramNotification(engine,
          `✅ <b>PHANTOM Grid Profit</b>\n` +
          `Par: ${symbol}\n` +
          `Compra: $${pos.buyPrice.toFixed(2)}\n` +
          `Venta: $${price.toFixed(2)} (${reason.split(" ")[0]})\n` +
          `Ganancia: <b>$${pnl.toFixed(2)}</b>`
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
        level.filled = true;
        level.orderId = orderId;
        const grossPnl = (Math.random() * 0.008 - 0.002) * tradeAmount;
        const pnl = calcNetPnl(grossPnl, tradeAmount, category, false, engine.exchange);
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
        console.log(`[Grid] Initial BUY ${symbol} @ ${level.price.toFixed(2)} qty=${qty} pnl=${pnl.toFixed(2)}`);
        traded = true;
      }
    }
  }

  // ─── Main Grid Loop ───
  for (const level of levels) {
    if (level.filled) continue;

    const tolerance = engine.simulationMode ? 0.0005 : 0.0002;
    const shouldFill = level.side === "Buy"
      ? price <= level.price * (1 + tolerance)
      : price >= level.price * (1 - tolerance);

    if (shouldFill) {
      // ─── Daily Profit Target Guard for BUY ───
      if (level.side === "Buy" && dailyProfitMode === "stopped") {
        console.log(`[Grid] SKIP BUY ${symbol} @ ${level.price.toFixed(2)} — DAILY TARGET 5%+ HIT, no new trades`);
        continue;
      }
      if (level.side === "Buy" && dailyProfitMode === "cautious") {
        // Only allow exceptional opportunities (score >= 75)
        if (!smartScore || smartScore.confidence < 75 || smartScore.direction !== "buy") {
          console.log(`[Grid] SKIP BUY ${symbol} @ ${level.price.toFixed(2)} — DAILY 2%+ mode, score ${smartScore?.confidence ?? 0} < 75`);
          continue;
        }
        console.log(`[Grid] 💡 EXCEPTIONAL BUY ${symbol} @ ${level.price.toFixed(2)} — score ${smartScore.confidence} >= 75 despite daily target`);
      }

      // ─── Smart Score guard: skip BUY if analysis says sell or low confidence ───
      if (level.side === "Buy" && !trendAllowsBuy) {
        console.log(`[Grid] SKIP BUY ${symbol} @ ${level.price.toFixed(2)} — ${trendLabel} trend (regime=${marketRegime})`);
        continue;
      }
      // Additional: skip buy if smart score says sell OR confidence is too low
      if (level.side === "Buy" && smartScore) {
        // Block buy if analysis says sell with moderate confidence
        if (smartScore.direction === "sell" && smartScore.confidence >= 45) {
          console.log(`[Grid] SKIP BUY ${symbol} @ ${level.price.toFixed(2)} — smart score SELL conf=${smartScore.confidence}`);
          continue;
        }
        // Block buy if confidence is too low (weak signal = risky entry)
        if (smartScore.direction === "buy" && smartScore.confidence < 20) {
          console.log(`[Grid] SKIP BUY ${symbol} @ ${level.price.toFixed(2)} — buy confidence too low (${smartScore.confidence}%)`);
          continue;
        }
      }

      // ─── Max open positions guard: don't accumulate too many buys ───
      if (level.side === "Buy" && (engine.openBuyPositions[symbol]?.length ?? 0) >= maxOpenPositions) {
        console.log(`[Grid] SKIP BUY ${symbol} @ ${level.price.toFixed(2)} — max open positions (${maxOpenPositions})`);
        continue;
      }

      // ─── Profitability guard ───
      if (level.side === "Buy") {
        const feeRoundTrip = 0.002;
        const requiredSellPrice = level.price * (1 + feeRoundTrip + 0.001);
        const hasProfit = levels.some(l => l.side === "Sell" && !l.filled && l.price >= requiredSellPrice);
        if (!hasProfit) {
          console.log(`[Grid] SKIP BUY ${symbol} @ ${level.price.toFixed(2)} — no profitable sell level`);
          continue;
        }
      }

      // ─── Smart Sizing: confidence-weighted position sizing ───
      const allocation = strat?.allocationPct ?? 50;
      const state = await db.getOrCreateBotState(engine.userId);
      const balance = parseFloat(state?.currentBalance ?? "5000");
      const baseTradeAmount = (balance * allocation / 100) / (levels.length / 2);
      // Apply smart multiplier + strength boost: strong signals get bigger positions
      const gridBoost = (smartScore?.confidence ?? 50) > 70 ? 1.5 : (smartScore?.confidence ?? 50) > 50 ? 1.2 : 1.0;
      const tradeAmount = baseTradeAmount * positionSizeMultiplier * gridBoost;
      const qty = (tradeAmount / price).toFixed(6);

      // ─── v9.0: USDT Liquidity Guard for spot buys ───
      if (level.side === "Buy" && category === "spot") {
        const hasLiquidity = await hasUsdtLiquidity(engine, tradeAmount, `grid-${symbol}`);
        if (!hasLiquidity) {
          console.log(`[Grid] SKIP BUY ${symbol} @ ${level.price.toFixed(2)} — USDT reserve too low`);
          continue;
        }
        // v9.0: Big opportunity → suggest futures instead of spot
        if (shouldUseFuturesForOpportunity(smartScore?.confidence ?? 0, category)) {
          console.log(`[Grid] ${symbol} HIGH CONF ${smartScore?.confidence}% — futures preferred over spot (USDT stays liquid)`);
        }
      }

      const orderId = await placeOrder(engine, symbol, level.side, qty, category);
      if (orderId) {
        level.filled = true;
        level.orderId = orderId;
        level.filledPrice = price;
        level.qty = qty;

        let pnl = 0;

        if (level.side === "Buy") {
          // BUY: $0 PnL, track open position with trailing stop
          if (!engine.openBuyPositions[symbol]) engine.openBuyPositions[symbol] = [];
          engine.openBuyPositions[symbol].push({
            symbol, buyPrice: price, qty, tradeAmount, category,
            gridLevelPrice: level.price, highestPrice: price,
            openedAt: Date.now(),
          });
          pnl = 0;
          console.log(`[Grid] BUY ${symbol} @ ${price.toFixed(2)} qty=${qty} pnl=$0.00 (trailing stop active) order=${orderId}`);
        } else {
          // SELL: pair with oldest open buy (FIFO)
          const openPos = engine.openBuyPositions[symbol] ?? [];
          const pairedBuy = openPos[0]; // peek, don't shift yet
          if (pairedBuy) {
            const sellQty = parseFloat(qty);
            const grossPnl = (price - pairedBuy.buyPrice) * sellQty;
            pnl = calcNetPnl(grossPnl, pairedBuy.tradeAmount, category, true, engine.exchange);
            // Minimum 0.5% net profit required on ALL sells
            const minProfitForSell = pairedBuy.tradeAmount * MIN_PROFIT_PCT;
            if (pnl < minProfitForSell) {
              console.log(`[Grid] HOLD ${symbol} — grid sell net $${pnl.toFixed(2)} < min ${(MIN_PROFIT_PCT * 100).toFixed(1)}% ($${minProfitForSell.toFixed(2)}), waiting`);
              level.filled = false;
              continue;
            }
            openPos.shift(); // now actually remove from queue
            console.log(`[Grid] SELL ${symbol} @ ${price.toFixed(2)} buyPrice=${pairedBuy.buyPrice.toFixed(2)} net=${pnl.toFixed(2)} order=${orderId}`);

            // Telegram notification
            if (pnl > 0) {
              await sendTelegramNotification(engine,
                `✅ <b>PHANTOM Grid Profit</b>\n` +
                `Par: ${symbol}\nCompra: $${pairedBuy.buyPrice.toFixed(2)}\nVenta: $${price.toFixed(2)}\n` +
                `Ganancia: <b>$${pnl.toFixed(2)}</b>`
              );
            }
          } else {
            // No paired buy — estimate PnL from grid level price
            const grossPnl = (price - level.price) * parseFloat(qty);
            pnl = calcNetPnl(grossPnl, tradeAmount, category, true, engine.exchange);
            // Minimum 0.5% net profit required
            const minProfitNoPair = tradeAmount * MIN_PROFIT_PCT;
            if (pnl < minProfitNoPair) {
              console.log(`[Grid] HOLD ${symbol} — no-paired sell net $${pnl.toFixed(2)} < min ${(MIN_PROFIT_PCT * 100).toFixed(1)}% ($${minProfitNoPair.toFixed(2)}), skipping`);
              level.filled = false;
              continue;
            }
            console.log(`[Grid] SELL ${symbol} @ ${price.toFixed(2)} (no paired buy) net=${pnl.toFixed(2)} order=${orderId}`);
          }
        }

        await db.insertTrade({
          userId: engine.userId, symbol, side: level.side.toLowerCase(),
          price: price.toString(), qty, pnl: pnl.toFixed(2),
          strategy: "grid", orderId, simulated: engine.simulationMode,
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

        // AI + Optimizer feedback for grid level trades
        if (level.side === "Sell" && pnl !== 0) {
          try {
            recordTradeForTuning("grid", pnl, (pnl / tradeAmount) * 100);
            recordTradeResultOptimizer(pnl);
            recordTradeForLearning({ strategy: "grid", symbol, entryScore: smartScore?.confidence ?? 50, entryRegime: "unknown", entrySession: "unknown", entryFearGreed: 50, entryPatterns: [], pnlPercent: (pnl / tradeAmount) * 100, holdTimeMinutes: 0, timestamp: Date.now() });
          } catch { /* silent */ }
        }

        traded = true;
      }
    }
  }

  // ─── DCA: if price dropped significantly and trend is turning, accumulate more ───
  const dcaThreshold = 0.02; // 2% below average entry
  if (!engine.dcaPositions[symbol]) {
    engine.dcaPositions[symbol] = { avgPrice: 0, totalQty: 0, totalCost: 0, entries: 0 };
  }
  const dca = engine.dcaPositions[symbol];
  if (dca.entries > 0 && price < dca.avgPrice * (1 - dcaThreshold) && trendLabel !== "bearish" && trendLabel !== "bearish-mtf") {
    // DCA: buy more to lower average
    const allocation = strat?.allocationPct ?? 50;
    const state = await db.getOrCreateBotState(engine.userId);
    const balance = parseFloat(state?.currentBalance ?? "5000");
    const dcaAmount = (balance * allocation / 100) * 0.05; // 5% of allocation per DCA
    const dcaQty = (dcaAmount / price).toFixed(6);
    const maxDcaEntries = 5;

    if (dca.entries < maxDcaEntries) {
      // v9.0: USDT Liquidity Guard for DCA buys
      if (category === "spot") {
        const dcaLiq = await hasUsdtLiquidity(engine, dcaAmount, `dca-${symbol}`);
        if (!dcaLiq) {
          console.log(`[DCA] SKIP ${symbol} — USDT reserve too low for DCA`);
          return;
        }
      }
      const orderId = await placeOrder(engine, symbol, "Buy", dcaQty, category);
      if (orderId) {
        dca.totalCost += dcaAmount;
        dca.totalQty += parseFloat(dcaQty);
        dca.entries += 1;
        dca.avgPrice = dca.totalCost / dca.totalQty;

        await db.insertTrade({
          userId: engine.userId, symbol, side: "buy", price: price.toString(),
          qty: dcaQty, pnl: "0.00", strategy: "grid", orderId, simulated: engine.simulationMode,
        });
        console.log(`[Grid] DCA BUY ${symbol} @ ${price.toFixed(2)} qty=${dcaQty} avgPrice=${dca.avgPrice.toFixed(2)} entries=${dca.entries}/${maxDcaEntries}`);

        // Track as open position for trailing sell
        if (!engine.openBuyPositions[symbol]) engine.openBuyPositions[symbol] = [];
        engine.openBuyPositions[symbol].push({
          symbol, buyPrice: price, qty: dcaQty, tradeAmount: dcaAmount,
          category, gridLevelPrice: price, highestPrice: price,
          openedAt: Date.now(),
        });
      }
    }
  }
  // Update DCA tracking from grid buys
  if (traded && openPositions.length > 0) {
    const lastBuy = openPositions[openPositions.length - 1];
    if (lastBuy) {
      dca.totalCost += lastBuy.tradeAmount;
      dca.totalQty += parseFloat(lastBuy.qty);
      dca.entries = Math.max(dca.entries, 1);
      dca.avgPrice = dca.totalCost / dca.totalQty;
    }
  }
  // DCA sell: if price recovered above average + profit margin
  if (dca.entries > 0 && price > dca.avgPrice * 1.005) {
    // Reset DCA tracking (positions will be sold by trailing stop or grid sell)
    dca.entries = 0;
    dca.totalCost = 0;
    dca.totalQty = 0;
    dca.avgPrice = 0;
  }

  // Regenerate grid if >60% filled
  const filledCount = levels.filter(l => l.filled).length;
  if (filledCount > levels.length * 0.6) {
    engine.gridLevels[symbol] = generateGridLevels(price, gridLevels, effectiveSpread);
    engine.openBuyPositions[symbol] = [];
    console.log(`[Grid] ${symbol} regenerated grid (>60% filled) around ${price.toFixed(2)} (spread=${(effectiveSpread * 100).toFixed(2)}%)`);
  }
}

// ─── Scalping Strategy ───
async function runScalpingStrategy(engine: EngineState, symbol: string, category: "spot" | "linear" = "linear", dailyProfitMode: "normal" | "cautious" | "stopped" = "normal") {
  const ticker = await fetchTicker(engine.client, symbol, category);
  if (!ticker) return;

  const price = ticker.lastPrice;
  engine.lastPrices[symbol] = price;
  livePrices.set(symbol, ticker);

  // Volume filter
  if (!hasAdequateVolume(symbol)) {
    console.log(`[Scalp] ${symbol} SKIP — insufficient volume`);
    return;
  }

  // ─── SMART ANALYSIS v6.0 + MARKET INTELLIGENCE v7.0 + PROFIT MAXIMIZER v9.0 for Scalping ───
  const klines = await fetchKlines(engine.client, symbol, "15", 50, category);
  if (klines.closes.length < 26) return;

  // Run full smart analysis
  const smartScore = calculateSignalScore(klines, price);
  const scalpCooldown = getLossCooldownMultiplier(symbol, "scalping");

  // ─── v9.0: Profit Maximizer Signals ───
  const marketTiming = getMarketTimingSignal();
  const volumeProfile = analyzeVolumeProfile(klines, price);
  const breakoutSig = detectBreakoutSignal(klines, price);
  const meanRevSig = detectMeanReversionPM(klines, price);

  // Volume Profile: prefer trading at high-volume zones (POC)
  if (!volumeProfile.isHighVolumeZone && !breakoutSig.detected && !meanRevSig.detected) {
    console.log(`[Scalp] ${symbol} LOW VOLUME ZONE: ${volumeProfile.reason} — reducing confidence`);
  }

  // Market Timing: adjust sizing based on historical profitability of this hour/day
  const timingMultiplier = marketTiming.sizingMultiplier;
  if (timingMultiplier < 0.7) {
    console.log(`[Scalp] ${symbol} BAD TIMING: ${marketTiming.reason} — sizing ${timingMultiplier.toFixed(2)}x`);
  }

  // Breakout Hunter: if breakout detected, boost confidence
  let breakoutBoost = 0;
  if (breakoutSig.detected && breakoutSig.confidence > 60) {
    breakoutBoost = Math.round(breakoutSig.confidence * 0.3);
    console.log(`[Scalp] ${symbol} BREAKOUT: ${breakoutSig.reason} — boost +${breakoutBoost}`);
  }

  // Mean Reversion: if extreme oversold, add confidence
  let meanRevBoost = 0;
  if (meanRevSig.detected && meanRevSig.direction === "long" && meanRevSig.confidence > 50) {
    meanRevBoost = Math.round(meanRevSig.confidence * 0.25);
    console.log(`[Scalp] ${symbol} MEAN REVERSION: ${meanRevSig.reason} — boost +${meanRevBoost}`);
  }

  // ─── MASTER SIGNAL for Scalping ───
  let scalpMaster: MasterSignal | null = null;
  try {
    const klines5m = await fetchKlines(engine.client, symbol, "5", 60, category);
    const klines1h = await fetchKlines(engine.client, symbol, "60", 60, category);
    let orderBookData;
    try { orderBookData = await getOrderBookImbalance(engine.client, symbol, category); } catch { /* silent */ }
    const miState = await db.getOrCreateBotState(engine.userId);
    const miCapital = parseFloat(miState?.currentBalance ?? "5000");
    const miTodayPnl = parseFloat(miState?.todayPnl ?? "0");
    scalpMaster = aggregateMasterSignal({
      symbol, currentPrice: price, klines5m, klines15m: klines, klines1h,
      orderBookImbalance: orderBookData,
      totalCapital: miCapital, proposedAmount: miCapital * 0.03,
      todayPnl: miTodayPnl, currentBalance: miCapital, strategy: "scalping",
    });
  } catch { /* use smartScore only */ }

  let signal: "Buy" | "Sell" | null = null;
  const reasons = smartScore.reasons;

  // Use master signal if available, fallback to smart score
  const effectiveConfidence = scalpMaster ? scalpMaster.confidence : smartScore.confidence;
  const effectiveDirection = scalpMaster ? scalpMaster.direction : smartScore.direction;
  const isBlocked = scalpMaster?.blocked ?? false;

  // ─── v8.2: Nocturnal Mode — lower thresholds during 2am-6am UTC ───
  const nocturnal = getNocturnalMultiplier();
  // v9.1.1: XAU gets lower threshold (20) to trade more frequently
  const baseMinConfidence = symbol === "XAUUSDT" ? 10 : 25; // v10.4: XAU ultra-aggressive (10), others 25
  const minConfidence = Math.round(baseMinConfidence * (1 - nocturnal.confidenceReduction));
  if (nocturnal.confidenceReduction > 0) {
    console.log(`[Scalp] ${symbol} NOCTURNAL MODE: minConfidence reduced ${baseMinConfidence} → ${minConfidence}`);
  }
  if (!isBlocked && effectiveDirection === "buy" && effectiveConfidence >= minConfidence) {
    signal = "Buy";
  } else if (effectiveDirection === "sell" && effectiveConfidence >= minConfidence) {
    signal = "Sell";
  }

  // In simulation, be more lenient
  if (engine.simulationMode && !signal && effectiveConfidence >= 20) {
    signal = effectiveDirection === "buy" ? "Buy" : effectiveDirection === "sell" ? "Sell" : null;
  }

  console.log(`[Scalp] ${symbol} SMART+MASTER: price=${price.toFixed(2)} score=${effectiveConfidence} dir=${effectiveDirection} regime=${smartScore.regime} signal=${signal ?? 'none'} blocked=${isBlocked} reasons=${reasons.length} cooldown=${scalpCooldown.toFixed(1)}x dailyMode=${dailyProfitMode}`);

  // ─── Daily Profit Target Guard for Scalping ───
  if (signal === "Buy") {
    if (dailyProfitMode === "stopped") {
      console.log(`[Scalp] SKIP BUY ${symbol} — DAILY TARGET 5%+ HIT, no new trades`);
      signal = null;
    } else if (dailyProfitMode === "cautious" && smartScore.confidence < 75) {
      console.log(`[Scalp] SKIP BUY ${symbol} — DAILY 2%+ mode, score ${smartScore.confidence} < 75`);
      signal = null;
    } else if (dailyProfitMode === "cautious" && smartScore.confidence >= 75) {
      console.log(`[Scalp] 💡 EXCEPTIONAL BUY ${symbol} — score ${smartScore.confidence} >= 75 despite daily target`);
    }
  }
  // Sells always allowed (closing existing positions)

  if (signal) {
    const strats = await db.getUserStrategies(engine.userId);
    const strat = strats.find(s => s.symbol === symbol && s.strategyType === "scalping") ?? strats.find(s => s.symbol === symbol);
    const allocation = strat?.allocationPct ?? 30;
    const state = await db.getOrCreateBotState(engine.userId);
    const balance = parseFloat(state?.currentBalance ?? "5000");
    // Smart sizing: confidence-weighted + cooldown + BOOST + master signal multiplier + XAU boost + nocturnal
    const baseAmount = balance * allocation / 100; // v10.1: deploy 100% of allocation
    const scalpBoost = effectiveConfidence > 75 ? 1.8 : effectiveConfidence > 55 ? 1.3 : 1.0;
    const masterSizing = scalpMaster?.sizingMultiplier ?? 1.0;
    // v9.1.1: XAU BOOST — always active for XAUUSDT, minimum 2.0x sizing
    let xauBoost = 1.0;
    if (symbol === "XAUUSDT") {
      try {
        const perfs = await analyzeStrategyPerformance(engine.userId);
        xauBoost = Math.max(3.0, getXAUBoostMultiplier(perfs)); // v10.4: minimum 3.0x for XAU
      } catch { xauBoost = 3.0; /* default boost even on error */ }
      console.log(`[Scalp] ${symbol} XAU BOOST: ${xauBoost.toFixed(2)}x (top earner — always boosted)`);
    }
    const nocturnalSizing = nocturnal.sizeMultiplier;
    // v9.0: Market Timing + Volume Profile sizing
    const vpBoost = volumeProfile.isHighVolumeZone ? 1.15 : 0.85;
    const tradeAmount = baseAmount * smartScore.suggestedSizePct * scalpCooldown * scalpBoost * masterSizing * xauBoost * nocturnalSizing * timingMultiplier * vpBoost;
    const qty = (tradeAmount / price).toFixed(6);

    // ─── Position-Tracked Scalping ───
    // Check existing scalp positions for this symbol
    const existingPositions = engine.scalpPositions[symbol] ?? [];
    const exchangeKey = engine.exchange === "both" ? (category === "spot" ? "kucoin" : "bybit") : engine.exchange;
    const myPositions = existingPositions.filter(p => p.exchange === exchangeKey && p.category === category);

    // ─── v8.2: Dynamic Trailing Stop for ALL open scalp positions ───
    for (const pos of myPositions) {
      // Update highest price tracking
      if (!pos.highestPrice || price > pos.highestPrice) pos.highestPrice = price;
      const atrPctVal = smartScore.suggestedTrailingPct ?? 0.5;
      const trailing = calculateDynamicTrailingStop(
        pos.buyPrice, price, pos.highestPrice ?? price, atrPctVal / 100, smartScore.regime ?? "ranging"
      );
      pos.highestPrice = trailing.newHighest;
      if (trailing.shouldSell) {
        const posValue = pos.buyPrice * parseFloat(pos.qty);
        const estGross = (price - pos.buyPrice) * parseFloat(pos.qty);
        const estNet = calcNetPnl(estGross, posValue, category, true, engine.exchange);
        if (estNet > 0) {
          console.log(`[Scalp] ${symbol} DYNAMIC TRAILING: ${trailing.reason}`);
          // Force sell via trailing
          signal = "Sell";
          break;
        }
      }
    }

    if (signal === "Sell") {
      // Only sell if we have a scalp position to close
      if (myPositions.length === 0) {
        console.log(`[Scalp] SKIP ${symbol} Sell — no open scalp position to close (${exchangeKey}/${category})`);
        return;
      }

      // Close the oldest position — dynamic trailing or min 0.3% net profit
      const pos = myPositions[0];
      const posValue = pos.buyPrice * parseFloat(pos.qty);
      const estGross = (price - pos.buyPrice) * parseFloat(pos.qty);
      const estNet = calcNetPnl(estGross, posValue, category, true, engine.exchange);
      const scalpMinProfit = posValue * (symbol === "XAUUSDT" ? 0.001 : 0.002); // v10.4: XAU 0.1%, others 0.2% — faster cycles
      if (estNet < scalpMinProfit) {
        console.log(`[Scalp] HOLD ${symbol} — net $${estNet.toFixed(2)} < min 0.3% ($${scalpMinProfit.toFixed(2)}), waiting for better exit`);
        return;
      }
      const sellQty = pos.qty;
      const orderId = await placeOrder(engine, symbol, "Sell", sellQty, category);
      if (orderId) {
        // Calculate real PnL: (sellPrice - buyPrice) * qty - fees
        const grossPnl = (price - pos.buyPrice) * parseFloat(sellQty);
        const pnl = calcNetPnl(grossPnl, pos.buyPrice * parseFloat(sellQty), category, true, engine.exchange);
        // Track win/loss for cooldown system
        recordTradeResult(symbol, "scalping", pnl > 0);

        await db.insertTrade({
          userId: engine.userId, symbol, side: "sell",
          price: price.toString(), qty: sellQty, pnl: pnl.toFixed(2),
          strategy: "scalping", orderId, simulated: engine.simulationMode,
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
        const scalpState = await db.getOrCreateBotState(engine.userId);
        if (scalpState) {
          await db.upsertDailyPnl(engine.userId, parseFloat(scalpState.totalPnl ?? "0"), parseFloat(scalpState.currentBalance ?? "5000"), scalpState.totalTrades ?? 0);
        }

        // AI + Optimizer feedback: record trade for learning
        try {
          recordTradeForTuning("scalping", pnl, (pnl / (pos.buyPrice * parseFloat(sellQty))) * 100);
          recordTradeResultOptimizer(pnl);
          recordTradeForTiming(pnl); // v9.0: Market Timing learning
          recordTradeForLearning({ strategy: "scalping", symbol, entryScore: effectiveConfidence, entryRegime: "unknown", entrySession: "unknown", entryFearGreed: 50, entryPatterns: [], pnlPercent: (pnl / (pos.buyPrice * parseFloat(sellQty))) * 100, holdTimeMinutes: 0, timestamp: Date.now() });
        } catch { /* silent */ }

        // Remove the closed position
        engine.scalpPositions[symbol] = existingPositions.filter(p => p !== pos);
        const holdTime = ((Date.now() - pos.openedAt) / 60000).toFixed(1);
        console.log(`[Scalp] SELL ${symbol} @ ${price.toFixed(4)} qty=${sellQty} buyPrice=${pos.buyPrice.toFixed(4)} pnl=$${pnl.toFixed(2)} hold=${holdTime}min`);

        if (pnl > 0) {
          await sendTelegramNotification(engine,
            `⚡ <b>PHANTOM Scalp Profit</b>\nPar: ${symbol}\nCompra: $${pos.buyPrice.toFixed(4)}\nVenta: $${price.toFixed(4)}\nGanancia: <b>$${pnl.toFixed(2)}</b>\nTiempo: ${holdTime}min`
          );
        }
      } else if (!engine.simulationMode) {
        // Sell failed in live mode — remove phantom position
        engine.scalpPositions[symbol] = existingPositions.filter(p => p !== pos);
        console.log(`[Scalp] Removed phantom scalp position ${symbol} buyPrice=${pos.buyPrice} — sell failed`);
      }
    } else if (signal === "Buy") {
      // XAU gets 6 scalp positions (top earner), others get 3
      const maxScalpPositions = symbol === "XAUUSDT" ? 12 : 5; // v10.4: XAU 12 slots, others 5
      if (myPositions.length >= maxScalpPositions) {
        console.log(`[Scalp] SKIP ${symbol} Buy — already have ${myPositions.length}/${maxScalpPositions} scalp position(s) on ${exchangeKey}`);
        return;
      }

      // Smart pre-check: only enter if confidence is adequate (with v9.0 boosts)
      const boostedConfidence = smartScore.confidence + breakoutBoost + meanRevBoost;
      if (boostedConfidence < 30) {
        console.log(`[Scalp] SKIP ${symbol} Buy — confidence too low (${smartScore.confidence}% + boosts ${breakoutBoost + meanRevBoost} = ${boostedConfidence}%)`);
        return;
      }
      console.log(`[Scalp] ${symbol} Buy — confidence=${smartScore.confidence}% regime=${smartScore.regime} size=${(smartScore.suggestedSizePct * scalpCooldown).toFixed(2)}x`);

      // ─── v9.0: USDT Liquidity Guard for spot scalping buys ───
      if (category === "spot") {
        const hasLiquidity = await hasUsdtLiquidity(engine, tradeAmount, `scalp-${symbol}`);
        if (!hasLiquidity) {
          console.log(`[Scalp] SKIP ${symbol} Buy — USDT reserve too low, keeping capital liquid`);
          return;
        }
        // v9.0: Big opportunity on spot → redirect to futures (USDT-settled)
        if (shouldUseFuturesForOpportunity(boostedConfidence, category)) {
          console.log(`[Scalp] ${symbol} REDIRECTING to FUTURES — score ${boostedConfidence}% >= 80, keeping USDT liquid`);
          // Don't buy spot, the futures engine will pick this up with the high score
          return;
        }
      }

      // v8.2: Opportunity Alert — notify on high-confidence entries
      if (effectiveConfidence >= 70) {
        try {
          const alertMsg = buildOpportunityAlert(symbol, effectiveConfidence, "buy", smartScore.regime ?? "unknown", smartScore.suggestedTrailingPct ?? 0, smartScore.suggestedSizePct ?? 1.0, "scalping");
          await sendTelegramNotification(engine, alertMsg);
        } catch { /* silent */ }
      }

      const orderId = await placeOrder(engine, symbol, "Buy", qty, category);
      if (orderId) {
        // Save the scalp position
        if (!engine.scalpPositions[symbol]) engine.scalpPositions[symbol] = [];
        engine.scalpPositions[symbol].push({
          symbol, buyPrice: price, qty, orderId,
          exchange: exchangeKey, category, openedAt: Date.now(),
        });

        await db.insertTrade({
          userId: engine.userId, symbol, side: "buy",
          price: price.toString(), qty, pnl: "0",
          strategy: "scalping", orderId, simulated: engine.simulationMode,
        });

        const currentState = await db.getOrCreateBotState(engine.userId);
        if (currentState) {
          await db.updateBotState(engine.userId, {
            totalTrades: (currentState.totalTrades ?? 0) + 1,
          });
        }

        console.log(`[Scalp] BUY ${symbol} @ ${price.toFixed(4)} qty=${qty} on ${exchangeKey}/${category} — position saved`);
      }
    }
  }
}

// ─── Futures Long + Short Strategy ───
// Supports both LONG and SHORT positions with dynamic take-profit and trailing stops
async function runFuturesStrategy(engine: EngineState, symbol: string, dailyProfitMode: "normal" | "cautious" | "stopped" = "normal") {
  const ticker = await fetchTicker(engine.client, symbol, "linear");
  if (!ticker) return;

  const price = ticker.lastPrice;
  engine.lastPrices[symbol] = price;
  livePrices.set(symbol, ticker);

  // Volume filter
  if (!hasAdequateVolume(symbol)) return;

  // Check existing positions
  if (!engine.futuresPositions[symbol]) engine.futuresPositions[symbol] = [];
  const positions = engine.futuresPositions[symbol];

  // ─── Read strategy config ───
  const futStrats = await db.getUserStrategies(engine.userId);
  const futStrat = futStrats.find(s => s.symbol === symbol && s.strategyType === "futures");
  const futConfig = futStrat?.config as any ?? {};
  // futuresStopLossPct is IGNORED — no stop-loss philosophy: HOLD until profit
  // const futuresStopLossPct = (futConfig.stopLossPct ?? 0) / 100;
  const futuresMaxHoldHours = futConfig.maxHoldHours ?? 0;
  const futuresNoSL = ["BTCUSDT", "ETHUSDT"];

  // ─── SMART ANALYSIS v6.0 + MARKET INTELLIGENCE v7.0 for Futures ───
  const klines = await fetchKlines(engine.client, symbol, "15", 50, "linear");
  if (klines.closes.length < 26) return;
  const futSmartScore = calculateSignalScore(klines, price);
  const futCooldown = getLossCooldownMultiplier(symbol, "futures");

  // ─── MASTER SIGNAL for Futures ───
  let futMaster: MasterSignal | null = null;
  try {
    const klines5m = await fetchKlines(engine.client, symbol, "5", 60, "linear");
    const klines1h = await fetchKlines(engine.client, symbol, "60", 60, "linear");
    let orderBookData;
    try { orderBookData = await getOrderBookImbalance(engine.client, symbol, "linear"); } catch { /* silent */ }
    const miState = await db.getOrCreateBotState(engine.userId);
    const miCapital = parseFloat(miState?.currentBalance ?? "5000");
    const miTodayPnl = parseFloat(miState?.todayPnl ?? "0");
    futMaster = aggregateMasterSignal({
      symbol, currentPrice: price, klines5m, klines15m: klines, klines1h,
      orderBookImbalance: orderBookData,
      totalCapital: miCapital, proposedAmount: miCapital * 0.05,
      todayPnl: miTodayPnl, currentBalance: miCapital, strategy: "futures",
    });
  } catch { /* use smartScore only */ }

  // ATR-based dynamic TP and trailing
  const atrPct = calculateATRPercent(klines.highs, klines.lows, klines.closes);
  const baseTpPct = futConfig.takeProfitPct ?? 1.5;
  const dynamicTpPct = Math.max(0.8, Math.min(3.0, baseTpPct * Math.max(1, atrPct / 0.5)));

  // ─── ATR-based trailing stop for futures ───
  const trailingActivationPct = Math.max(0.003, atrPct / 100 * 1.0);
  const trailingDistancePct = Math.max(0.002, atrPct / 100 * 0.7);

  // Effective confidence from master signal or smart score
  const futEffConf = futMaster ? futMaster.confidence : futSmartScore.confidence;
  const futEffDir = futMaster ? futMaster.direction : futSmartScore.direction;
  const futBlocked = futMaster?.blocked ?? false;
  const futMasterSizing = futMaster?.sizingMultiplier ?? 1.0;

  console.log(`[Futures] ${symbol} SMART+MASTER: score=${futEffConf} dir=${futEffDir} regime=${futSmartScore.regime} blocked=${futBlocked} atrPct=${atrPct.toFixed(2)}% TP=${dynamicTpPct.toFixed(1)}% sizing=${futMasterSizing.toFixed(2)}x`);

  // ─── Manage existing positions ───
  for (let i = positions.length - 1; i >= 0; i--) {
    const pos = positions[i];
    const isLong = (pos.direction ?? "long") === "long";
    const holdTimeMs = Date.now() - pos.openedAt;

    // Calculate profit/loss based on direction
    const profitPct = isLong
      ? (price - pos.entryPrice) / pos.entryPrice
      : (pos.entryPrice - price) / pos.entryPrice;
    const lossPct = -profitPct; // positive when losing

    let closeReason = "";

    // 1. NO STOP-LOSS — NUNCA cerrar a pérdida. HOLD hasta que recupere.
    if (profitPct < 0 && holdTimeMs > 3600000) {
      console.log(`[Futures] ${symbol} ${isLong ? "LONG" : "SHORT"} HOLD — ${(lossPct * 100).toFixed(2)}% loss, held ${(holdTimeMs / 3600000).toFixed(1)}h, waiting for recovery`);
    }

    // Minimum 0.1% net profit on ALL futures exits (lowered from 0.5% to avoid missing big gains)
    const futMinProfit = pos.tradeAmount * 0.0005; // v10.4: 0.05% of position value — close faster

    // 0. FORCED CLOSE: If profit >= 4%, close immediately to lock in gains (v10.4: capture faster)
    if (!closeReason && profitPct >= 0.04) {
      const estGrossBig = isLong
        ? (price - pos.entryPrice) * parseFloat(pos.qty) * pos.leverage
        : (pos.entryPrice - price) * parseFloat(pos.qty) * pos.leverage;
      const estNetBig = calcNetPnl(estGrossBig, pos.tradeAmount * pos.leverage, "linear", true, "bybit", holdTimeMs);
      closeReason = `FORCED-CLOSE-BIG-GAIN (${(profitPct * 100).toFixed(2)}%, net=$${estNetBig.toFixed(2)} — locking in huge profit)`;
      console.log(`[Futures] 🎯 ${symbol} FORCED CLOSE — ${(profitPct * 100).toFixed(2)}% gain, locking in $${estNetBig.toFixed(2)}`);
    }

    // 2. TIME-PROFIT: Only close if held long AND net profit >= 0.1%
    if (!closeReason && futuresMaxHoldHours > 0 && holdTimeMs > futuresMaxHoldHours * 3600000 && profitPct > 0.003) {
      const estGross = isLong
        ? (price - pos.entryPrice) * parseFloat(pos.qty) * pos.leverage
        : (pos.entryPrice - price) * parseFloat(pos.qty) * pos.leverage;
      const estNet = calcNetPnl(estGross, pos.tradeAmount * pos.leverage, "linear", true, "bybit", holdTimeMs);
      if (estNet >= futMinProfit) {
        closeReason = `TIME-PROFIT (held ${(holdTimeMs / 3600000).toFixed(1)}h, net $${estNet.toFixed(2)} ${isLong ? "LONG" : "SHORT"})`;
      } else if (estNet > 0) {
        console.log(`[Futures] ${symbol} HOLD — time-profit $${estNet.toFixed(2)} < min ($${futMinProfit.toFixed(2)})`);
      }
    }

    // 3. TRAILING STOP: Lock in profits
    if (!closeReason && profitPct > 0) {
      if (isLong) {
        if (!pos.highestPrice || price > pos.highestPrice) pos.highestPrice = price;
        if (pos.highestPrice && profitPct >= trailingActivationPct) {
          const dropFromHigh = (pos.highestPrice - price) / pos.highestPrice;
          // Tighter trailing: 0.4% drop from high (was full trailingDistancePct)
          const tightTrailing = Math.max(0.004, trailingDistancePct * 0.6);
          if (dropFromHigh >= tightTrailing) {
            const estGross = (price - pos.entryPrice) * parseFloat(pos.qty) * pos.leverage;
            const estNet = calcNetPnl(estGross, pos.tradeAmount * pos.leverage, "linear", true, "bybit", holdTimeMs);
            if (estNet >= futMinProfit) closeReason = `TRAILING-STOP (high=${pos.highestPrice.toFixed(4)}, drop=${(dropFromHigh*100).toFixed(2)}%, net=$${estNet.toFixed(2)} LONG)`;
            else if (estNet > 0) console.log(`[Futures] ${symbol} HOLD — trailing net $${estNet.toFixed(2)} < min ($${futMinProfit.toFixed(2)}) LONG`);
          }
        }
      } else {
        // SHORT: track lowest price, close when price rises from low
        if (!pos.lowestPrice || price < pos.lowestPrice) pos.lowestPrice = price;
        if (pos.lowestPrice && profitPct >= trailingActivationPct) {
          const riseFromLow = (price - pos.lowestPrice) / pos.lowestPrice;
          // Tighter trailing for SHORT: 0.4% rise from low
          const tightTrailingShort = Math.max(0.004, trailingDistancePct * 0.6);
          if (riseFromLow >= tightTrailingShort) {
            const estGross = (pos.entryPrice - price) * parseFloat(pos.qty) * pos.leverage;
            const estNet = calcNetPnl(estGross, pos.tradeAmount * pos.leverage, "linear", true, "bybit", holdTimeMs);
            if (estNet >= futMinProfit) closeReason = `TRAILING-STOP (low=${pos.lowestPrice.toFixed(4)}, rise=${(riseFromLow*100).toFixed(2)}%, net=$${estNet.toFixed(2)} SHORT)`;
            else if (estNet > 0) console.log(`[Futures] ${symbol} HOLD — trailing net $${estNet.toFixed(2)} < min ($${futMinProfit.toFixed(2)}) SHORT`);
          }
        }
        // Protect SHORT gains: if profit > 5% and price rises 0.2% from low, close
        if (!closeReason && profitPct >= 0.05 && pos.lowestPrice) {
          const riseFromLow = (price - pos.lowestPrice) / pos.lowestPrice;
          if (riseFromLow >= 0.002) {
            const estGross = (pos.entryPrice - price) * parseFloat(pos.qty) * pos.leverage;
            const estNet = calcNetPnl(estGross, pos.tradeAmount * pos.leverage, "linear", true, "bybit", holdTimeMs);
            if (estNet >= futMinProfit) closeReason = `PROTECT-PROFIT-SHORT (${(profitPct*100).toFixed(2)}% gain, rise=${(riseFromLow*100).toFixed(2)}% from low, net=$${estNet.toFixed(2)})`;
          }
        }
      }
    }

    // 4. TAKE PROFIT: Dynamic TP
    const effectiveTp = pos.takeProfitPct / 100;
    if (!closeReason && profitPct >= effectiveTp) {
      const estGrossPnl = isLong
        ? (price - pos.entryPrice) * parseFloat(pos.qty) * pos.leverage
        : (pos.entryPrice - price) * parseFloat(pos.qty) * pos.leverage;
      const estNetPnl = calcNetPnl(estGrossPnl, pos.tradeAmount * pos.leverage, "linear", true, "bybit", holdTimeMs);
      if (estNetPnl >= futMinProfit) {
        closeReason = `TAKE-PROFIT (${(profitPct * 100).toFixed(2)}%, net=$${estNetPnl.toFixed(2)} ${isLong ? "LONG" : "SHORT"})`;
      } else if (estNetPnl > 0) {
        console.log(`[Futures] ${symbol} HOLD — TP net $${estNetPnl.toFixed(2)} < min ($${futMinProfit.toFixed(2)}) after fees+funding`);
      } else {
        console.log(`[Futures] ${symbol} HOLD — TP triggered but net $${estNetPnl.toFixed(2)} NEGATIVE after fees+funding`);
      }
    }
    // 5. EXTENDED TP: If profit >= 2x original TP, close to lock in double gains
    if (!closeReason && profitPct >= effectiveTp * 2 && profitPct > 0.01) {
      const estGrossExt = isLong
        ? (price - pos.entryPrice) * parseFloat(pos.qty) * pos.leverage
        : (pos.entryPrice - price) * parseFloat(pos.qty) * pos.leverage;
      const estNetExt = calcNetPnl(estGrossExt, pos.tradeAmount * pos.leverage, "linear", true, "bybit", holdTimeMs);
      if (estNetExt > 0) closeReason = `EXTENDED-TP (${(profitPct * 100).toFixed(2)}% = 2x TP, net=$${estNetExt.toFixed(2)} ${isLong ? "LONG" : "SHORT"})`;
    }

    if (closeReason) {
      // Close: LONG → Sell, SHORT → Buy
      const closeSide = isLong ? "Sell" : "Buy";
      const orderId = await placeOrder(engine, symbol, closeSide, pos.qty, "linear");
      if (!orderId && !engine.simulationMode) {
        const idx = engine.futuresPositions[symbol]?.findIndex(p => p.entryPrice === pos.entryPrice && p.qty === pos.qty);
        if (idx !== undefined && idx >= 0) {
          engine.futuresPositions[symbol]!.splice(idx, 1);
          console.log(`[Futures] Removed phantom ${isLong ? "LONG" : "SHORT"} ${symbol} entry=${pos.entryPrice} — close failed`);
        }
        await db.deleteOpenPosition(engine.userId, symbol, pos.entryPrice, pos.qty, "bybit");
        continue;
      }
      if (orderId) {
        const grossPnl = isLong
          ? (price - pos.entryPrice) * parseFloat(pos.qty) * pos.leverage
          : (pos.entryPrice - price) * parseFloat(pos.qty) * pos.leverage;
        const pnl = calcNetPnl(grossPnl, pos.tradeAmount * pos.leverage, "linear", true, "bybit", holdTimeMs);
        // Track win/loss for cooldown system
        recordTradeResult(symbol, "futures", pnl > 0);
        // AI + Optimizer feedback: record trade for learning
        try {
          recordTradeForTuning("futures", pnl, (pnl / (pos.tradeAmount * pos.leverage)) * 100);
          recordTradeResultOptimizer(pnl);
          recordTradeForTiming(pnl); // v9.0: Market Timing learning
          recordTradeForLearning({ strategy: "futures", symbol, entryScore: 50, entryRegime: "unknown", entrySession: "unknown", entryFearGreed: 50, entryPatterns: [], pnlPercent: (pnl / (pos.tradeAmount * pos.leverage)) * 100, holdTimeMinutes: 0, timestamp: Date.now() });
        } catch { /* silent */ }

        await db.insertTrade({
          userId: engine.userId, symbol, side: closeSide.toLowerCase() as "buy" | "sell", price: price.toString(),
          qty: pos.qty, pnl: pnl.toFixed(2), strategy: "futures", orderId, simulated: engine.simulationMode,
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

        if (pnl < 0) {
          const state = await db.getOrCreateBotState(engine.userId);
          const currentDrawdown = Math.abs(pnl);
          const maxDrawdown = parseFloat(state?.maxDrawdown ?? "0");
          if (currentDrawdown > maxDrawdown) {
            await db.updateBotState(engine.userId, { maxDrawdown: currentDrawdown.toFixed(2) });
          }
        }

        const emoji = pnl > 0 ? "🎯" : "🛑";
        const dirLabel = isLong ? "LONG" : "SHORT";
        console.log(`[Futures] ${closeReason} ${symbol} @ ${price.toFixed(2)} entry=${pos.entryPrice.toFixed(2)} pnl=$${pnl.toFixed(2)} (${pos.leverage}x ${dirLabel})`);

        await sendTelegramNotification(engine,
          `${emoji} <b>PHANTOM Futures ${closeReason.split(" ")[0]}</b>\nDirección: ${dirLabel}\nPar: ${symbol}\nEntrada: $${pos.entryPrice.toFixed(2)}\nSalida: $${price.toFixed(2)}\nApalancamiento: ${pos.leverage}x\nResultado: <b>$${pnl.toFixed(2)}</b>`
        );

        positions.splice(i, 1);
      }
    }
  }

  // ─── Smart Entry: LONG or SHORT based on scoring ───
  // XAU gets more positions (7), other coins share 5
    const maxPositions = symbol === "XAUUSDT" ? 15 : 8; // v10.4: XAU 15 slots, others 8
  const longPositions = positions.filter(p => (p.direction ?? "long") === "long");
  const shortPositions = positions.filter(p => p.direction === "short");

  if (positions.length >= maxPositions) {
    console.log(`[Futures] ${symbol} SKIP — max ${maxPositions} positions reached`);
    return;
  }

  // ─── Daily Profit Target Guard for Futures ───
  if (dailyProfitMode === "stopped") {
    console.log(`[Futures] ${symbol} SKIP entry — DAILY TARGET 5%+ HIT, no new trades`);
    return;
  }

  // ─── v9.0: Profit Maximizer for Futures ───
  const futKlines = await fetchKlines(engine.client, symbol, "15", 50, "linear");
  const futBreakout = detectBreakoutSignal(futKlines, price);
  const futMeanRev = detectMeanReversionPM(futKlines, price);
  const futTiming = getMarketTimingSignal();
  const futVolProfile = analyzeVolumeProfile(futKlines, price);
  let futPMBoost = 0;
  if (futBreakout.detected && futBreakout.confidence > 60) {
    futPMBoost += Math.round(futBreakout.confidence * 0.3);
    console.log(`[Futures] ${symbol} BREAKOUT: ${futBreakout.reason} — boost +${futPMBoost}`);
  }
  if (futMeanRev.detected && futMeanRev.confidence > 50) {
    futPMBoost += Math.round(futMeanRev.confidence * 0.2);
    console.log(`[Futures] ${symbol} MEAN REVERSION: ${futMeanRev.reason}`);
  }

  // Smart scoring determines entry direction — use master signal when available
  const minFuturesConfidence = dailyProfitMode === "cautious" ? 50 : (symbol === "XAUUSDT" ? 15 : 20); // v10.4: XAU ultra-aggressive, others aggressive
  const futBoostedConf = futEffConf + futPMBoost;
  let entryDirection: "long" | "short" | null = null;

  // Block entry if master signal says blocked
  if (futBlocked) {
    console.log(`[Futures] ${symbol} BLOCKED by master signal: ${futMaster?.blockReason}`);
    return;
  }

  if (futEffDir === "buy" && futBoostedConf >= minFuturesConfidence && longPositions.length < 3) {
    if (futSmartScore.regime !== "strong_trend_down") {
      entryDirection = "long";
    }
  } else if (futEffDir === "sell" && futBoostedConf >= minFuturesConfidence && shortPositions.length < 3) {
    if (futSmartScore.regime !== "strong_trend_up") {
      entryDirection = "short";
    }
  }

  if (dailyProfitMode === "cautious" && entryDirection) {
    console.log(`[Futures] 💡 EXCEPTIONAL ${entryDirection.toUpperCase()} ${symbol} — score ${futEffConf} >= 70 despite daily target`);
  }

  if (!entryDirection) {
    console.log(`[Futures] ${symbol} SKIP entry — score=${futEffConf} dir=${futEffDir} regime=${futSmartScore.regime}`);
    return;
  }

  const strat = futStrat;
  const config = futConfig;
  const leverage = config?.leverage ?? 5;
  const allocation = strat?.allocationPct ?? 25;
  const state = await db.getOrCreateBotState(engine.userId);
  const balance = parseFloat(state?.currentBalance ?? "5000");
  // Smart sizing: confidence-weighted + cooldown + BOOST + master signal multiplier
  const baseTradeAmount = (balance * allocation / 100) / maxPositions;
  const strengthBoost = futEffConf > 80 ? 2.0 : futEffConf > 65 ? 1.5 : 1.0;
  // v9.1.1: XAU futures gets 1.5x extra sizing (top earner)
  const futXauBoost = symbol === "XAUUSDT" ? 2.5 : 1.0; // v10.4: XAU futures 2.5x sizing
  // v9.0: Market Timing + Volume Profile sizing for futures
  const futTimingMult = futTiming.sizingMultiplier;
  const futVPBoost = futVolProfile.isHighVolumeZone ? 1.2 : 0.85;
  const tradeAmount = baseTradeAmount * futSmartScore.suggestedSizePct * futCooldown * strengthBoost * futMasterSizing * futTimingMult * futVPBoost * futXauBoost;
  const qty = ((tradeAmount * leverage) / price).toFixed(6);

  // LONG → Buy to open, SHORT → Sell to open
  const entrySide = entryDirection === "long" ? "Buy" : "Sell";
  const orderId = await placeOrder(engine, symbol, entrySide, qty, "linear");
  if (orderId) {
    positions.push({
      symbol, entryPrice: price, qty, leverage,
      takeProfitPct: dynamicTpPct,
      tradeAmount, openedAt: Date.now(),
      direction: entryDirection,
    });

    await db.insertTrade({
      userId: engine.userId, symbol, side: entrySide.toLowerCase() as "buy" | "sell", price: price.toString(),
      qty, pnl: "0.00", strategy: "futures", orderId, simulated: engine.simulationMode,
    });

    console.log(`[Futures] ${entryDirection.toUpperCase()} ${symbol} @ ${price.toFixed(2)} qty=${qty} leverage=${leverage}x TP=${dynamicTpPct.toFixed(1)}% score=${futSmartScore.confidence} regime=${futSmartScore.regime} order=${orderId}`);

    // Telegram notification for futures entry
    const dirEmoji = entryDirection === "long" ? "🟢" : "🔴";
    const dirLabel = entryDirection === "long" ? "LONG" : "SHORT";
    const masterReasons = futMaster?.reasons?.slice(0, 3).join(", ") ?? futSmartScore.reasons.slice(0, 3).join(", ");
    await sendTelegramNotification(engine,
      `${dirEmoji} <b>PHANTOM Futures ${dirLabel}</b>\n` +
      `Par: ${symbol}\n` +
      `Entrada: $${price.toFixed(2)}\n` +
      `Apalancamiento: ${leverage}x\n` +
      `Monto: $${tradeAmount.toFixed(2)}\n` +
      `TP: ${dynamicTpPct.toFixed(1)}%\n` +
      `Score: ${futEffConf} | Régimen: ${futSmartScore.regime}\n` +
      `Master: ${masterReasons}`
    );
  }
}

// Backward compatibility alias
const runFuturesLongOnly = runFuturesStrategy;

// ─── Opportunity Scanner (Smart Analysis v6.0 + Market Intelligence v7.0) ───
async function runOpportunityScanner(engine: EngineState) {
  console.log(`[Scanner] Scanning ${SCANNER_COINS.length} coins with Smart+Master Analysis...`);
  for (const symbol of SCANNER_COINS) {
    try {
      const klines = await fetchKlines(null, symbol, "15", 50, "spot");
      if (klines.closes.length < 26) continue;

      const price = klines.closes[klines.closes.length - 1];

      // Full smart analysis
      const score = calculateSignalScore(klines, price);

      // Master signal for enhanced scanning
      let scanMaster: MasterSignal | null = null;
      try {
        const k5m = await fetchKlines(null, symbol, "5", 60, "spot");
        const k1h = await fetchKlines(null, symbol, "60", 60, "spot");
        const miState = await db.getOrCreateBotState(engine.userId);
        const miCap = parseFloat(miState?.currentBalance ?? "5000");
        scanMaster = aggregateMasterSignal({
          symbol, currentPrice: price, klines5m: k5m, klines15m: klines, klines1h: k1h,
          totalCapital: miCap, proposedAmount: miCap * 0.05,
          todayPnl: parseFloat(miState?.todayPnl ?? "0"), currentBalance: miCap, strategy: "grid",
        });
      } catch { /* use score only */ }

      // Use best available confidence
      const effConf = scanMaster ? Math.max(score.confidence, scanMaster.confidence) : score.confidence;
      const effDir = scanMaster ? scanMaster.direction : score.direction;

      // Map direction to signal label
      let signal: string | null = null;
      if (effDir === "buy" && effConf >= 70) signal = "STRONG BUY";
      else if (effDir === "buy" && effConf >= 40) signal = "BUY";
      else if (effDir === "sell" && effConf >= 70) signal = "STRONG SELL";
      else if (effDir === "sell" && effConf >= 40) signal = "SELL";

      // Also detect mean reversion and breakout opportunities
      const meanRev = detectMeanReversion(klines, price);
      if (meanRev?.active && !signal) {
        signal = meanRev.direction === "buy" ? "MEAN REVERSION BUY" : "MEAN REVERSION SELL";
      }
      const breakout = detectBreakout(klines, price);
      if (breakout?.active && !signal) {
        signal = breakout.direction === "buy" ? "BREAKOUT BUY" : "BREAKOUT SELL";
      }

      if (signal && effConf >= 35 && score.reasons.length >= 1) {
        const confidence = Math.min(effConf, 95);
        const allReasons = [...score.reasons, ...(scanMaster?.reasons ?? [])].slice(0, 6);
        await db.insertOpportunity({
          userId: engine.userId, symbol, signal, price: price.toString(),
          confidence, reasons: allReasons, isRead: false,
        });
        console.log(`[Scanner] ${signal} ${symbol} @ ${price} confidence=${confidence}% regime=${score.regime} master=${scanMaster ? 'yes' : 'no'}`);
        if (confidence >= 70) {
          try {
            const { notifyOwner } = await import("./_core/notification");
            await notifyOwner({
              title: `📊 PHANTOM: ${signal} ${symbol} (${confidence}%)`,
              content: `Par: ${symbol}\nSeñal: ${signal}\nConfianza: ${confidence}%\nRégimen: ${score.regime}\nPrecio: $${price.toFixed(4)}\nRazones: ${allReasons.join(", ")}`,
            });
          } catch { /* non-blocking */ }

          if (confidence >= 80) {
            await sendTelegramNotification(engine,
              `📊 <b>PHANTOM Scanner: ${signal}</b>\nPar: ${symbol}\nPrecio: $${price.toFixed(4)}\nConfianza: ${confidence}%\nRégimen: ${score.regime}\n${allReasons.join("\n")}`
            );
          }
        }
      }

      // Update arbitrage prices for multi-exchange scanning
      updateArbPrice(symbol, "bybit", price);

      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      // Skip this coin on error
    }
  }
}

// ─── SP500 via Yahoo Finance ───
async function fetchSP500Price(): Promise<TickerData | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=5d`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
    const data = await res.json() as any;
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error("No meta in Yahoo Finance response");

    const price = meta.regularMarketPrice ?? 0;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const pctChange = prevClose > 0 ? (price - prevClose) / prevClose : 0;
    return {
      symbol: "SP500", lastPrice: price, bid1Price: price, ask1Price: price,
      price24hPcnt: pctChange, highPrice24h: meta.regularMarketDayHigh ?? price,
      lowPrice24h: meta.regularMarketDayLow ?? price, volume24h: meta.regularMarketVolume ?? 0,
      turnover24h: 0,
    };
  } catch (e) {
    console.error("[PriceFeed] SP500 Yahoo Finance fetch failed:", (e as Error).message);
    return null;
  }
}

async function updateLivePrices(_client?: RestClientV5) {
  // Prices are fed by WebSocket — this is a no-op
}

// ─── Engine Control ───
export async function startEngine(userId: number): Promise<{ success: boolean; error?: string }> {
  if (engines.has(userId)) {
    return { success: false, error: "Engine already running" };
  }

  const state = await db.getOrCreateBotState(userId);
  const simulationMode = state?.simulationMode ?? true;
  const selectedExchange = (state as any)?.selectedExchange ?? "bybit";

  // Load Telegram config
  let telegramBotToken: string | undefined;
  let telegramChatId: string | undefined;
  try {
    const tgKey = await db.getApiKey(userId, "telegram" as any);
    if (tgKey) {
      telegramBotToken = tgKey.apiKey;
      telegramChatId = tgKey.apiSecret;
    }
  } catch { /* no telegram config */ }

  let client: RestClientV5 = new RestClientV5({});
  let kucoinClient: any = null;

  if (simulationMode) {
    console.log(`[Engine] Starting in SIMULATION mode (${selectedExchange}) for user ${userId}`);
  } else if (selectedExchange === "both") {
    const bybitKeys = await db.getApiKey(userId, "bybit");
    const kucoinKeys = await db.getApiKey(userId, "kucoin");
    if (bybitKeys) {
      client = new RestClientV5({ key: bybitKeys.apiKey, secret: bybitKeys.apiSecret });
      console.log(`[Engine] BOTH mode: Bybit client initialized for user ${userId}`);
    } else {
      console.log(`[Engine] BOTH mode: No Bybit keys, using public client`);
    }
    if (kucoinKeys) {
      try {
        const { SpotClient } = await import("kucoin-api");
        kucoinClient = new SpotClient({
          apiKey: kucoinKeys.apiKey, apiSecret: kucoinKeys.apiSecret,
          apiPassphrase: kucoinKeys.passphrase ?? "",
        });
        console.log(`[Engine] BOTH mode: KuCoin client initialized for user ${userId}`);
      } catch (e) {
        console.error(`[Engine] BOTH mode: Failed to create KuCoin client:`, (e as Error).message);
      }
    } else {
      console.log(`[Engine] BOTH mode: No KuCoin keys, KuCoin will be skipped`);
    }
    console.log(`[Engine] Starting in LIVE mode (BOTH: Bybit + KuCoin) for user ${userId}`);
  } else {
    const keys = await db.getApiKey(userId, selectedExchange);
    if (!keys) {
      console.log(`[Engine] Starting in PUBLIC mode (${selectedExchange}) for user ${userId}`);
    } else if (selectedExchange === "kucoin") {
      try {
        const { SpotClient } = await import("kucoin-api");
        kucoinClient = new SpotClient({
          apiKey: keys.apiKey, apiSecret: keys.apiSecret,
          apiPassphrase: keys.passphrase ?? "",
        });
        console.log(`[Engine] Starting in LIVE mode (KuCoin) for user ${userId}`);
      } catch (e) {
        console.error(`[Engine] Failed to create KuCoin client:`, (e as Error).message);
        return { success: false, error: "Failed to initialize KuCoin client" };
      }
    } else {
      client = new RestClientV5({ key: keys.apiKey, secret: keys.apiSecret });
      console.log(`[Engine] Starting in LIVE mode (Bybit) for user ${userId}`);
    }
  }

  const engine: EngineState = {
    userId, exchange: selectedExchange, client, kucoinClient,
    isRunning: true, simulationMode,
    gridLevels: {}, lastPrices: {}, openBuyPositions: {},
    futuresPositions: {}, dcaPositions: {}, scalpPositions: {},
    telegramBotToken, telegramChatId,
  };

  engines.set(userId, engine);
  await db.updateBotState(userId, { isRunning: true, startedAt: new Date() });
  await updateLivePrices(client);
  engineCycles.set(userId, 0);

  // ─── Restore open positions from DB (survive restarts) ───
  // Always restore positions (both LIVE and simulation) so sells can find paired buys
  try {
    const savedBybit = await db.loadOpenPositions(userId, "bybit");
    const savedKucoin = await db.loadOpenPositions(userId, "kucoin");
    let totalRestored = 0;
    for (const [sym, positions] of Object.entries(savedBybit)) {
      engine.openBuyPositions[sym] = [...(engine.openBuyPositions[sym] ?? []), ...positions];
      totalRestored += positions.length;
    }
    for (const [sym, positions] of Object.entries(savedKucoin)) {
      engine.openBuyPositions[sym] = [...(engine.openBuyPositions[sym] ?? []), ...positions];
      totalRestored += positions.length;
    }
    if (totalRestored > 0) {
      console.log(`[Engine] Restored ${totalRestored} open positions from DB for user ${userId} (mode: ${simulationMode ? 'SIM' : 'LIVE'})`);
    }
  } catch (e) {
    console.error(`[Engine] Failed to restore positions:`, (e as Error).message);
  }

  // Main trading loop — every 30 seconds
  engine.intervalId = setInterval(async () => {
    if (!engine.isRunning) return;
    try {
      const cycleNum = (engineCycles.get(userId) ?? 0) + 1;
      engineCycles.set(userId, cycleNum);

      // ─── MARKET INTELLIGENCE: Update BTC state every cycle ───
      try {
        const btcTicker = livePrices.get("BTCUSDT");
        if (btcTicker) {
          updateBTCState(btcTicker.lastPrice);
        } else {
          const btcData = await fetchTicker(engine.client, "BTCUSDT", "linear");
          if (btcData) updateBTCState(btcData.lastPrice);
        }
      } catch { /* silent */ }

      // ─── MARKET INTELLIGENCE: Session & Momentum logging ───
      const currentSession = getCurrentSession();
      const intradayBoost = getIntradayMomentumBoost();
      if (cycleNum % 20 === 1) {
        console.log(`[Intelligence] Session=${currentSession.session} aggressiveness=${currentSession.aggressiveness} intradayBoost=${intradayBoost} reason=${currentSession.reason}`);
      }

      // ─── MARKET INTELLIGENCE: Drawdown check ───
      try {
        const ddState = await db.getOrCreateBotState(userId);
        const ddPnl = parseFloat(ddState?.todayPnl ?? "0");
        const ddBal = parseFloat(ddState?.currentBalance ?? "5000");
        updateDrawdownState(ddBal, ddPnl);
        const ddCheck = getDrawdownMultiplier();
        if (ddCheck.mode !== "normal" && cycleNum % 10 === 1) {
          console.log(`[Intelligence] DRAWDOWN: mode=${ddCheck.mode} multiplier=${ddCheck.multiplier} reason=${ddCheck.reason}`);
        }
      } catch { /* silent */ }

      // ─── MARKET INTELLIGENCE: Arbitrage scan (every 10 cycles) ───
      if (cycleNum % 10 === 0 && engine.exchange === "both") {
        try {
          const arbOpps = scanArbitrage(0.3);
          if (arbOpps.length > 0) {
            console.log(`[Intelligence] Arbitrage opportunities: ${arbOpps.map(a => `${a.symbol} ${a.spreadPct.toFixed(2)}%`).join(", ")}`);
          }
        } catch { /* silent */ }
      }

      // ─── AI ENGINE: Fear & Greed + Sentiment (every 20 cycles ~5min) ───
      if (cycleNum % 20 === 0) {
        try {
          const fgData = await fetchFearGreedIndex();
          const fgSignal = getFearGreedSignal(fgData);
          if (fgSignal.strength > 30) {
            console.log(`[AI] Fear&Greed: ${fgData?.score ?? '?'} (${fgData?.label ?? '?'}) → ${fgSignal.direction} (${fgSignal.strength}%)`);
          }
        } catch { /* silent */ }
      }

      // ─── AUTO-OPTIMIZER: Tune parameters every 120 cycles (~30min) ───
      if (cycleNum % 120 === 0) {
        try {
          const tuning = autoTuneParameters();
          const adaptive = getAdaptiveState();
          console.log(`[Optimizer] Auto-tune: mode=${adaptive.mode} aggressiveness=${adaptive.aggressiveness.toFixed(2)} WR=${(adaptive.recentWinRate*100).toFixed(0)}%`);
          // Generate performance report
          const perfReport = generatePerformanceReport();
          if (perfReport.totalTrades > 0) {
            console.log(`[Optimizer] Performance: WR=${(perfReport.winRate*100).toFixed(0)}% PF=${perfReport.profitFactor.toFixed(2)} Sharpe=${perfReport.sharpeRatio.toFixed(2)} trades=${perfReport.totalTrades}`);
          }
        } catch { /* silent */ }
      }

      // ─── ADVANCED DATA: On-chain + Open Interest + Whale (every 30 cycles ~7.5min) ───
      if (cycleNum % 30 === 0) {
        try {
          for (const sym of ["BTCUSDT", "ETHUSDT"]) {
            const price = livePrices.get(sym)?.lastPrice ?? 0;
            const advData = await getAdvancedDataSignal(sym, price, 1000000, 500000, 0, 1.5);
            if (advData.confidence > 40) {
              console.log(`[AdvData] ${sym}: ${advData.direction} conf=${advData.confidence}% reasons=${advData.reasons.join(", ")}`);
            }
          }
        } catch { /* silent */ }
      }

      // ─── ANOMALY DETECTION: Check for unusual market behavior (every 15 cycles ~3.75min) ───
      if (cycleNum % 15 === 0) {
        try {
          for (const sym of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
            const klines = klineCache.get(`${sym}_15`)?.data;
            if (klines && klines.closes.length > 20) {
              const anomalyResult = detectAnomaly(klines, livePrices.get(sym)?.lastPrice ?? 0);
              const anomalies = anomalyResult.detected ? [{ type: anomalyResult.type, severity: anomalyResult.severity, action: anomalyResult.action }] : [];
              if (anomalies.length > 0) {
                console.log(`[AI] Anomalies ${sym}: ${anomalies.map(a => `${a.type}(${a.severity})`).join(", ")}`);
                // Alert on critical anomalies
                const critical = anomalies.filter(a => a.severity === "critical");
                if (critical.length > 0) {
                  await sendTelegramNotification(engine,
                    `⚠️ <b>PHANTOM — Anomalía Detectada</b>\n` +
                    `Par: ${sym}\n` +
                    `Tipo: ${critical.map(a => a.type).join(", ")}\n` +
                    `Acción: ${critical[0].action}`
                  );
                }
              }
            }
          }
        } catch { /* silent */ }
      }

      // ─── PAIR PRICE TRACKING: Update every cycle for pairs trading ───
      try {
        for (const sym of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "AVAXUSDT"]) {
          const ticker = livePrices.get(sym);
          if (ticker) updatePairPrice(sym, ticker.lastPrice);
        }
      } catch { /* silent */ }

      console.log(`[Engine] Cycle #${cycleNum} for user ${userId} (session=${currentSession.session}, boost=${intradayBoost})`);

      // Periodic position save every 10 cycles (~5 minutes)
      if (cycleNum % 10 === 0) {
        try {
          const posCount = Object.values(engine.openBuyPositions).reduce((s, a) => s + a.length, 0);
          if (posCount > 0) {
            await db.saveOpenPositions(userId, engine.openBuyPositions, engine.exchange === "both" ? "bybit" : engine.exchange);
            if (engine.exchange === "both") {
              await db.saveOpenPositions(userId, engine.openBuyPositions, "kucoin");
            }
            console.log(`[Engine] Periodic save: ${posCount} positions saved to DB`);
          }
        } catch (e) { /* silent */ }
      }

      // ─── Periodic 4h Report via Telegram ───
      if (cycleNum % 720 === 0) {
        try {
          await sendStatusReport(engine);
          console.log(`[Engine] Periodic 4h report sent via Telegram`);
        } catch (e) { /* silent */ }
      }
      // ─── v10.4: FORCE SELL ALL altcoins to USDT (every 2 cycles ~20s) ───
      if (cycleNum % 2 === 0) { // v10.4: liquidate ALL altcoins ASAP
        try {
          await autoConvertCoinsToUSDT(engine);
          console.log(`[Engine] Auto-convert check completed`);
        } catch (e) { /* silent */ }
      }
      // ─── Drawdown Alert (check every 10 cycles) ───
      if (cycleNum % 10 === 0) {
        try {
          const ddState = await db.getOrCreateBotState(userId);
          const ddTodayPnl = parseFloat(ddState?.todayPnl ?? "0");
          const DRAWDOWN_THRESHOLD = -100; // v10: more room to operate ($100 threshold)
          const todayStr = new Date().toISOString().slice(0, 10);
          if (ddTodayPnl <= DRAWDOWN_THRESHOLD && engine.lastDrawdownAlertDate !== todayStr) {
            engine.lastDrawdownAlertDate = todayStr;
            await sendTelegramNotification(engine,
              `\u{1F6A8} <b>PHANTOM — Alerta de Drawdown</b>\n\n` +
              `P\u00E9rdida del d\u00EDa: <b>$${ddTodayPnl.toFixed(2)}</b>\n` +
              `Umbral configurado: $${DRAWDOWN_THRESHOLD}\n\n` +
              `\u26A0\uFE0F Considera revisar las estrategias activas o detener el bot.\n` +
              `Usa /status para ver el estado actual.`
            );
            console.log(`[Engine] Drawdown alert sent: todayPnl=$${ddTodayPnl.toFixed(2)} threshold=$${DRAWDOWN_THRESHOLD}`);
          }
        } catch (e) { /* silent */ }
      }

      // ─── DAILY PROFIT TARGET SYSTEM ───
      // When daily profit reaches 2%+: only allow exceptional opportunities (score >= 75)
      // When daily profit reaches 5%+: STOP all new trades completely
      const DAILY_TARGET_CAUTIOUS = 0.10; // v10.4: 10% = cautious mode (was 4%)
      const DAILY_TARGET_STOP = 0.25;     // v10.4: 25% = stop only at extreme gains (was 8%)
      const EXCEPTIONAL_SCORE = 75;       // Only trade with score >= 75 in cautious mode

      let dailyProfitMode: "normal" | "cautious" | "stopped" = "normal";
      try {
        const dpState = await db.getOrCreateBotState(userId);
        const todayPnl = parseFloat(dpState?.todayPnl ?? "0");
        const capital = parseFloat(dpState?.initialBalance ?? dpState?.currentBalance ?? "5000");
        const dailyProfitPct = capital > 0 ? todayPnl / capital : 0;

        if (dailyProfitPct >= DAILY_TARGET_STOP) {
          dailyProfitMode = "stopped";
          // Notify once per day
          const todayStr = new Date().toISOString().slice(0, 10);
          const stopKey = `daily_stop_${todayStr}`;
          if (!lastErrorNotif.has(stopKey)) {
            lastErrorNotif.set(stopKey, Date.now());
            await sendTelegramNotification(engine,
              `🏆 <b>PHANTOM — Meta Diaria Alcanzada!</b>\n\n` +
              `Ganancia hoy: <b>+$${todayPnl.toFixed(2)} (+${(dailyProfitPct * 100).toFixed(1)}%)</b>\n` +
              `Capital: $${capital.toFixed(2)}\n\n` +
              `🛑 Bot en PAUSA — protegiendo ganancias del día.\n` +
              `Las posiciones abiertas siguen cerrándose normalmente.`
            );
          }
          console.log(`[Engine] 🏆 DAILY TARGET HIT: +${(dailyProfitPct * 100).toFixed(1)}% ($${todayPnl.toFixed(2)}) — STOPPED (>= 5%)`);
        } else if (dailyProfitPct >= DAILY_TARGET_CAUTIOUS) {
          dailyProfitMode = "cautious";
          // Notify once per day
          const todayStr = new Date().toISOString().slice(0, 10);
          const cautionKey = `daily_cautious_${todayStr}`;
          if (!lastErrorNotif.has(cautionKey)) {
            lastErrorNotif.set(cautionKey, Date.now());
            await sendTelegramNotification(engine,
              `✅ <b>PHANTOM — Meta Diaria 2% Alcanzada</b>\n\n` +
              `Ganancia hoy: <b>+$${todayPnl.toFixed(2)} (+${(dailyProfitPct * 100).toFixed(1)}%)</b>\n\n` +
              `🧠 Modo INTELIGENTE activado — solo operaciones excepcionales (score >= ${EXCEPTIONAL_SCORE}).`
            );
          }
          console.log(`[Engine] ✅ DAILY TARGET 2%: +${(dailyProfitPct * 100).toFixed(1)}% ($${todayPnl.toFixed(2)}) — CAUTIOUS MODE (only score >= ${EXCEPTIONAL_SCORE})`);
        }
      } catch (e) { /* keep normal mode on error */ }

      const strats = await db.getUserStrategies(userId);
      console.log(`[Engine] Found ${strats.length} strategies, ${strats.filter(s => s.enabled).length} enabled (dailyMode=${dailyProfitMode})`);

      for (const strat of strats) {
        if (!strat.enabled) continue;
        const cat = strat.category === "linear" ? "linear" : "spot";

        // XAUUSDT and XAGUSD always run on Bybit
        if (strat.symbol === "XAUUSDT" || strat.symbol === "XAGUSD" || strat.symbol === "SPXUSDT" || strat.symbol === "SP500USDT") {
          if (engine.exchange === "kucoin") {
            const bybitKeys = await db.getApiKey(userId, "bybit");
            if (bybitKeys) {
              const bybitClient = new RestClientV5({ key: bybitKeys.apiKey, secret: bybitKeys.apiSecret });
              const bybitEngine: EngineState = { ...engine, client: bybitClient, exchange: "bybit", kucoinClient: null };
              console.log(`[Engine] Running ${strat.strategyType} for ${strat.symbol} on Bybit (forced)`);
              if (strat.strategyType === "scalping") await runScalpingStrategy(bybitEngine, strat.symbol, "linear", dailyProfitMode);
              else if (strat.strategyType === "futures") await runFuturesLongOnly(bybitEngine, strat.symbol, dailyProfitMode);
              else await runGridStrategy(bybitEngine, strat.symbol, "linear", dailyProfitMode);
            } else {
              console.log(`[Engine] Skipping ${strat.symbol} — no Bybit keys available`);
            }
          } else {
            console.log(`[Engine] Running ${strat.strategyType} for ${strat.symbol} on Bybit`);
            if (strat.strategyType === "scalping") await runScalpingStrategy(engine, strat.symbol, "linear", dailyProfitMode);
            else if (strat.strategyType === "futures") await runFuturesLongOnly(engine, strat.symbol, dailyProfitMode);
            else await runGridStrategy(engine, strat.symbol, "linear", dailyProfitMode);
          }
          continue;
        }

        // Futures strategy always on Bybit
        if (strat.strategyType === "futures") {
          if (engine.exchange === "kucoin") {
            const bybitKeys = await db.getApiKey(userId, "bybit");
            if (bybitKeys) {
              const bybitClient = new RestClientV5({ key: bybitKeys.apiKey, secret: bybitKeys.apiSecret });
              const bybitEngine: EngineState = { ...engine, client: bybitClient, exchange: "bybit", kucoinClient: null };
              console.log(`[Engine] Running futures for ${strat.symbol} on Bybit (forced)`);
              await runFuturesLongOnly(bybitEngine, strat.symbol, dailyProfitMode);
            }
          } else {
            console.log(`[Engine] Running futures for ${strat.symbol} on Bybit`);
            const bybitEngine: EngineState = { ...engine, exchange: "bybit", kucoinClient: null };
            await runFuturesLongOnly(bybitEngine, strat.symbol, dailyProfitMode);
          }
          continue;
        }

        // v10.1: FORCE ALL to LINEAR (USDT-settled) — never buy altcoins in spot
        // This keeps 100% of capital in USDT, only trading contracts
        if (engine.exchange === "both") {
          // KuCoin: skip spot entirely, only use Bybit linear
          const bybitEngine: EngineState = { ...engine, exchange: "bybit", kucoinClient: null };
          console.log(`[Engine] Running ${strat.strategyType} for ${strat.symbol} on Bybit LINEAR (USDT-settled)`);
          if (strat.strategyType === "grid") await runGridStrategy(bybitEngine, strat.symbol, "linear", dailyProfitMode);
          else if (strat.strategyType === "scalping") await runScalpingStrategy(bybitEngine, strat.symbol, "linear", dailyProfitMode);
          continue;
        }

        // v10.1: ALWAYS force linear — never spot, capital stays in USDT
        console.log(`[Engine] Running ${strat.strategyType} for ${strat.symbol} LINEAR (USDT-settled)`);
        if (strat.strategyType === "grid") {
          await runGridStrategy(engine, strat.symbol, "linear", dailyProfitMode);
        } else if (strat.strategyType === "scalping") {
          await runScalpingStrategy(engine, strat.symbol, "linear", dailyProfitMode);
        }
      }
    } catch (e) {
      console.error("[Engine] Trading loop error:", (e as Error).message);
    }
  }, 10_000); // 10s cycle (v10: faster for more opportunities) — more frequent = more opportunities captured

  // Opportunity scanner — every 1 minute (aggressive for daily target)
  engine.scannerIntervalId = setInterval(async () => {
    if (!engine.isRunning) return;
    await runOpportunityScanner(engine);
  }, 45_000); // v10: faster scanning

  setTimeout(() => runOpportunityScanner(engine), 3000);

  // Run first trading cycle immediately (mirrors main loop logic for proper exchange routing)
  setTimeout(async () => {
    const strats = await db.getUserStrategies(userId);
    console.log(`[Engine] First cycle: ${strats.length} strategies, ${strats.filter(s => s.enabled).length} enabled`);
    for (const strat of strats) {
      if (!strat.enabled) continue;
      const cat = strat.category === "linear" ? "linear" : "spot";

      // XAUUSDT, XAGUSD, SPXUSDT always route to Bybit
      if (strat.symbol === "XAUUSDT" || strat.symbol === "XAGUSD" || strat.symbol === "SPXUSDT" || strat.symbol === "SP500USDT") {
        if (engine.exchange === "kucoin") {
          const bybitKeys = await db.getApiKey(userId, "bybit");
          if (bybitKeys || engine.simulationMode) {
            const bybitClient = engine.simulationMode ? engine.client : new (await import("bybit-api")).RestClientV5({ key: bybitKeys!.apiKey, secret: bybitKeys!.apiSecret });
            const bybitEngine: EngineState = { ...engine, client: bybitClient, exchange: "bybit", kucoinClient: null };
            console.log(`[Engine] First cycle: ${strat.strategyType} ${strat.symbol} on Bybit (forced)`);
            if (strat.strategyType === "scalping") await runScalpingStrategy(bybitEngine, strat.symbol, "linear");
            else if (strat.strategyType === "futures") await runFuturesLongOnly(bybitEngine, strat.symbol);
            else await runGridStrategy(bybitEngine, strat.symbol, "linear");
          }
        } else {
          console.log(`[Engine] First cycle: ${strat.strategyType} ${strat.symbol} on Bybit`);
          if (strat.strategyType === "scalping") await runScalpingStrategy(engine, strat.symbol, "linear");
          else if (strat.strategyType === "futures") await runFuturesLongOnly(engine, strat.symbol);
          else await runGridStrategy(engine, strat.symbol, "linear");
        }
        continue;
      }

      // Futures always on Bybit
      if (strat.strategyType === "futures") {
        const bybitEngine: EngineState = { ...engine, exchange: "bybit", kucoinClient: null };
        console.log(`[Engine] First cycle: futures ${strat.symbol} on Bybit`);
        await runFuturesLongOnly(bybitEngine, strat.symbol);
        continue;
      }

      // v10.1: FORCE ALL to LINEAR (USDT-settled) — first cycle too
      if (engine.exchange === "both") {
        const bybitEngine: EngineState = { ...engine, exchange: "bybit", kucoinClient: null };
        console.log(`[Engine] First cycle: ${strat.strategyType} ${strat.symbol} on Bybit LINEAR`);
        if (strat.strategyType === "grid") await runGridStrategy(bybitEngine, strat.symbol, "linear");
        else if (strat.strategyType === "scalping") await runScalpingStrategy(bybitEngine, strat.symbol, "linear");
      } else {
        console.log(`[Engine] First cycle: ${strat.strategyType} ${strat.symbol} LINEAR`);
        if (strat.strategyType === "grid") await runGridStrategy(engine, strat.symbol, "linear");
        else if (strat.strategyType === "scalping") await runScalpingStrategy(engine, strat.symbol, "linear");
      }
    }
  }, 2000);

  // ─── Daily Summary Scheduler ───
  // Check every minute if it's 23:00 (VPS time) to send daily summary
  let lastSummaryDate = "";
  engine.dailySummaryId = setInterval(async () => {
    if (!engine.isRunning) return;
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    // Send at 23:00 once per day
    if (hour === 23 && minute === 0 && dateStr !== lastSummaryDate) {
      lastSummaryDate = dateStr;
      await sendDailySummary(engine);
    }
  }, 60_000); // Check every 60 seconds

  // ─── v9.0: Aggressive Compounding (every 1 hour) + Capital Rebalancing (every 4 hours) + Stale Position Checker ───
  let rebalanceCycleCount = 0;
  engine.autoReinvestId = setInterval(async () => {
    if (!engine.isRunning) return;
    try {
      rebalanceCycleCount++;
      // 1. AGGRESSIVE COMPOUNDING: reinvest every hour with $20 minimum (v9.0)
      const reinvestResult = await checkAutoReinvest(engine.userId, 20); // $20 min instead of $50
      if (reinvestResult?.reinvested) {
        console.log(`[v9.0] COMPOUND: $${reinvestResult.amount.toFixed(2)} → ${reinvestResult.target}`);
        await sendTelegramNotification(engine,
          `💰 <b>Compounding Agresivo v9.0</b>\nMonto: $${reinvestResult.amount.toFixed(2)}\nDestino: ${reinvestResult.target}\nNuevo capital: $${reinvestResult.newBalance}`
        );
      }

      // 2. STALE POSITION CHECKER: analyze positions stuck too long
      const allScalpPositions = Object.entries(engine.scalpPositions).flatMap(([sym, positions]) =>
        positions.map(p => ({ symbol: sym, buyPrice: p.buyPrice, currentPrice: engine.lastPrices[sym] ?? p.buyPrice, openedAt: p.openedAt, strategy: "scalping" as const }))
      );
      const allGridPositions = Object.entries(engine.openBuyPositions).flatMap(([sym, positions]) =>
        positions.map(p => ({ symbol: sym, buyPrice: p.buyPrice, currentPrice: engine.lastPrices[sym] ?? p.buyPrice, openedAt: p.openedAt, strategy: "grid" as const }))
      );
      for (const pos of [...allScalpPositions, ...allGridPositions]) {
        // v9.1.1: Faster USDT recovery — shorter stale timeouts
        const staleHours = pos.strategy === "scalping" ? 0.75 : 3; // v10: faster stale detection
        const staleAnalysis = analyzeStalePosition(pos.buyPrice, pos.currentPrice, pos.openedAt, staleHours);
        if (staleAnalysis.isStale) {
          console.log(`[v9.0] STALE: ${pos.symbol} ${pos.strategy} — ${staleAnalysis.recommendation} (held ${staleAnalysis.holdTimeHours.toFixed(1)}h, ${staleAnalysis.priceChangePct.toFixed(2)}%)`);
        }
      }

      // 3. LIQUIDITY ANALYSIS: check USDT availability
      const botState = await db.getOrCreateBotState(engine.userId);
      const currentBal = parseFloat(botState?.currentBalance ?? "5000");
      const investedPct = 1 - (currentBal * 0.3 / currentBal); // rough estimate
      const totalPositions = Object.values(engine.scalpPositions).reduce((a, b) => a + b.length, 0) + Object.values(engine.openBuyPositions).reduce((a, b) => a + b.length, 0);
      const deployedEstimate = currentBal * 0.7; // rough estimate of deployed capital
      const liqAnalysis = analyzeLiquidity(currentBal, deployedEstimate, totalPositions);
      if (liqAnalysis.recommendation === "hold_cash" || liqAnalysis.recommendation === "reduce_exposure") {
        console.log(`[v9.0] LIQUIDITY: ${liqAnalysis.recommendation} — ${liqAnalysis.reason}`);
      }

      // 4. REBALANCE: every 4 cycles (4 hours)
      if (rebalanceCycleCount % 4 === 0) {
        const allocResult = await rebalanceCapital(engine.userId);
        if (allocResult.decisions.length > 0) {
          console.log(`[Allocator] REBALANCE: ${allocResult.decisions.length} changes, top=${allocResult.topPerformer?.strategy} ${allocResult.topPerformer?.symbol}`);
          let msg = `🔄 <b>Capital Rebalanceado v9.0</b>\n\n`;
          for (const d of allocResult.decisions) {
            msg += `${d.newAllocationPct > d.oldAllocationPct ? "⬆️" : "⬇️"} ${d.strategy} ${d.symbol}: ${d.oldAllocationPct}% → ${d.newAllocationPct}%\n`;
          }
          if (allocResult.topPerformer) {
            msg += `\n🏆 Top Performer: ${allocResult.topPerformer.strategy} ${allocResult.topPerformer.symbol} (score=${allocResult.topPerformer.score})`;
          }
          await sendTelegramNotification(engine, msg);
        }
      }
    } catch (e) {
      console.error("[v9.0 Allocator] Error:", (e as Error).message);
    }
  }, 30 * 60 * 1000); // Every 30 min (v10: ultra-aggressive compounding)
  console.log(`[Engine] v9.0 Aggressive Compounding (1h) + Rebalancing (4h) + Stale Checker active`);

  // ─── Telegram Polling for /status command ───
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
          // Only respond to messages from our configured chat
          if (chatId !== engine.telegramChatId) continue;
          if (text === "/status" || text === "/estado") {
            await sendStatusReport(engine);
          } else if (text === "/stats" || text === "/estadisticas") {
            // v8.2: Full stats report with period PnL, top strategies, best/worst trades
            try {
              const report = await buildStatsReport(engine.userId);
              await sendTelegramNotification(engine, report);
            } catch (e) {
              await sendTelegramNotification(engine, `❌ Error generando stats: ${(e as Error).message}`);
            }
          } else if (text === "/allocation" || text === "/capital") {
            // v8.2: Show current capital allocation
            try {
              const perfs = await analyzeStrategyPerformance(engine.userId);
              let msg = `📊 <b>PHANTOM — Capital Allocation</b>\n\n`;
              for (const p of perfs.slice(0, 10)) {
                const emoji = p.score >= 60 ? "🟢" : p.score >= 30 ? "🟡" : "🔴";
                msg += `${emoji} ${p.strategy} ${p.symbol}: ${p.currentAllocation}% → ${p.suggestedAllocation}% (score=${p.score})\n`;
              }
              if (perfs.length > 0) {
                msg += `\n🏆 Top: ${perfs[0].strategy} ${perfs[0].symbol} (score=${perfs[0].score})`;
              }
              await sendTelegramNotification(engine, msg);
            } catch (e) {
              await sendTelegramNotification(engine, `❌ Error: ${(e as Error).message}`);
            }
          } else if (text === "/reinvest" || text === "/reinvertir") {
            // v8.2: Force auto-reinvestment check
            try {
              const result = await checkAutoReinvest(engine.userId);
              if (result?.reinvested) {
                await sendTelegramNotification(engine, `💰 <b>Reinversión ejecutada</b>\nMonto: $${result.amount.toFixed(2)}\nDestino: ${result.target}\nNuevo capital base: $${result.newBalance}`);
              } else {
                await sendTelegramNotification(engine, `ℹ️ No hay ganancias suficientes para reinvertir (mínimo $50 acumulados).`);
              }
            } catch (e) {
              await sendTelegramNotification(engine, `❌ Error: ${(e as Error).message}`);
            }
          } else if (text === "/help" || text === "/ayuda") {
            await sendTelegramNotification(engine,
              `👻 <b>PHANTOM Bot — Comandos</b>\n\n` +
              `/status — Estado actual del bot\n` +
              `/stats — Estadísticas completas (PnL por período, top estrategias)\n` +
              `/allocation — Distribución de capital actual\n` +
              `/reinvest — Forzar reinversión de ganancias\n` +
              `/help — Este mensaje`
            );
          }
        }
      } catch (e) {
        console.error("[Telegram] Polling error:", (e as Error).message);
      }
    }, 10_000); // Poll every 10 seconds
    console.log(`[Engine] Telegram polling started for /status command`);
  }

  return { success: true };
}

// ─── /status Telegram Command Response ───
async function sendStatusReport(engine: EngineState) {
  try {
    const state = await db.getOrCreateBotState(engine.userId);
    const initialDeposit = parseFloat(state?.initialBalance ?? "2500");

    // Count open positions
    const gridCount = Object.values(engine.openBuyPositions).reduce((s, a) => s + a.length, 0);
    const futCount = Object.values(engine.futuresPositions).reduce((s, a) => s + a.length, 0);
    const scalpCount = Object.values(engine.scalpPositions).reduce((s, a) => s + a.length, 0);

    // Get live exchange balances (numeric for real profit calc)
    let bybitBalNum = 0;
    let kucoinBalNum = 0;
    try {
      const bybitKeys = await db.getApiKey(engine.userId, "bybit");
      if (bybitKeys && !engine.simulationMode) {
        const { RestClientV5 } = await import("bybit-api");
        const cl = new RestClientV5({ key: bybitKeys.apiKey, secret: bybitKeys.apiSecret });
        const res = await withRetry(() => cl.getWalletBalance({ accountType: "UNIFIED" }), "Status Bybit balance");
        if (res.retCode === 0) {
          bybitBalNum = parseFloat((res.result as any)?.list?.[0]?.totalEquity ?? "0");
        }
      }
    } catch { /* skip */ }
    try {
      const kucoinKeys = await db.getApiKey(engine.userId, "kucoin");
      if (kucoinKeys && !engine.simulationMode) {
        const { SpotClient } = await import("kucoin-api");
        const cl = new SpotClient({ apiKey: kucoinKeys.apiKey, apiSecret: kucoinKeys.apiSecret, apiPassphrase: kucoinKeys.passphrase ?? "" });
        const [mainRes, tradeRes, hfRes] = await Promise.allSettled([
          withRetry(() => cl.getBalances({ type: "main" }), "Status KuCoin main"),
          withRetry(() => cl.getBalances({ type: "trade" }), "Status KuCoin trade"),
          withRetry(() => cl.getBalances({ type: "trade_hf" as any }), "Status KuCoin trade_hf"),
        ]);
        const prices = getLivePrices();
        const proc = (r: any) => {
          if (r.status !== "fulfilled" || r.value?.code !== "200000") return;
          for (const acc of (r.value.data as any[] ?? [])) {
            const cur = acc.currency;
            const bal = parseFloat(acc.balance ?? "0");
            if (cur === "USDT" || cur === "USDC" || cur === "USD") kucoinBalNum += bal;
            else {
              const p = prices[`${cur}USDT`]?.lastPrice ?? 0;
              if (p > 0) kucoinBalNum += bal * p;
            }
          }
        };
        proc(mainRes); proc(tradeRes); proc(hfRes);
      }
    } catch { /* skip */ }

    const bybitBal = bybitBalNum > 0 ? `$${bybitBalNum.toFixed(2)}` : "N/A";
    const kucoinBal = kucoinBalNum > 0 ? `$${kucoinBalNum.toFixed(2)}` : "N/A";
    const totalBal = bybitBalNum + kucoinBalNum;

    // Real profit = current balance - initial deposit (the TRUE total PnL)
    const realProfit = totalBal - initialDeposit;
    const realProfitPct = initialDeposit > 0 ? ((realProfit / initialDeposit) * 100).toFixed(1) : "0";

    // TODAY's PnL: calculated from actual trades created today (authoritative source)
    const allTrades = await db.getUserTrades(engine.userId, 5000);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayTrades = allTrades.filter(t => new Date(t.createdAt) >= todayStart);
    const todayPnl = todayTrades.reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0);

    // Win rate from all sell trades
    const sellTrades = allTrades.filter(t => t.side === "sell");
    const winTrades = sellTrades.filter(t => parseFloat(t.pnl ?? "0") > 0);
    const winRate = sellTrades.length > 0 ? ((winTrades.length / sellTrades.length) * 100).toFixed(1) : "0";

    // Per-strategy breakdown for today
    const stratBreakdown: Record<string, { count: number; pnl: number }> = {};
    for (const t of todayTrades) {
      const key = t.strategy ?? "unknown";
      if (!stratBreakdown[key]) stratBreakdown[key] = { count: 0, pnl: 0 };
      stratBreakdown[key].count++;
      stratBreakdown[key].pnl += parseFloat(t.pnl ?? "0");
    }
    let stratLines = "";
    for (const [strat, data] of Object.entries(stratBreakdown)) {
      const icon = data.pnl >= 0 ? "\u{1F7E2}" : "\u{1F534}";
      stratLines += `\n  ${icon} ${strat}: ${data.count} ops, ${data.pnl >= 0 ? "+" : ""}$${data.pnl.toFixed(2)}`;
    }

    const todayEmoji = todayPnl >= 0 ? "\u{1F7E2}" : "\u{1F534}";
    const totalEmoji = realProfit >= 0 ? "\u{1F7E2}" : "\u{1F534}";
    const mode = engine.simulationMode ? "\u{1F9EA} SIMULACI\u00D3N" : "\u{1F534} LIVE";
    const uptime = engine.intervalId ? "\u2705 Activo" : "\u26A0\uFE0F Detenido";

    const message = `\u{1F47B} <b>PHANTOM \u2014 Estado Actual</b>\n${mode} | ${uptime}\n\n` +
      `\u{1F4B0} <b>Balances</b>\n  Bybit: ${bybitBal}\n  KuCoin: ${kucoinBal}\n  Total: $${totalBal.toFixed(2)}\n  Capital: $${initialDeposit.toFixed(2)}\n\n` +
      `${todayEmoji} <b>PnL Hoy</b>: ${todayPnl >= 0 ? "+" : ""}$${todayPnl.toFixed(2)}\n` +
      `${totalEmoji} <b>Ganancia Real</b>: ${realProfit >= 0 ? "+" : ""}$${realProfit.toFixed(2)} (${realProfitPct}%)\n\n` +
      `\u{1F4E6} <b>Posiciones Abiertas</b>\n  Grid: ${gridCount}\n  Scalping: ${scalpCount}\n  Futures: ${futCount}\n\n` +
      `\u{1F3AF} <b>Operaciones Hoy</b>: ${todayTrades.length}\n` +
      `\u{1F3C6} <b>Win Rate</b>: ${winRate}% (${sellTrades.length} sells)\n` +
      (stratLines ? `\n\u{1F4CA} <b>Desglose Hoy</b>:${stratLines}\n` : "") +
      `\n\u2014\n<i>PHANTOM Trading Bot</i>`;

    await sendTelegramNotification(engine, message);
    console.log(`[Engine] /status report sent via Telegram for user ${engine.userId}`);
  } catch (e) {
    console.error(`[Engine] Failed to send status report:`, (e as Error).message);
  }
}

// ─── Daily Summary via Telegram ───
async function sendDailySummary(engine: EngineState) {
  if (!engine.telegramBotToken || !engine.telegramChatId) return;
  try {
    // Get today's trades
    const allTrades = await db.getUserTrades(engine.userId, 5000);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayTrades = allTrades.filter(t => new Date(t.createdAt) >= todayStart);
    const todayPnl = todayTrades.reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0);
    const todaySells = todayTrades.filter(t => t.side === "sell");
    const todayWins = todaySells.filter(t => parseFloat(t.pnl ?? "0") > 0);
    const todayWinRate = todaySells.length > 0 ? ((todayWins.length / todaySells.length) * 100).toFixed(1) : "0";

    // Get initial deposit from DB
    const state = await db.getOrCreateBotState(engine.userId);
    const initialDeposit = parseFloat(state?.initialBalance ?? "2500");

    // Count open positions
    const gridCount = Object.values(engine.openBuyPositions).reduce((s, a) => s + a.length, 0);
    const futCount = Object.values(engine.futuresPositions).reduce((s, a) => s + a.length, 0);
    const scalpCount = Object.values(engine.scalpPositions).reduce((s, a) => s + a.length, 0);

    // Get live exchange balances (numeric for real profit calc)
    let bybitBalNum = 0;
    let kucoinBalNum = 0;
    try {
      const bybitKeys = await db.getApiKey(engine.userId, "bybit");
      if (bybitKeys && !engine.simulationMode) {
        const { RestClientV5 } = await import("bybit-api");
        const cl = new RestClientV5({ key: bybitKeys.apiKey, secret: bybitKeys.apiSecret });
        const res = await withRetry(() => cl.getWalletBalance({ accountType: "UNIFIED" }), "DailySummary Bybit balance");
        if (res.retCode === 0) {
          bybitBalNum = parseFloat((res.result as any)?.list?.[0]?.totalEquity ?? "0");
        }
      }
    } catch { /* skip */ }
    try {
      const kucoinKeys = await db.getApiKey(engine.userId, "kucoin");
      if (kucoinKeys && !engine.simulationMode) {
        const { SpotClient } = await import("kucoin-api");
        const cl = new SpotClient({ apiKey: kucoinKeys.apiKey, apiSecret: kucoinKeys.apiSecret, apiPassphrase: kucoinKeys.passphrase ?? "" });
        const [mainRes, tradeRes, hfRes] = await Promise.allSettled([
          withRetry(() => cl.getBalances({ type: "main" }), "DailySummary KuCoin main"),
          withRetry(() => cl.getBalances({ type: "trade" }), "DailySummary KuCoin trade"),
          withRetry(() => cl.getBalances({ type: "trade_hf" as any }), "DailySummary KuCoin trade_hf"),
        ]);
        const prices = getLivePrices();
        const proc = (r: any) => {
          if (r.status !== "fulfilled" || r.value?.code !== "200000") return;
          for (const acc of (r.value.data as any[] ?? [])) {
            const cur = acc.currency;
            const bal = parseFloat(acc.balance ?? "0");
            if (cur === "USDT" || cur === "USDC" || cur === "USD") kucoinBalNum += bal;
            else {
              const p = prices[`${cur}USDT`]?.lastPrice ?? 0;
              if (p > 0) kucoinBalNum += bal * p;
            }
          }
        };
        proc(mainRes); proc(tradeRes); proc(hfRes);
      }
    } catch { /* skip */ }

    const bybitBal = bybitBalNum > 0 ? `$${bybitBalNum.toFixed(2)}` : "N/A";
    const kucoinBal = kucoinBalNum > 0 ? `$${kucoinBalNum.toFixed(2)}` : "N/A";
    const totalBal = bybitBalNum + kucoinBalNum;

    // Real profit = current balance - initial deposit
    const realProfit = totalBal - initialDeposit;
    const realProfitPct = initialDeposit > 0 ? ((realProfit / initialDeposit) * 100).toFixed(1) : "0";

    // Win rate from all sell trades
    const sellTrades = allTrades.filter(t => t.side === "sell");
    const winTrades = sellTrades.filter(t => parseFloat(t.pnl ?? "0") > 0);
    const overallWinRate = sellTrades.length > 0 ? ((winTrades.length / sellTrades.length) * 100).toFixed(1) : "0";

    // Build per-strategy breakdown for today
    const stratBreakdown: Record<string, { count: number; pnl: number }> = {};
    for (const t of todayTrades) {
      const key = t.strategy ?? "unknown";
      if (!stratBreakdown[key]) stratBreakdown[key] = { count: 0, pnl: 0 };
      stratBreakdown[key].count++;
      stratBreakdown[key].pnl += parseFloat(t.pnl ?? "0");
    }
    let stratLines = "";
    for (const [strat, data] of Object.entries(stratBreakdown)) {
      const icon = data.pnl >= 0 ? "🟢" : "🔴";
      stratLines += `\n  ${icon} ${strat}: ${data.count} ops, ${data.pnl >= 0 ? "+" : ""}$${data.pnl.toFixed(2)}`;
    }

    const todayEmoji = todayPnl >= 0 ? "🟢" : "🔴";
    const totalEmoji = realProfit >= 0 ? "🟢" : "🔴";
    const dateFormatted = now.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

    const message = `📊 <b>PHANTOM — Resumen Diario</b>\n📅 ${dateFormatted}\n\n` +
      `💰 <b>Balances</b>\n  Bybit: ${bybitBal}\n  KuCoin: ${kucoinBal}\n  Total: $${totalBal.toFixed(2)}\n  Capital: $${initialDeposit.toFixed(2)}\n\n` +
      `${todayEmoji} <b>PnL del Día</b>: ${todayPnl >= 0 ? "+" : ""}$${todayPnl.toFixed(2)}\n` +
      `${totalEmoji} <b>Ganancia Real</b>: ${realProfit >= 0 ? "+" : ""}$${realProfit.toFixed(2)} (${realProfitPct}%)\n\n` +
      `🎯 <b>Operaciones Hoy</b>: ${todayTrades.length}\n` +
      `🏆 <b>Win Rate Hoy</b>: ${todayWinRate}%\n` +
      `📊 <b>Win Rate Total</b>: ${overallWinRate}% (${sellTrades.length} sells)\n\n` +
      `📦 <b>Posiciones Abiertas</b>: ${gridCount} grid + ${scalpCount} scalp + ${futCount} futures\n\n` +
      (stratLines ? `📊 <b>Desglose por Estrategia</b>:${stratLines}\n\n` : "") +
      `—\n<i>PHANTOM Trading Bot • Resumen automático 23:00</i>`;

    await sendTelegramNotification(engine, message);
    console.log(`[Engine] Daily summary sent via Telegram for user ${engine.userId}`);
  } catch (e) {
    console.error(`[Engine] Failed to send daily summary:`, (e as Error).message);
  }
}

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

  // ─── Save open positions to DB before stopping (survive restarts) ───
  try {
    const posCount = Object.values(engine.openBuyPositions).reduce((sum, arr) => sum + arr.length, 0);
    if (posCount > 0) {
      await db.saveOpenPositions(userId, engine.openBuyPositions, engine.exchange === "both" ? "bybit" : engine.exchange);
      if (engine.exchange === "both") {
        // Also save KuCoin positions separately (they share the same openBuyPositions map)
        await db.saveOpenPositions(userId, engine.openBuyPositions, "kucoin");
      }
      console.log(`[Engine] Saved ${posCount} open positions to DB for user ${userId}`);
    }
  } catch (e) {
    console.error(`[Engine] Failed to save positions on stop:`, (e as Error).message);
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

// Get open positions with unrealized PnL for dashboard
export function getOpenPositions(userId: number): { grid: { symbol: string; buyPrice: number; currentPrice: number; qty: string; unrealizedPnl: number; holdTime: number; highestPrice: number }[]; futures: { symbol: string; entryPrice: number; currentPrice: number; qty: string; leverage: number; unrealizedPnl: number; holdTime: number }[] } {
  const engine = engines.get(userId);
  if (!engine) return { grid: [], futures: [] };

  const gridPositions: { symbol: string; buyPrice: number; currentPrice: number; qty: string; unrealizedPnl: number; holdTime: number; highestPrice: number }[] = [];
  for (const [symbol, positions] of Object.entries(engine.openBuyPositions)) {
    const currentPrice = engine.lastPrices[symbol] ?? livePrices.get(symbol)?.lastPrice ?? 0;
    for (const pos of positions) {
      const unrealizedPnl = (currentPrice - pos.buyPrice) * parseFloat(pos.qty);
      gridPositions.push({
        symbol,
        buyPrice: pos.buyPrice,
        currentPrice,
        qty: pos.qty,
        unrealizedPnl,
        holdTime: Date.now() - (pos.openedAt ?? Date.now()),
        highestPrice: pos.highestPrice ?? currentPrice,
      });
    }
  }

  const futuresPos: { symbol: string; entryPrice: number; currentPrice: number; qty: string; leverage: number; unrealizedPnl: number; holdTime: number }[] = [];
  for (const [symbol, positions] of Object.entries(engine.futuresPositions)) {
    const currentPrice = engine.lastPrices[symbol] ?? livePrices.get(symbol)?.lastPrice ?? 0;
    for (const pos of positions) {
      const unrealizedPnl = (currentPrice - pos.entryPrice) * parseFloat(pos.qty) * pos.leverage;
      futuresPos.push({
        symbol,
        entryPrice: pos.entryPrice,
        currentPrice,
        qty: pos.qty,
        leverage: pos.leverage,
        unrealizedPnl,
        holdTime: Date.now() - pos.openedAt,
      });
    }
  }

  return { grid: gridPositions, futures: futuresPos };
}

// ─── Multi-Exchange WebSocket Price Feed ───
let wsSpot: WebSocket | null = null;
let wsLinear: WebSocket | null = null;
let wsKucoin: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsKucoinReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsInitialized = false;

const SPOT_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT",
  "ADAUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT", "MATICUSDT",
  "SHIBUSDT", "LTCUSDT", "UNIUSDT", "ATOMUSDT", "NEARUSDT",
  "APTUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT", "SEIUSDT",
  "TIAUSDT", "INJUSDT", "FETUSDT", "RENDERUSDT", "WIFUSDT",
  "PEPEUSDT", "FLOKIUSDT", "BONKUSDT", "JUPUSDT", "AAVEUSDT",
  "MKRUSDT", "FILUSDT",
];
const LINEAR_SYMBOLS = ["XAUUSDT", "SPXUSDT", "SP500USDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "AVAXUSDT"];

function parseWsTickerMsg(data: Buffer | string): void {
  try {
    const msg = JSON.parse(data.toString()) as any;
    if (!msg.data) return;
    const t = msg.data;
    if (!t.symbol || !t.lastPrice) return;
    const existing = livePrices.get(t.symbol);
    const ticker: TickerData = {
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      bid1Price: parseFloat(t.bid1Price ?? t.lastPrice),
      ask1Price: parseFloat(t.ask1Price ?? t.lastPrice),
      price24hPcnt: parseFloat(t.price24hPcnt ?? existing?.price24hPcnt ?? "0"),
      highPrice24h: parseFloat(t.highPrice24h ?? existing?.highPrice24h ?? t.lastPrice),
      lowPrice24h: parseFloat(t.lowPrice24h ?? existing?.lowPrice24h ?? t.lastPrice),
      volume24h: parseFloat(t.volume24h ?? existing?.volume24h ?? "0"),
      turnover24h: parseFloat(t.turnover24h ?? existing?.turnover24h ?? "0"),
    };
    livePrices.set(t.symbol, ticker);
  } catch { /* ignore parse errors */ }
}

function connectBybitWS(url: string, symbols: string[], label: string): WebSocket {
  const ws = new WebSocket(url);
  ws.on("open", () => {
    console.log(`[PriceFeed] ${label} WS connected — subscribing to ${symbols.length} symbols`);
    const args = symbols.map(s => `tickers.${s}`);
    for (let i = 0; i < args.length; i += 10) {
      ws.send(JSON.stringify({ op: "subscribe", args: args.slice(i, i + 10) }));
    }
  });
  ws.on("message", (data) => {
    parseWsTickerMsg(data as Buffer);
    if (!wsInitialized && livePrices.size >= 2) {
      wsInitialized = true;
      console.log(`[PriceFeed] Initial prices loaded via WebSocket (${livePrices.size} symbols)`);
    }
  });
  ws.on("error", (e) => {
    console.error(`[PriceFeed] ${label} WS error:`, e.message);
  });
  ws.on("close", () => {
    console.warn(`[PriceFeed] ${label} WS closed — reconnecting in 5s...`);
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(() => startBybitWebSocketFeed(), 5000);
  });
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: "ping" }));
    } else {
      clearInterval(pingInterval);
    }
  }, 20_000);
  return ws;
}

export function startBackgroundPriceFeed() {
  startBybitWebSocketFeed();
  startKuCoinWebSocketFeed();
}

function startBybitWebSocketFeed() {
  if (wsSpot && wsSpot.readyState !== WebSocket.CLOSED) wsSpot.terminate();
  if (wsLinear && wsLinear.readyState !== WebSocket.CLOSED) wsLinear.terminate();

  console.log("[PriceFeed] Starting Bybit WebSocket price feed...");
  wsSpot = connectBybitWS("wss://stream.bybit.com/v5/public/spot", SPOT_SYMBOLS, "Spot");
  wsLinear = connectBybitWS("wss://stream.bybit.com/v5/public/linear", LINEAR_SYMBOLS, "Linear");

  updateSP500Price();
  setInterval(updateSP500Price, 60_000);
}

async function getKuCoinWsToken(): Promise<{ token: string; endpoint: string } | null> {
  try {
    const res = await fetch("https://api.kucoin.com/api/v1/bullet-public", { method: "POST" });
    const json = await res.json() as any;
    if (json.code === "200000" && json.data?.token && json.data?.instanceServers?.[0]) {
      return { token: json.data.token, endpoint: json.data.instanceServers[0].endpoint };
    }
  } catch (e) {
    console.error("[PriceFeed] KuCoin token fetch failed:", (e as Error).message);
  }
  return null;
}

function parseKuCoinTickerMsg(data: Buffer | string): void {
  try {
    const msg = JSON.parse(data.toString()) as any;
    if (msg.type !== "message" || !msg.data) return;
    const t = msg.data;
    const rawSymbol = msg.topic?.split(":")[1];
    if (!rawSymbol) return;
    const symbol = rawSymbol.replace("-", "");
    const existing = livePrices.get(symbol);
    const lastPrice = parseFloat(t.price ?? "0");
    if (lastPrice <= 0) return;
    const ticker: TickerData = {
      symbol, lastPrice,
      bid1Price: parseFloat(t.bestBid ?? String(lastPrice)),
      ask1Price: parseFloat(t.bestAsk ?? String(lastPrice)),
      price24hPcnt: existing?.price24hPcnt ?? 0,
      highPrice24h: existing?.highPrice24h ?? lastPrice,
      lowPrice24h: existing?.lowPrice24h ?? lastPrice,
      volume24h: parseFloat(t.size ?? existing?.volume24h ?? "0"),
      turnover24h: existing?.turnover24h ?? 0,
    };
    livePrices.set(symbol, ticker);
  } catch { /* ignore */ }
}

async function startKuCoinWebSocketFeed() {
  if (wsKucoin && wsKucoin.readyState !== WebSocket.CLOSED) wsKucoin.terminate();

  const tokenData = await getKuCoinWsToken();
  if (!tokenData) {
    console.warn("[PriceFeed] KuCoin WS token unavailable — retrying in 30s");
    wsKucoinReconnectTimer = setTimeout(() => startKuCoinWebSocketFeed(), 30_000);
    return;
  }

  const connectId = Date.now();
  const wsUrl = `${tokenData.endpoint}?token=${tokenData.token}&connectId=${connectId}`;
  console.log("[PriceFeed] Starting KuCoin WebSocket price feed...");

  const ws = new WebSocket(wsUrl);
  wsKucoin = ws;

  ws.on("open", () => {
    console.log(`[PriceFeed] KuCoin WS connected — subscribing to ${SPOT_SYMBOLS.length} symbols`);
    const kucoinSymbols = SPOT_SYMBOLS.map(s => s.replace("USDT", "-USDT"));
    for (let i = 0; i < kucoinSymbols.length; i += 10) {
      const batch = kucoinSymbols.slice(i, i + 10);
      ws.send(JSON.stringify({
        id: Date.now() + i, type: "subscribe",
        topic: `/market/ticker:${batch.join(",")}`,
        privateChannel: false, response: true,
      }));
    }
  });

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as any;
    if (msg.type === "pong" || msg.type === "welcome" || msg.type === "ack") return;
    parseKuCoinTickerMsg(data as Buffer);
  });

  ws.on("error", (e) => {
    console.error("[PriceFeed] KuCoin WS error:", e.message);
  });

  ws.on("close", () => {
    console.warn("[PriceFeed] KuCoin WS closed — reconnecting in 10s...");
    if (wsKucoinReconnectTimer) clearTimeout(wsKucoinReconnectTimer);
    wsKucoinReconnectTimer = setTimeout(() => startKuCoinWebSocketFeed(), 10_000);
  });

  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id: Date.now(), type: "ping" }));
    } else {
      clearInterval(pingInterval);
    }
  }, 20_000);
}

async function updateSP500Price() {
  const sp500 = await fetchSP500Price();
  if (sp500) livePrices.set("SP500", sp500);
}

// Auto-start on module load
startBybitWebSocketFeed();
startKuCoinWebSocketFeed();
