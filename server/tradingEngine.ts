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
  telegramPollingOffset?: number;
  lastDrawdownAlertDate?: string; // YYYY-MM-DD to avoid spam
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
const BYBIT_KLINE_SYMBOLS = new Set(["XAUUSDT", "SPXUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT"]);

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
      const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((c: any) => c != null);
      const volumes = (result?.indicators?.quote?.[0]?.volume ?? []).filter((v: any) => v != null);
      if (closes.length > 0) {
        const klineResult = { closes: closes.slice(-limit), volumes: volumes.slice(-limit) };
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
    return {
      closes: Array.from({ length: limit }, () => base * (1 + (Math.random() - 0.5) * 0.002)),
      volumes: Array(limit).fill(1000),
    };
  }
  return { closes: [], volumes: [] };
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
      if (engine.kucoinClient && symbol !== "XAUUSDT" && symbol !== "XAGUSD" && symbol !== "SPXUSDT" && category === "spot") {
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

async function runGridStrategy(engine: EngineState, symbol: string, category: "spot" | "linear" = "spot") {
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

  // ─── Trend Detection (EMA 20/50) ───
  let trendAllowsBuy = true;
  let trendLabel = "neutral";
  try {
    const klines = await fetchKlines(engine.client, symbol, "15", 60, category);
    if (klines.closes.length >= 50) {
      const ema20 = calculateEMA(klines.closes, 20);
      const ema50 = calculateEMA(klines.closes, 50);
      const ema20Now = ema20[ema20.length - 1];
      const ema50Now = ema50[ema50.length - 1];
      const ema20Prev = ema20[ema20.length - 4];
      if (ema20Now < ema50Now && ema20Now < ema20Prev) {
        trendAllowsBuy = false;
        trendLabel = "bearish";
      } else if (ema20Now > ema50Now) {
        trendLabel = "bullish";
      }
    }
  } catch { /* keep trendAllowsBuy = true on error */ }

  // ─── Multi-Timeframe Analysis ───
  const mtf = await multiTimeframeCheck(engine.client, symbol, category);
  if (mtf.direction === "bearish" && mtf.aligned) {
    trendAllowsBuy = false;
    trendLabel = "bearish-mtf";
  }

  // Read strategy config
  const strats = await db.getUserStrategies(engine.userId);
  const strat = strats.find(s => s.symbol === symbol);
  const config = strat?.config as any;
  const gridLevels = config?.gridLevels ?? 10;
  const baseGridSpread = config?.gridSpreadPct ? config.gridSpreadPct / 100 : 0.005;

  // ─── Dynamic Grid: adjust spread based on volatility ───
  let effectiveSpread = baseGridSpread;
  try {
    const klines = await fetchKlines(engine.client, symbol, "15", 30, category);
    if (klines.closes.length >= 10) {
      const volatility = calculateVolatility(klines.closes);
      // Scale spread: low vol (0.2%) → use base, high vol (2%) → use 2x base
      const volMultiplier = Math.max(1, Math.min(2.5, volatility / 0.005));
      effectiveSpread = baseGridSpread * volMultiplier;
    }
  } catch { /* use base spread */ }

  // Minimum profitable spread
  const minProfitableSpread = 0.0025;
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

  // ─── Protection System: Stop-Loss + Trailing Stop + Time Stop ───
  const stratConfig = config ?? {};
  const stopLossPct = (stratConfig.stopLossPct ?? 0) / 100; // Default 0% = DISABLED (never sell at loss) (crypto is volatile)
  const trailingPct = (stratConfig.trailingStopPct ?? 0.5) / 100; // 0.5% trailing distance
  const trailingActivation = (stratConfig.trailingActivationPct ?? 0.5) / 100; // Activate trailing after 0.5% profit (optimized for more cycles)
  const maxHoldTimeMs = (stratConfig.maxHoldHours ?? 12) * 60 * 60 * 1000; // Default 48 hours max hold
  const maxOpenPositions = stratConfig.maxOpenPositions ?? 3; // Max open positions per symbol
  // Dynamic minProfitUsd: proportional to trade amount (0.3% of tradeAmount, min $0.30, max $2)
  const tradeAmountForMin = strat?.allocationPct ? (parseFloat((await db.getOrCreateBotState(engine.userId))?.currentBalance ?? "5000") * strat.allocationPct / 100) : 100;
  const dynamicMinProfit = Math.max(0.15, Math.min(1.0, tradeAmountForMin * 0.002));
  const minProfitUsd = stratConfig.minProfitUsd ?? dynamicMinProfit; // Proportional to position size
  const positionsToSell: { pos: OpenBuyPosition; reason: string }[] = [];

  for (let i = openPositions.length - 1; i >= 0; i--) {
    const pos = openPositions[i];
    const lossPct = (pos.buyPrice - price) / pos.buyPrice;
    const profitPct = (price - pos.buyPrice) / pos.buyPrice;
    const holdTimeMs = Date.now() - (pos.openedAt ?? Date.now());

    // 1. STOP-LOSS: Cut losses if price drops below threshold
    // BTC and ETH are EXEMPT from stop-loss — never sell at a loss, always HOLD
    // stopLossPct === 0 means stop-loss is DISABLED
    const noStopLossSymbols: string[] = []; // No exemptions — all symbols rotate capital
    if (stopLossPct > 0 && lossPct >= stopLossPct && !noStopLossSymbols.includes(symbol)) {
      positionsToSell.push({ pos, reason: `STOP-LOSS (${(lossPct * 100).toFixed(2)}% loss)` });
      openPositions.splice(i, 1);
      continue;
    } else if (lossPct >= stopLossPct && noStopLossSymbols.includes(symbol)) {
      console.log(`[Grid] ${symbol} HOLD — ${(lossPct * 100).toFixed(2)}% loss but BTC/ETH exempt from stop-loss`);
    }

    // 2. TIME STOP: Only close if held VERY long AND losing money
    // First threshold: if held > maxHoldTime and price is below buy price, just log warning
    // Only force-sell if held > 2x maxHoldTime AND still losing
    const doubleMaxHold = maxHoldTimeMs; // Close after maxHoldTime (4h) to rotate capital faster
    if (maxHoldTimeMs > 0 && holdTimeMs > doubleMaxHold && profitPct < -0.002 && !noStopLossSymbols.includes(symbol)) {
      // Only time-stop if the loss is small enough (< stop-loss threshold) — otherwise let stop-loss handle it
      const estGrossPnl = (price - pos.buyPrice) * parseFloat(pos.qty);
      const estNetPnl = calcNetPnl(estGrossPnl, pos.tradeAmount, category, true, engine.exchange);
      if (estNetPnl > 0) { // ONLY close if in profit — NEVER sell at a loss
        // Loss is tiny, close to free up capital
        positionsToSell.push({ pos, reason: `TIME-PROFIT (held ${(holdTimeMs / 3600000).toFixed(1)}h, profit $${estNetPnl.toFixed(2)})` });
        openPositions.splice(i, 1);
        continue;
      } else {
        console.log(`[Grid] ${symbol} TIME-WARNING — held ${(holdTimeMs / 3600000).toFixed(1)}h, loss $${estNetPnl.toFixed(2)} too large for time-stop, waiting for recovery`);
      }
    } else if (maxHoldTimeMs > 0 && holdTimeMs > doubleMaxHold && profitPct < -0.002 && noStopLossSymbols.includes(symbol)) {
      console.log(`[Grid] ${symbol} HOLD — held ${(holdTimeMs / 3600000).toFixed(1)}h, BTC/ETH exempt from time-stop`);
    } else if (maxHoldTimeMs > 0 && holdTimeMs > maxHoldTimeMs && profitPct >= 0) {
      // Held long but in profit — let trailing stop handle it, don't force close
      console.log(`[Grid] ${symbol} held ${(holdTimeMs / 3600000).toFixed(1)}h but in profit ${(profitPct * 100).toFixed(2)}%, trailing stop will handle exit`);
    }

    // 3. TRAILING STOP: Lock in profits (only if estimated profit >= minProfitUsd)
    if (!pos.highestPrice || price > pos.highestPrice) {
      pos.highestPrice = price;
    }
    if (pos.highestPrice && pos.highestPrice > pos.buyPrice * (1 + trailingActivation)) {
      const dropFromHigh = (pos.highestPrice - price) / pos.highestPrice;
      if (dropFromHigh >= trailingPct) {
        // Check minimum profit before selling
        const estGrossPnl = (price - pos.buyPrice) * parseFloat(pos.qty);
        const estNetPnl = calcNetPnl(estGrossPnl, pos.tradeAmount, category, true, engine.exchange);
        if (estNetPnl >= minProfitUsd && estNetPnl > 0) {
          positionsToSell.push({ pos, reason: `TRAILING-STOP (high=${pos.highestPrice.toFixed(2)}, drop=${(dropFromHigh * 100).toFixed(2)}%, est=$${estNetPnl.toFixed(2)})` });
          openPositions.splice(i, 1);
          continue;
        } else if (estNetPnl <= 0) {
          // NEVER sell at a loss from trailing stop
          console.log(`[Grid] ${symbol} BLOCK SELL — trailing triggered but net PnL $${estNetPnl.toFixed(2)} is NEGATIVE, holding`);
        } else {
          // Profit too small, keep holding — don't sell yet
          console.log(`[Grid] ${symbol} HOLD — trailing triggered but profit $${estNetPnl.toFixed(2)} < min $${minProfitUsd}`);
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

      // Telegram notification
      const emoji = pnl > 0 ? "✅" : "🛑";
      const label = pnl > 0 ? "Profit" : "Stop-Loss";
      await sendTelegramNotification(engine,
        `${emoji} <b>PHANTOM Grid ${label}</b>\n` +
        `Par: ${symbol}\n` +
        `Compra: $${pos.buyPrice.toFixed(2)}\n` +
        `Venta: $${price.toFixed(2)} (${reason.split(" ")[0]})\n` +
        `Resultado: <b>$${pnl.toFixed(2)}</b>`
      );
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
      // ─── Trend guard: skip BUY if bearish ───
      if (level.side === "Buy" && !trendAllowsBuy) {
        console.log(`[Grid] SKIP BUY ${symbol} @ ${level.price.toFixed(2)} — ${trendLabel} trend`);
        continue;
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

      // ─── Reinvestment: use current balance (includes profits) for order sizing ───
      const allocation = strat?.allocationPct ?? 50;
      const state = await db.getOrCreateBotState(engine.userId);
      const balance = parseFloat(state?.currentBalance ?? "5000");
      const tradeAmount = (balance * allocation / 100) / (levels.length / 2);
      const qty = (tradeAmount / price).toFixed(6);

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
            // NEVER sell at a loss from grid levels — only protection system (stop-loss) can sell at a loss
            if (pnl < 0) {
              console.log(`[Grid] HOLD ${symbol} — grid sell would lose $${pnl.toFixed(2)}, keeping position open`);
              level.filled = false;
              continue;
            }
            // Minimum profit check: don't sell if profit < minProfitUsd
            if (pnl < 0.10) { // Allow any sell with > $0.10 profit
              console.log(`[Grid] HOLD ${symbol} — grid sell profit $${pnl.toFixed(2)} < min $${minProfitUsd}, waiting for better price`);
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
            // Block sell if it would result in a loss or profit < minimum
            if (pnl < 0.10) { // Allow any sell with > $0.10 profit
              console.log(`[Grid] HOLD ${symbol} — no-paired sell profit $${pnl.toFixed(2)} < min $${minProfitUsd}, skipping`);
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
async function runScalpingStrategy(engine: EngineState, symbol: string, category: "spot" | "linear" = "linear") {
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

  // Multi-timeframe check for scalping
  const mtf = await multiTimeframeCheck(engine.client, symbol, category);

  const klines = await fetchKlines(engine.client, symbol, "15", 50, category);
  if (klines.closes.length < 26) return;
  const closes = klines.closes;

  const rsi = calculateRSI(closes);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema9Current = ema9[ema9.length - 1];
  const ema21Current = ema21[ema21.length - 1];

  let signal: "Buy" | "Sell" | null = null;
  const reasons: string[] = [];

  // Buy signals — more aggressive thresholds for more opportunities
  if (mtf.direction !== "bearish") {
    // Bullish/Mixed: relaxed thresholds for more entries
    if (rsi < 40) { reasons.push(`RSI oversold (${rsi.toFixed(1)})`); signal = "Buy"; }
    if (price <= bb.lower * 1.015) { reasons.push("Price near lower BB"); signal = "Buy"; }
    if (ema9Current > ema21Current && ema9[ema9.length - 2] <= ema21[ema21.length - 2]) {
      reasons.push("EMA 9/21 bullish crossover"); signal = "Buy";
    }
    if (macd.histogram > 0 && macd.macd > macd.signal) { reasons.push("MACD bullish"); if (!signal) signal = "Buy"; }
    // New: momentum buy on strong MACD + rising EMA
    if (rsi < 55 && macd.histogram > 0 && ema9Current > ema21Current && price > bb.middle) {
      reasons.push("Momentum buy (RSI+MACD+EMA)"); signal = "Buy";
    }
  } else {
    // Bearish market: counter-trend scalp on oversold
    if (rsi < 32) { reasons.push(`RSI extreme oversold (${rsi.toFixed(1)})`); signal = "Buy"; }
    if (price <= bb.lower * 0.998) { reasons.push("Price below lower BB (extreme)"); signal = "Buy"; }
    if (macd.histogram > 0 && macd.macd > macd.signal) { reasons.push("MACD reversal in bearish"); signal = "Buy"; }
  }

  // Sell signals — more aggressive for faster exits
  if (rsi > 65) { reasons.push(`RSI overbought (${rsi.toFixed(1)})`); signal = "Sell"; }
  if (price >= bb.upper * 0.985) { reasons.push("Price near upper BB"); signal = "Sell"; }
  if (ema9Current < ema21Current && ema9[ema9.length - 2] >= ema21[ema21.length - 2]) {
    reasons.push("EMA 9/21 bearish crossover"); signal = "Sell";
  }

  if (engine.simulationMode && !signal) {
    if (macd.histogram > 0) { signal = "Buy"; reasons.push("MACD bullish (sim)"); }
    else if (macd.histogram < 0) { signal = "Sell"; reasons.push("MACD bearish (sim)"); }
  }

  const minSignals = 1; // Only need 1 strong signal to scalp
  console.log(`[Scalp] ${symbol} analysis: price=${price.toFixed(2)} rsi=${rsi.toFixed(1)} macd=${macd.histogram.toFixed(4)} signal=${signal ?? 'none'} reasons=${reasons.length} minReq=${minSignals} mtf=${mtf.direction}`);
  if (signal && reasons.length >= minSignals) {
    const strats = await db.getUserStrategies(engine.userId);
    const strat = strats.find(s => s.symbol === symbol && s.strategyType === "scalping") ?? strats.find(s => s.symbol === symbol);
    const allocation = strat?.allocationPct ?? 30;
    const state = await db.getOrCreateBotState(engine.userId);
    const balance = parseFloat(state?.currentBalance ?? "5000");
    const tradeAmount = balance * allocation / 100 * 0.7; // 70% of allocation per scalp (was 10%, too small to cover fees)
    const qty = (tradeAmount / price).toFixed(6);

    // ─── Position-Tracked Scalping ───
    // Check existing scalp positions for this symbol
    const existingPositions = engine.scalpPositions[symbol] ?? [];
    const exchangeKey = engine.exchange === "both" ? (category === "spot" ? "kucoin" : "bybit") : engine.exchange;
    const myPositions = existingPositions.filter(p => p.exchange === exchangeKey && p.category === category);

    if (signal === "Sell") {
      // Only sell if we have a scalp position to close
      if (myPositions.length === 0) {
        console.log(`[Scalp] SKIP ${symbol} Sell — no open scalp position to close (${exchangeKey}/${category})`);
        return;
      }

      // Close the oldest position — ONLY if in profit
      const pos = myPositions[0];
      const estGross = (price - pos.buyPrice) * parseFloat(pos.qty);
      const estNet = calcNetPnl(estGross, pos.buyPrice * parseFloat(pos.qty), category, true, engine.exchange);
      if (estNet <= 0) {
        console.log(`[Scalp] HOLD ${symbol} — sell signal but PnL $${estNet.toFixed(2)} is negative, waiting for profit`);
        return;
      }
      const sellQty = pos.qty;
      const orderId = await placeOrder(engine, symbol, "Sell", sellQty, category);
      if (orderId) {
        // Calculate real PnL: (sellPrice - buyPrice) * qty - fees
        const grossPnl = (price - pos.buyPrice) * parseFloat(sellQty);
        const pnl = calcNetPnl(grossPnl, pos.buyPrice * parseFloat(sellQty), category, true, engine.exchange);

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

        // Remove the closed position
        engine.scalpPositions[symbol] = existingPositions.filter(p => p !== pos);
        const holdTime = ((Date.now() - pos.openedAt) / 60000).toFixed(1);
        console.log(`[Scalp] SELL ${symbol} @ ${price.toFixed(4)} qty=${sellQty} buyPrice=${pos.buyPrice.toFixed(4)} pnl=$${pnl.toFixed(2)} hold=${holdTime}min`);

        if (pnl > 0.5) {
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
      // Allow up to 2 scalp positions per symbol per exchange
      const maxScalpPositions = 2;
      if (myPositions.length >= maxScalpPositions) {
        console.log(`[Scalp] SKIP ${symbol} Buy — already have ${myPositions.length}/${maxScalpPositions} scalp position(s) on ${exchangeKey}`);
        return;
      }

      // Pre-check: estimate PnL before placing order (relaxed for more entries)
      const bbWidth = (bb.upper - bb.lower) / bb.middle;
      const estGrossPnl = engine.simulationMode
        ? tradeAmount * (Math.random() * 0.008 - 0.002)
        : tradeAmount * bbWidth * 0.30; // Increased from 0.25 to 0.30 (capture more of the band)
      const estNetPnl = calcNetPnl(estGrossPnl, tradeAmount, category, true, engine.exchange);

      // Only skip if clearly unprofitable (reduced threshold)
      if (estNetPnl <= -0.5) {
        console.log(`[Scalp] SKIP ${symbol} Buy — BB too tight, estimated net PnL $${estNetPnl.toFixed(2)}`);
        return;
      }
      console.log(`[Scalp] ${symbol} Buy — BB width=${(bbWidth * 100).toFixed(2)}% estNet=$${estNetPnl.toFixed(2)}`);

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
async function runFuturesStrategy(engine: EngineState, symbol: string) {
  const ticker = await fetchTicker(engine.client, symbol, "linear");
  if (!ticker) return;

  const price = ticker.lastPrice;
  engine.lastPrices[symbol] = price;
  livePrices.set(symbol, ticker);

  // Volume filter
  if (!hasAdequateVolume(symbol)) return;

  // Multi-timeframe check
  const mtf = await multiTimeframeCheck(engine.client, symbol, "linear");

  // Check existing positions
  if (!engine.futuresPositions[symbol]) engine.futuresPositions[symbol] = [];
  const positions = engine.futuresPositions[symbol];

  // ─── Read strategy config ───
  const futStrats = await db.getUserStrategies(engine.userId);
  const futStrat = futStrats.find(s => s.symbol === symbol && s.strategyType === "futures");
  const futConfig = futStrat?.config as any ?? {};
  const futuresStopLossPct = (futConfig.stopLossPct ?? 0) / 100;
  const futuresMaxHoldHours = futConfig.maxHoldHours ?? 0;
  const futuresNoSL = ["BTCUSDT", "ETHUSDT"];

  // ─── Dynamic Take-Profit based on volatility ───
  const klines = await fetchKlines(engine.client, symbol, "15", 50, "linear");
  if (klines.closes.length < 26) return;
  const volatility = calculateVolatility(klines.closes);
  // Scale TP: low vol (0.2%) → 0.8% TP, high vol (1.5%) → 3% TP
  const baseTpPct = futConfig.takeProfitPct ?? 1.5;
  const dynamicTpPct = Math.max(0.8, Math.min(3.0, baseTpPct * Math.max(1, volatility / 0.005)));

  // ─── Trailing stop config for futures ───
  const trailingActivationPct = 0.005; // Activate trailing after 0.5% profit
  const trailingDistancePct = 0.003;   // 0.3% trailing distance

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

    // 1. STOP-LOSS: Only if explicitly enabled and NOT BTC/ETH
    if (futuresStopLossPct > 0 && lossPct >= futuresStopLossPct && !futuresNoSL.includes(symbol)) {
      closeReason = `STOP-LOSS (${(lossPct * 100).toFixed(2)}% loss, ${pos.leverage}x ${isLong ? "LONG" : "SHORT"})`;
    } else if (lossPct > 0.01) {
      console.log(`[Futures] ${symbol} ${isLong ? "LONG" : "SHORT"} HOLD — ${(lossPct * 100).toFixed(2)}% loss, waiting`);
    }

    // 2. TIME STOP: Only if explicitly enabled and NOT BTC/ETH
    if (!closeReason && futuresMaxHoldHours > 0 && holdTimeMs > futuresMaxHoldHours * 3600000 && profitPct > 0.003 && !futuresNoSL.includes(symbol)) {
      closeReason = `TIME-PROFIT (held ${(holdTimeMs / 3600000).toFixed(1)}h, profit ${(profitPct * 100).toFixed(2)}% ${isLong ? "LONG" : "SHORT"})`;
    }

    // 3. TRAILING STOP: Lock in profits
    if (!closeReason && profitPct > 0) {
      if (isLong) {
        if (!pos.highestPrice || price > pos.highestPrice) pos.highestPrice = price;
        if (pos.highestPrice && profitPct >= trailingActivationPct) {
          const dropFromHigh = (pos.highestPrice - price) / pos.highestPrice;
          if (dropFromHigh >= trailingDistancePct) {
            const estGross = (price - pos.entryPrice) * parseFloat(pos.qty) * pos.leverage;
            const estNet = calcNetPnl(estGross, pos.tradeAmount * pos.leverage, "linear", true, "bybit", holdTimeMs);
            if (estNet > 0) closeReason = `TRAILING-STOP (high=${pos.highestPrice.toFixed(2)}, net=$${estNet.toFixed(2)} LONG)`;
          }
        }
      } else {
        if (!pos.lowestPrice || price < pos.lowestPrice) pos.lowestPrice = price;
        if (pos.lowestPrice && profitPct >= trailingActivationPct) {
          const riseFromLow = (price - pos.lowestPrice) / pos.lowestPrice;
          if (riseFromLow >= trailingDistancePct) {
            const estGross = (pos.entryPrice - price) * parseFloat(pos.qty) * pos.leverage;
            const estNet = calcNetPnl(estGross, pos.tradeAmount * pos.leverage, "linear", true, "bybit", holdTimeMs);
            if (estNet > 0) closeReason = `TRAILING-STOP (low=${pos.lowestPrice.toFixed(2)}, net=$${estNet.toFixed(2)} SHORT)`;
          }
        }
      }
    }

    // 4. TAKE PROFIT: Dynamic TP based on volatility
    const effectiveTp = pos.takeProfitPct / 100; // Use the TP set at entry time
    if (!closeReason && profitPct >= effectiveTp) {
      const estGrossPnl = isLong
        ? (price - pos.entryPrice) * parseFloat(pos.qty) * pos.leverage
        : (pos.entryPrice - price) * parseFloat(pos.qty) * pos.leverage;
      const estNetPnl = calcNetPnl(estGrossPnl, pos.tradeAmount * pos.leverage, "linear", true, "bybit", holdTimeMs);
      if (estNetPnl > 0) {
        closeReason = `TAKE-PROFIT (${(profitPct * 100).toFixed(2)}%, net=$${estNetPnl.toFixed(2)} ${isLong ? "LONG" : "SHORT"})`;
      } else {
        console.log(`[Futures] ${symbol} ${isLong ? "LONG" : "SHORT"} HOLD — TP triggered but net $${estNetPnl.toFixed(2)} after fees+funding`);
      }
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

  // ─── Open new position (LONG or SHORT) if conditions are right ───
  const maxPositions = 3; // Allow more positions (was 2)
  const longPositions = positions.filter(p => (p.direction ?? "long") === "long");
  const shortPositions = positions.filter(p => p.direction === "short");

  const rsi = calculateRSI(klines.closes);
  const macd = calculateMACD(klines.closes);
  const bb = calculateBollingerBands(klines.closes);

  // ─── LONG entry conditions ───
  let canLong = false;
  if (longPositions.length < 2) { // Max 2 longs per symbol
    if (mtf.direction === "bullish") {
      canLong = rsi < 65 && macd.histogram > 0;
    } else if (mtf.direction === "mixed") {
      canLong = rsi < 45 && macd.histogram > 0 && price <= bb.lower * 1.02;
    } else {
      // Bearish: aggressive counter-trend long on extreme oversold
      canLong = rsi < 30 && price <= bb.lower * 0.995;
    }
  }

  // ─── SHORT entry conditions ───
  let canShort = false;
  if (shortPositions.length < 2) { // Max 2 shorts per symbol
    if (mtf.direction === "bearish") {
      canShort = rsi > 35 && macd.histogram < 0;
    } else if (mtf.direction === "mixed") {
      canShort = rsi > 55 && macd.histogram < 0 && price >= bb.upper * 0.98;
    } else {
      // Bullish: aggressive counter-trend short on extreme overbought
      canShort = rsi > 75 && price >= bb.upper * 1.005;
    }
  }

  if (positions.length >= maxPositions) {
    console.log(`[Futures] ${symbol} SKIP — max ${maxPositions} positions reached`);
    return;
  }

  // Decide direction: prefer trend-following
  let entryDirection: "long" | "short" | null = null;
  if (canLong && canShort) {
    // Both signals — pick the stronger one
    entryDirection = mtf.direction === "bearish" ? "short" : "long";
  } else if (canLong) {
    entryDirection = "long";
  } else if (canShort) {
    entryDirection = "short";
  }

  if (!entryDirection) {
    console.log(`[Futures] ${symbol} SKIP entry — mtf=${mtf.direction} rsi=${rsi.toFixed(1)} macd=${macd.histogram.toFixed(4)} canLong=${canLong} canShort=${canShort}`);
    return;
  }

  const futStrats2 = await db.getUserStrategies(engine.userId);
  const strat = futStrats2.find(s => s.symbol === symbol && s.strategyType === "futures");
  const config = strat?.config as any;
  const leverage = config?.leverage ?? 5;
  const allocation = strat?.allocationPct ?? 25;
  const state = await db.getOrCreateBotState(engine.userId);
  const balance = parseFloat(state?.currentBalance ?? "5000");
  const tradeAmount = (balance * allocation / 100) / maxPositions;
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

    console.log(`[Futures] ${entryDirection.toUpperCase()} ${symbol} @ ${price.toFixed(2)} qty=${qty} leverage=${leverage}x TP=${dynamicTpPct.toFixed(1)}% vol=${(volatility * 100).toFixed(2)}% order=${orderId}`);
  }
}

// Backward compatibility alias
const runFuturesLongOnly = runFuturesStrategy;

// ─── Opportunity Scanner ───
async function runOpportunityScanner(engine: EngineState) {
  console.log(`[Scanner] Scanning ${SCANNER_COINS.length} coins...`);
  for (const symbol of SCANNER_COINS) {
    try {
      const klines = await fetchKlines(null, symbol, "15", 50, "spot");
      if (klines.closes.length < 26) continue;
      const closes = klines.closes;
      const volumes = klines.volumes;

      const price = closes[closes.length - 1];
      const rsi = calculateRSI(closes);
      const macd = calculateMACD(closes);
      const bb = calculateBollingerBands(closes);
      const ema9 = calculateEMA(closes, 9);
      const ema21 = calculateEMA(closes, 21);

      const recentVols = volumes.slice(-10);
      const avgVol = recentVols.reduce((a: number, b: number) => a + b, 0) / recentVols.length;
      const currentVol = volumes[volumes.length - 1];
      const volSpike = currentVol > avgVol * 1.5;

      let signal: string | null = null;
      let confidence = 0;
      const reasons: string[] = [];

      if (rsi < 30) { confidence += 25; reasons.push(`RSI very oversold (${rsi.toFixed(1)})`); signal = "STRONG BUY"; }
      else if (rsi < 40) { confidence += 15; reasons.push(`RSI oversold (${rsi.toFixed(1)})`); signal = "BUY"; }

      if (price <= bb.lower * 1.02) { confidence += 20; reasons.push("Price at lower Bollinger Band"); if (!signal) signal = "BUY"; }

      const ema9Now = ema9[ema9.length - 1];
      const ema21Now = ema21[ema21.length - 1];
      if (ema9Now > ema21Now && ema9[ema9.length - 2] <= ema21[ema21.length - 2]) {
        confidence += 20; reasons.push("EMA 9/21 bullish crossover"); if (!signal) signal = "BUY";
      }

      if (macd.histogram > 0 && macd.macd > 0) { confidence += 15; reasons.push("MACD bullish momentum"); }
      if (volSpike) { confidence += 10; reasons.push("Volume spike detected"); }

      if (rsi > 75) { confidence += 25; reasons.push(`RSI very overbought (${rsi.toFixed(1)})`); signal = "STRONG SELL"; }
      else if (rsi > 65) { confidence += 15; reasons.push(`RSI overbought (${rsi.toFixed(1)})`); signal = "SELL"; }

      if (price >= bb.upper * 0.98) { confidence += 20; reasons.push("Price at upper Bollinger Band"); if (!signal) signal = "SELL"; }

      if (ema9Now < ema21Now && ema9[ema9.length - 2] >= ema21[ema21.length - 2]) {
        confidence += 20; reasons.push("EMA 9/21 bearish crossover"); if (!signal) signal = "SELL";
      }

      if (signal && confidence >= 40 && reasons.length >= 2) {
        confidence = Math.min(confidence, 95);
        await db.insertOpportunity({
          userId: engine.userId, symbol, signal, price: price.toString(),
          confidence, reasons, isRead: false,
        });
        console.log(`[Scanner] ${signal} ${symbol} @ ${price} confidence=${confidence}% reasons=${reasons.join(", ")}`);
        if (confidence >= 75) {
          try {
            const { notifyOwner } = await import("./_core/notification");
            await notifyOwner({
              title: `📊 PHANTOM: ${signal} ${symbol} (${confidence}%)`,
              content: `Par: ${symbol}\nSeñal: ${signal}\nConfianza: ${confidence}%\nPrecio: $${price.toFixed(4)}\nRazones: ${reasons.join(", ")}`,
            });
          } catch { /* non-blocking */ }

          // Only send Telegram for very high confidence scanner alerts (≥85%)
          if (confidence >= 85) {
            await sendTelegramNotification(engine,
              `📊 <b>PHANTOM Scanner: ${signal}</b>\nPar: ${symbol}\nPrecio: $${price.toFixed(4)}\nConfianza: ${confidence}%\n${reasons.join("\n")}`
            );
          }
        }
      }

      await new Promise(r => setTimeout(r, 4000));
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
      console.log(`[Engine] Cycle #${cycleNum} for user ${userId}`);

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
      // ─── Auto-Convert accumulated coins to USDT (every 15 cycles ~5 min) ───
      if (cycleNum % 15 === 0) {
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
          const DRAWDOWN_THRESHOLD = -50; // Configurable: alert if daily loss exceeds $50
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

      const strats = await db.getUserStrategies(userId);
      console.log(`[Engine] Found ${strats.length} strategies, ${strats.filter(s => s.enabled).length} enabled`);

      for (const strat of strats) {
        if (!strat.enabled) continue;
        const cat = strat.category === "linear" ? "linear" : "spot";

        // XAUUSDT and XAGUSD always run on Bybit
        if (strat.symbol === "XAUUSDT" || strat.symbol === "XAGUSD" || strat.symbol === "SPXUSDT") {
          if (engine.exchange === "kucoin") {
            const bybitKeys = await db.getApiKey(userId, "bybit");
            if (bybitKeys) {
              const bybitClient = new RestClientV5({ key: bybitKeys.apiKey, secret: bybitKeys.apiSecret });
              const bybitEngine: EngineState = { ...engine, client: bybitClient, exchange: "bybit", kucoinClient: null };
              console.log(`[Engine] Running ${strat.strategyType} for ${strat.symbol} on Bybit (forced)`);
              if (strat.strategyType === "scalping") await runScalpingStrategy(bybitEngine, strat.symbol, "linear");
              else if (strat.strategyType === "futures") await runFuturesLongOnly(bybitEngine, strat.symbol);
              else await runGridStrategy(bybitEngine, strat.symbol, "linear");
            } else {
              console.log(`[Engine] Skipping ${strat.symbol} — no Bybit keys available`);
            }
          } else {
            console.log(`[Engine] Running ${strat.strategyType} for ${strat.symbol} on Bybit`);
            if (strat.strategyType === "scalping") await runScalpingStrategy(engine, strat.symbol, "linear");
            else if (strat.strategyType === "futures") await runFuturesLongOnly(engine, strat.symbol);
            else await runGridStrategy(engine, strat.symbol, "linear");
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
              await runFuturesLongOnly(bybitEngine, strat.symbol);
            }
          } else {
            console.log(`[Engine] Running futures for ${strat.symbol} on Bybit`);
            const bybitEngine: EngineState = { ...engine, exchange: "bybit", kucoinClient: null };
            await runFuturesLongOnly(bybitEngine, strat.symbol);
          }
          continue;
        }

        // For other pairs: dual exchange or single
        if (engine.exchange === "both") {
          if (engine.kucoinClient) {
            const kucoinEngine: EngineState = { ...engine, exchange: "kucoin" };
            console.log(`[Engine] Running ${strat.strategyType} for ${strat.symbol} on KuCoin`);
            if (strat.strategyType === "grid") await runGridStrategy(kucoinEngine, strat.symbol, "spot");
            else if (strat.strategyType === "scalping") await runScalpingStrategy(kucoinEngine, strat.symbol, "spot");
          }
          const bybitEngine: EngineState = { ...engine, exchange: "bybit", kucoinClient: null };
          console.log(`[Engine] Running ${strat.strategyType} for ${strat.symbol} on Bybit`);
          if (strat.strategyType === "grid") await runGridStrategy(bybitEngine, strat.symbol, "linear"); // Force linear on Bybit to avoid locking capital in coins
          else if (strat.strategyType === "scalping") await runScalpingStrategy(bybitEngine, strat.symbol, cat as "spot" | "linear");
          continue;
        }

        // Single exchange mode
        console.log(`[Engine] Running ${strat.strategyType} for ${strat.symbol} (${strat.category})`);
        if (strat.strategyType === "grid") {
          await runGridStrategy(engine, strat.symbol, engine.exchange === "kucoin" ? "spot" : "linear"); // Linear on Bybit, spot on KuCoin
        } else if (strat.strategyType === "scalping") {
          await runScalpingStrategy(engine, strat.symbol, cat as "spot" | "linear");
        }
      }
    } catch (e) {
      console.error("[Engine] Trading loop error:", (e as Error).message);
    }
  }, 20_000);

  // Opportunity scanner — every 2 minutes
  engine.scannerIntervalId = setInterval(async () => {
    if (!engine.isRunning) return;
    await runOpportunityScanner(engine);
  }, 120_000);

  setTimeout(() => runOpportunityScanner(engine), 5000);

  // Run first trading cycle immediately (mirrors main loop logic for proper exchange routing)
  setTimeout(async () => {
    const strats = await db.getUserStrategies(userId);
    console.log(`[Engine] First cycle: ${strats.length} strategies, ${strats.filter(s => s.enabled).length} enabled`);
    for (const strat of strats) {
      if (!strat.enabled) continue;
      const cat = strat.category === "linear" ? "linear" : "spot";

      // XAUUSDT, XAGUSD, SPXUSDT always route to Bybit
      if (strat.symbol === "XAUUSDT" || strat.symbol === "XAGUSD" || strat.symbol === "SPXUSDT") {
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

      // Regular strategies: use selected exchange
      if (engine.exchange === "both") {
        if (engine.kucoinClient) {
          const kucoinEngine: EngineState = { ...engine, exchange: "kucoin" };
          console.log(`[Engine] First cycle: ${strat.strategyType} ${strat.symbol} on KuCoin`);
          if (strat.strategyType === "grid") await runGridStrategy(kucoinEngine, strat.symbol, "spot");
          else if (strat.strategyType === "scalping") await runScalpingStrategy(kucoinEngine, strat.symbol, "spot");
        }
        const bybitEngine: EngineState = { ...engine, exchange: "bybit", kucoinClient: null };
        console.log(`[Engine] First cycle: ${strat.strategyType} ${strat.symbol} on Bybit`);
        if (strat.strategyType === "grid") await runGridStrategy(bybitEngine, strat.symbol, "linear"); // Force linear on Bybit to avoid locking capital in coins
        else if (strat.strategyType === "scalping") await runScalpingStrategy(bybitEngine, strat.symbol, cat as "spot" | "linear");
      } else {
        console.log(`[Engine] First cycle: ${strat.strategyType} ${strat.symbol}`);
        if (strat.strategyType === "grid") await runGridStrategy(engine, strat.symbol, engine.exchange === "kucoin" ? "spot" : "linear"); // Linear on Bybit, spot on KuCoin
        else if (strat.strategyType === "scalping") await runScalpingStrategy(engine, strat.symbol, cat as "spot" | "linear");
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
const LINEAR_SYMBOLS = ["XAUUSDT", "SPXUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "AVAXUSDT"];

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
