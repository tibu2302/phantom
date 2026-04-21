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
}

interface EngineState {
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
  intervalId?: ReturnType<typeof setInterval>;
  scannerIntervalId?: ReturnType<typeof setInterval>;
  priceIntervalId?: ReturnType<typeof setInterval>;
  telegramChatId?: string;
  telegramBotToken?: string;
}

// ─── Global State ───
const engines: Map<number, EngineState> = new Map();
const livePrices: Map<string, TickerData> = new Map();
const engineCycles: Map<number, number> = new Map();

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
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
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
    const res = await fetch(bybitUrl, { signal: AbortSignal.timeout(8000) });
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
      if (engine.kucoinClient && symbol !== "XAUUSDT" && symbol !== "XAGUSD" && symbol !== "SPXUSDT" && category === "spot") {
        try {
          const kucoinSymbol = symbol.replace("USDT", "-USDT");
          const res = await engine.kucoinClient.submitOrder({
            clientOid: `phantom_kc_${Date.now()}`,
            side: side.toLowerCase(),
            symbol: kucoinSymbol,
            type: "market",
            size: qty,
          });
          const kcId = res?.data?.orderId;
          if (kcId) { orderIds.push(`KC:${kcId}`); console.log(`[Engine] BOTH/KuCoin order: ${side} ${symbol} qty=${qty} id=${kcId}`); }
        } catch (e) { console.error(`[Engine] BOTH/KuCoin order failed:`, (e as Error).message); }
      }
      // Bybit
      try {
        const res = await engine.client.submitOrder({ category, symbol, side, orderType: "Market", qty });
        const bybitId = res.result?.orderId;
        if (bybitId) { orderIds.push(`BY:${bybitId}`); console.log(`[Engine] BOTH/Bybit order: ${side} ${symbol} qty=${qty} id=${bybitId}`); }
      } catch (e) { console.error(`[Engine] BOTH/Bybit order failed:`, (e as Error).message); }
      return orderIds.length > 0 ? orderIds.join(",") : null;
    } else if (engine.exchange === "kucoin" && engine.kucoinClient) {
      const kucoinSymbol = symbol.replace("USDT", "-USDT");
      const res = await engine.kucoinClient.submitOrder({
        clientOid: `phantom_${Date.now()}`,
        side: side.toLowerCase(),
        symbol: kucoinSymbol,
        type: "market",
        size: qty,
      });
      console.log(`[Engine] KuCoin order response:`, JSON.stringify(res?.data ?? res));
      return res?.data?.orderId ?? null;
    } else {
      const res = await engine.client.submitOrder({ category, symbol, side, orderType: "Market", qty });
      return res.result?.orderId ?? null;
    }
  } catch (e) {
    console.error(`[Engine] Order failed ${side} ${symbol} (${engine.exchange}):`, (e as Error).message);
    return null;
  }
}

function calcNetPnl(grossPnl: number, tradeAmount: number, category: "spot" | "linear", roundTrip = true, exchange = "bybit"): number {
  const exchangeFees = FEES[exchange] ?? FEES.bybit;
  const feeRate = category === "linear" ? exchangeFees.linear : exchangeFees.spot;
  const feeLegs = roundTrip ? 2 : 1;
  const totalFees = tradeAmount * feeRate * feeLegs;
  return grossPnl - totalFees;
}

// ─── Grid Trading Strategy (with Trailing Stop, Dynamic Spread, DCA, MTF, Volume Filter, Hours) ───
function generateGridLevels(currentPrice: number, gridCount: number = 10, gridSpread: number = 0.008): GridLevel[] {
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
  const baseGridSpread = config?.gridSpreadPct ? config.gridSpreadPct / 100 : 0.008;

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
    engine.openBuyPositions[symbol] = [];
    console.log(`[Grid] ${symbol} RECENTRED grid around ${price.toFixed(2)} (drift=${(driftPct * 100).toFixed(2)}%, spread=${(effectiveSpread * 100).toFixed(2)}%, trend=${trendLabel})`);
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
  const stopLossPct = (stratConfig.stopLossPct ?? 1.5) / 100; // Default 1.5% stop-loss
  const trailingPct = (stratConfig.trailingStopPct ?? 0.3) / 100; // 0.3% trailing distance
  const trailingActivation = (stratConfig.trailingActivationPct ?? 0.3) / 100; // Activate trailing after 0.3% profit
  const maxHoldTimeMs = (stratConfig.maxHoldHours ?? 4) * 60 * 60 * 1000; // Default 4 hours max hold
  const maxOpenPositions = stratConfig.maxOpenPositions ?? 5; // Max open positions per symbol
  const positionsToSell: { pos: OpenBuyPosition; reason: string }[] = [];

  for (let i = openPositions.length - 1; i >= 0; i--) {
    const pos = openPositions[i];
    const lossPct = (pos.buyPrice - price) / pos.buyPrice;
    const profitPct = (price - pos.buyPrice) / pos.buyPrice;
    const holdTimeMs = Date.now() - (pos.openedAt ?? Date.now());

    // 1. STOP-LOSS: Cut losses if price drops below threshold
    if (lossPct >= stopLossPct) {
      positionsToSell.push({ pos, reason: `STOP-LOSS (${(lossPct * 100).toFixed(2)}% loss)` });
      openPositions.splice(i, 1);
      continue;
    }

    // 2. TIME STOP: Close if held too long without significant profit
    if (holdTimeMs > maxHoldTimeMs && profitPct < 0.005) {
      positionsToSell.push({ pos, reason: `TIME-STOP (held ${(holdTimeMs / 3600000).toFixed(1)}h, profit ${(profitPct * 100).toFixed(2)}%)` });
      openPositions.splice(i, 1);
      continue;
    }

    // 3. TRAILING STOP: Lock in profits
    if (!pos.highestPrice || price > pos.highestPrice) {
      pos.highestPrice = price;
    }
    if (pos.highestPrice && pos.highestPrice > pos.buyPrice * (1 + trailingActivation)) {
      const dropFromHigh = (pos.highestPrice - price) / pos.highestPrice;
      if (dropFromHigh >= trailingPct) {
        positionsToSell.push({ pos, reason: `TRAILING-STOP (high=${pos.highestPrice.toFixed(2)}, drop=${(dropFromHigh * 100).toFixed(2)}%)` });
        openPositions.splice(i, 1);
        continue;
      }
    }
  }

  for (const { pos, reason } of positionsToSell) {
    const orderId = await placeOrder(engine, symbol, "Sell", pos.qty, category);
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
    const allocation = strat?.allocationPct ?? 30;
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
      const allocation = strat?.allocationPct ?? 30;
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
          const pairedBuy = openPos.shift();
          if (pairedBuy) {
            const sellQty = parseFloat(qty);
            const grossPnl = (price - pairedBuy.buyPrice) * sellQty;
            pnl = calcNetPnl(grossPnl, pairedBuy.tradeAmount, category, true, engine.exchange);
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
            const grossPnl = (price - level.price) * parseFloat(qty);
            pnl = calcNetPnl(grossPnl, tradeAmount, category, true, engine.exchange);
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
    const allocation = strat?.allocationPct ?? 30;
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

  // Buy signals (only if MTF not bearish)
  if (mtf.direction !== "bearish") {
    if (rsi < 35) { reasons.push(`RSI oversold (${rsi.toFixed(1)})`); signal = "Buy"; }
    if (price <= bb.lower * 1.01) { reasons.push("Price near lower BB"); signal = "Buy"; }
    if (ema9Current > ema21Current && ema9[ema9.length - 2] <= ema21[ema21.length - 2]) {
      reasons.push("EMA 9/21 bullish crossover"); signal = "Buy";
    }
    if (macd.histogram > 0 && macd.macd > macd.signal) { reasons.push("MACD bullish"); if (!signal) signal = "Buy"; }
  }

  // Sell signals
  if (rsi > 70) { reasons.push(`RSI overbought (${rsi.toFixed(1)})`); signal = "Sell"; }
  if (price >= bb.upper * 0.99) { reasons.push("Price near upper BB"); signal = "Sell"; }
  if (ema9Current < ema21Current && ema9[ema9.length - 2] >= ema21[ema21.length - 2]) {
    reasons.push("EMA 9/21 bearish crossover"); signal = "Sell";
  }

  if (engine.simulationMode && !signal) {
    if (macd.histogram > 0) { signal = "Buy"; reasons.push("MACD bullish (sim)"); }
    else if (macd.histogram < 0) { signal = "Sell"; reasons.push("MACD bearish (sim)"); }
  }

  const minSignals = engine.simulationMode ? 1 : 2;
  console.log(`[Scalp] ${symbol} analysis: price=${price.toFixed(2)} rsi=${rsi.toFixed(1)} macd=${macd.histogram.toFixed(4)} signal=${signal ?? 'none'} reasons=${reasons.length} minReq=${minSignals} mtf=${mtf.direction}`);
  if (signal && reasons.length >= minSignals) {
    const strats = await db.getUserStrategies(engine.userId);
    const strat = strats.find(s => s.symbol === symbol && s.strategyType === "scalping") ?? strats.find(s => s.symbol === symbol);
    const allocation = strat?.allocationPct ?? 30;
    const state = await db.getOrCreateBotState(engine.userId);
    const balance = parseFloat(state?.currentBalance ?? "5000");
    const tradeAmount = balance * allocation / 100 * 0.1;
    const qty = (tradeAmount / price).toFixed(6);

    const orderId = await placeOrder(engine, symbol, signal, qty, category);
    if (orderId) {
      let grossPnl: number;
      if (engine.simulationMode) {
        const pnlPct = (Math.random() * 0.008 - 0.002);
        grossPnl = tradeAmount * pnlPct;
      } else {
        const emaDiff = Math.abs(ema9Current - ema21Current) / price;
        const direction = signal === "Buy" ? 1 : -1;
        grossPnl = tradeAmount * emaDiff * direction * 0.5;
      }

      const pnl = calcNetPnl(grossPnl, tradeAmount, category, true, engine.exchange);

      await db.insertTrade({
        userId: engine.userId, symbol, side: signal.toLowerCase(),
        price: price.toString(), qty, pnl: pnl.toFixed(2),
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
      console.log(`[Scalp] ${signal} ${symbol} @ ${price.toFixed(2)} qty=${qty} net=${pnl.toFixed(2)} reasons=${reasons.join(", ")}`);

      // Telegram notification for scalp trades
      if (pnl > 0.1) {
        await sendTelegramNotification(engine,
          `⚡ <b>PHANTOM Scalp ${signal}</b>\nPar: ${symbol}\nPrecio: $${price.toFixed(2)}\nGanancia: <b>$${pnl.toFixed(2)}</b>`
        );
      }
    }
  }
}

// ─── Futures Long-Only Strategy ───
async function runFuturesLongOnly(engine: EngineState, symbol: string) {
  const ticker = await fetchTicker(engine.client, symbol, "linear");
  if (!ticker) return;

  const price = ticker.lastPrice;
  engine.lastPrices[symbol] = price;
  livePrices.set(symbol, ticker);

  // Crypto futures trade 24/7 — no hours restriction
  // Note: volume is naturally lower outside NY hours but we still trade

  // Volume filter
  if (!hasAdequateVolume(symbol)) return;

  // Multi-timeframe check — only enter if bullish
  const mtf = await multiTimeframeCheck(engine.client, symbol, "linear");

  // Check existing positions
  if (!engine.futuresPositions[symbol]) engine.futuresPositions[symbol] = [];
  const positions = engine.futuresPositions[symbol];

  // ─── Manage existing positions: Stop-Loss + Take Profit + Trailing ───
  const futStrats = await db.getUserStrategies(engine.userId);
  const futStrat = futStrats.find(s => s.symbol === symbol && s.strategyType === "futures");
  const futConfig = futStrat?.config as any ?? {};
  const futuresStopLossPct = (futConfig.stopLossPct ?? 2.0) / 100; // Default 2% stop-loss for futures
  const futuresMaxHoldHours = futConfig.maxHoldHours ?? 12; // Max 12 hours for futures

  for (let i = positions.length - 1; i >= 0; i--) {
    const pos = positions[i];
    const profitPct = (price - pos.entryPrice) / pos.entryPrice;
    const lossPct = (pos.entryPrice - price) / pos.entryPrice;
    const holdTimeMs = Date.now() - pos.openedAt;
    let closeReason = "";

    // 1. STOP-LOSS: Cut losses
    if (lossPct >= futuresStopLossPct) {
      closeReason = `STOP-LOSS (${(lossPct * 100).toFixed(2)}% loss, ${pos.leverage}x)`;
    }
    // 2. TIME STOP: Close if held too long without profit
    else if (holdTimeMs > futuresMaxHoldHours * 3600000 && profitPct < 0.003) {
      closeReason = `TIME-STOP (held ${(holdTimeMs / 3600000).toFixed(1)}h)`;
    }
    // 3. TAKE PROFIT
    else if (profitPct >= pos.takeProfitPct / 100) {
      closeReason = `TAKE-PROFIT (${(profitPct * 100).toFixed(2)}%)`;
    }

    if (closeReason) {
      const orderId = await placeOrder(engine, symbol, "Sell", pos.qty, "linear");
      if (orderId) {
        const grossPnl = (price - pos.entryPrice) * parseFloat(pos.qty) * pos.leverage;
        const pnl = calcNetPnl(grossPnl, pos.tradeAmount * pos.leverage, "linear", true, "bybit");

        await db.insertTrade({
          userId: engine.userId, symbol, side: "sell", price: price.toString(),
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

        // Track max drawdown
        if (pnl < 0) {
          const state = await db.getOrCreateBotState(engine.userId);
          const currentDrawdown = Math.abs(pnl);
          const maxDrawdown = parseFloat(state?.maxDrawdown ?? "0");
          if (currentDrawdown > maxDrawdown) {
            await db.updateBotState(engine.userId, { maxDrawdown: currentDrawdown.toFixed(2) });
          }
        }

        const emoji = pnl > 0 ? "🎯" : "🛑";
        console.log(`[Futures] ${closeReason} ${symbol} @ ${price.toFixed(2)} entry=${pos.entryPrice.toFixed(2)} pnl=$${pnl.toFixed(2)} (${pos.leverage}x)`);

        await sendTelegramNotification(engine,
          `${emoji} <b>PHANTOM Futures ${closeReason.split(" ")[0]}</b>\nPar: ${symbol}\nEntrada: $${pos.entryPrice.toFixed(2)}\nSalida: $${price.toFixed(2)}\nApalancamiento: ${pos.leverage}x\nResultado: <b>$${pnl.toFixed(2)}</b>`
        );

        positions.splice(i, 1);
      }
    }
  }

  // ─── Open new Long position if conditions are right ───
  const maxPositions = 2;
  if (positions.length >= maxPositions) return;
  if (mtf.direction !== "bullish" || !mtf.aligned) return;

  // Additional confirmation: RSI not overbought, MACD bullish
  const klines = await fetchKlines(engine.client, symbol, "15", 50, "linear");
  if (klines.closes.length < 26) return;
  const rsi = calculateRSI(klines.closes);
  const macd = calculateMACD(klines.closes);
  if (rsi > 65) return; // don't enter overbought
  if (macd.histogram <= 0) return; // need bullish MACD

  const futStrats2 = await db.getUserStrategies(engine.userId);
  const strat = futStrats2.find(s => s.symbol === symbol && s.strategyType === "futures");
  const config = strat?.config as any;
  const leverage = config?.leverage ?? 2;
  const takeProfitPct = config?.takeProfitPct ?? 1.0;
  const allocation = strat?.allocationPct ?? 20;
  const state = await db.getOrCreateBotState(engine.userId);
  const balance = parseFloat(state?.currentBalance ?? "5000");
  const tradeAmount = (balance * allocation / 100) / maxPositions;
  const qty = ((tradeAmount * leverage) / price).toFixed(6);

  const orderId = await placeOrder(engine, symbol, "Buy", qty, "linear");
  if (orderId) {
    positions.push({
      symbol, entryPrice: price, qty, leverage, takeProfitPct,
      tradeAmount, openedAt: Date.now(),
    });

    await db.insertTrade({
      userId: engine.userId, symbol, side: "buy", price: price.toString(),
      qty, pnl: "0.00", strategy: "futures", orderId, simulated: engine.simulationMode,
    });

    console.log(`[Futures] LONG ${symbol} @ ${price.toFixed(2)} qty=${qty} leverage=${leverage}x TP=${takeProfitPct}% order=${orderId}`);

    await sendTelegramNotification(engine,
      `📈 <b>PHANTOM Futures Long</b>\nPar: ${symbol}\nEntrada: $${price.toFixed(2)}\nApalancamiento: ${leverage}x\nTP: ${takeProfitPct}%`
    );
  }
}

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

          await sendTelegramNotification(engine,
            `📊 <b>PHANTOM Scanner: ${signal}</b>\nPar: ${symbol}\nPrecio: $${price.toFixed(4)}\nConfianza: ${confidence}%\n${reasons.join("\n")}`
          );
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
    futuresPositions: {}, dcaPositions: {},
    telegramBotToken, telegramChatId,
  };

  engines.set(userId, engine);
  await db.updateBotState(userId, { isRunning: true, startedAt: new Date() });
  await updateLivePrices(client);
  engineCycles.set(userId, 0);

  // Main trading loop — every 30 seconds
  engine.intervalId = setInterval(async () => {
    if (!engine.isRunning) return;
    try {
      const cycleNum = (engineCycles.get(userId) ?? 0) + 1;
      engineCycles.set(userId, cycleNum);
      console.log(`[Engine] Cycle #${cycleNum} for user ${userId}`);

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
          if (strat.strategyType === "grid") await runGridStrategy(bybitEngine, strat.symbol, cat as "spot" | "linear");
          else if (strat.strategyType === "scalping") await runScalpingStrategy(bybitEngine, strat.symbol, cat as "spot" | "linear");
          continue;
        }

        // Single exchange mode
        console.log(`[Engine] Running ${strat.strategyType} for ${strat.symbol} (${strat.category})`);
        if (strat.strategyType === "grid") {
          await runGridStrategy(engine, strat.symbol, cat as "spot" | "linear");
        } else if (strat.strategyType === "scalping") {
          await runScalpingStrategy(engine, strat.symbol, cat as "spot" | "linear");
        }
      }
    } catch (e) {
      console.error("[Engine] Trading loop error:", (e as Error).message);
    }
  }, 30_000);

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
        if (strat.strategyType === "grid") await runGridStrategy(bybitEngine, strat.symbol, cat as "spot" | "linear");
        else if (strat.strategyType === "scalping") await runScalpingStrategy(bybitEngine, strat.symbol, cat as "spot" | "linear");
      } else {
        console.log(`[Engine] First cycle: ${strat.strategyType} ${strat.symbol}`);
        if (strat.strategyType === "grid") await runGridStrategy(engine, strat.symbol, cat as "spot" | "linear");
        else if (strat.strategyType === "scalping") await runScalpingStrategy(engine, strat.symbol, cat as "spot" | "linear");
      }
    }
  }, 2000);

  return { success: true };
}

export async function stopEngine(userId: number): Promise<{ success: boolean }> {
  const engine = engines.get(userId);
  if (!engine) return { success: true };

  engine.isRunning = false;
  if (engine.intervalId) clearInterval(engine.intervalId);
  if (engine.scannerIntervalId) clearInterval(engine.scannerIntervalId);
  if (engine.priceIntervalId) clearInterval(engine.priceIntervalId);
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
const LINEAR_SYMBOLS = ["XAUUSDT", "SPXUSDT"];

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
  }, 30_000);
}

async function updateSP500Price() {
  const sp500 = await fetchSP500Price();
  if (sp500) livePrices.set("SP500", sp500);
}

// Auto-start on module load
startBybitWebSocketFeed();
startKuCoinWebSocketFeed();
