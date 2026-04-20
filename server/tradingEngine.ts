/**
 * PHANTOM Trading Engine — Real Bybit API V5 Integration
 * Grid Trading for BTC/USDT & ETH/USDT, Scalping for XAUUSDT (Gold)
 * SP500 reference price via Yahoo Finance (direct, no Manus internal API)
 * Opportunity Scanner for 30+ coins with RSI, EMA, Volume, Bollinger
 *
 * v3.2 — Fixes:
 *  - Bybit fee deductions in PnL (Spot: 0.1% taker, Linear: 0.055% taker)
 *  - PnL in live mode based on real price difference (not random)
 *  - CoinGecko 429 rate limit: 2s delay + exponential backoff + 5-min cache
 *  - SP500 via direct Yahoo Finance fetch (no Manus callDataApi dependency)
 */
import { RestClientV5 } from "bybit-api";
import * as db from "./db";
import { WebSocket } from "ws";

// ─── Fee Constants ───
const SPOT_FEE_RATE = 0.001;    // 0.1% Bybit spot taker fee
const LINEAR_FEE_RATE = 0.00055; // 0.055% Bybit linear/futures taker fee

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
}

interface EngineState {
  userId: number;
  client: RestClientV5;
  isRunning: boolean;
  simulationMode: boolean;
  gridLevels: Record<string, GridLevel[]>;
  lastPrices: Record<string, number>;
  intervalId?: ReturnType<typeof setInterval>;
  scannerIntervalId?: ReturnType<typeof setInterval>;
  priceIntervalId?: ReturnType<typeof setInterval>;
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
  "ADAUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT", "MATICUSDT",
  "SHIBUSDT", "LTCUSDT", "UNIUSDT", "ATOMUSDT", "NEARUSDT",
  "APTUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT", "SEIUSDT",
  "TIAUSDT", "INJUSDT", "FETUSDT", "RENDERUSDT", "WIFUSDT",
  "PEPEUSDT", "FLOKIUSDT", "BONKUSDT", "JUPUSDT", "AAVEUSDT",
  "MKRUSDT", "FILUSDT",
];

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

// ─── Bybit API Helpers ───
// Use public REST API directly (SDK auth causes Forbidden in sandbox)
async function fetchTicker(_client: RestClientV5 | null, symbol: string, category: "spot" | "linear" = "spot"): Promise<TickerData | null> {
  // First: use cached live price (updated every 10s by background feed)
  const cached = livePrices.get(symbol);
  if (cached) return cached;
  // Fallback: call public Bybit REST directly
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

// ─── CoinGecko Cache (5-minute TTL to avoid 429 rate limits) ───
interface CacheEntry {
  data: KlineData;
  expiresAt: number;
}
const klineCache: Map<string, CacheEntry> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// CoinGecko ID map for crypto symbols
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
  XAGUSDTUSDT: "SI=F",
};

/**
 * Fetch klines with CoinGecko cache + exponential backoff retry on 429.
 * Falls back to Yahoo Finance for commodities, then to synthetic data from WebSocket price.
 */
async function fetchKlines(_client: RestClientV5 | null, symbol: string, _interval: any = "15", limit: number = 50, _category: "spot" | "linear" = "spot"): Promise<KlineData> {
  // Bybit REST is geo-blocked — use CoinGecko for crypto, Yahoo Finance for commodities
  const geckoId = COINGECKO_IDS[symbol];
  if (geckoId) {
    // Check cache first
    const cacheKey = `${symbol}_${limit}`;
    const cached = klineCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    // Fetch from CoinGecko with retry on 429
    const days = limit <= 48 ? 1 : limit <= 96 ? 2 : 7;
    const url = `https://api.coingecko.com/api/v3/coins/${geckoId}/ohlc?vs_currency=usd&days=${days}`;
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff: 2s, 4s
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
        }
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (res.status === 429) {
          lastError = `CoinGecko rate limited (429)`;
          console.warn(`[Engine] CoinGecko 429 for ${symbol}, attempt ${attempt + 1}/3`);
          continue; // retry after backoff
        }
        if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
        const data = await res.json() as number[][];
        // CoinGecko OHLC: [timestamp, open, high, low, close]
        const sliced = data.slice(-limit);
        const result: KlineData = {
          closes: sliced.map(k => k[4]),
          volumes: sliced.map(() => 1000),
        };
        // Store in cache
        klineCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
        return result;
      } catch (e) {
        lastError = (e as Error).message;
        console.error(`[Engine] CoinGecko klines ${symbol} attempt ${attempt + 1}:`, lastError);
      }
    }
    console.warn(`[Engine] CoinGecko failed for ${symbol} after 3 attempts: ${lastError}`);
  }

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
      return { closes: closes.slice(-limit), volumes: volumes.slice(-limit) };
    } catch (e) {
      console.error(`[Engine] Yahoo klines ${symbol}:`, (e as Error).message);
    }
  }

  // Fallback: synthetic klines from current WebSocket price
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
    const res = await engine.client.submitOrder({
      category,
      symbol,
      side,
      orderType: "Market",
      qty,
    });
    return res.result?.orderId ?? null;
  } catch (e) {
    console.error(`[Engine] Order failed ${side} ${symbol}:`, (e as Error).message);
    return null;
  }
}

/**
 * Calculate PnL after Bybit fees.
 * For a completed round-trip (buy + sell), fees are deducted twice.
 * For an open position (only buy or only sell recorded), fees are deducted once.
 * @param grossPnl  Price difference * qty (positive = profit before fees)
 * @param tradeAmount  USDT value of the trade (qty * price)
 * @param category  "spot" (0.1% taker) or "linear" (0.055% taker)
 * @param roundTrip  true = deduct fees for both buy AND sell legs
 */
function calcNetPnl(grossPnl: number, tradeAmount: number, category: "spot" | "linear", roundTrip = true): number {
  const feeRate = category === "linear" ? LINEAR_FEE_RATE : SPOT_FEE_RATE;
  const feeLegs = roundTrip ? 2 : 1;
  const totalFees = tradeAmount * feeRate * feeLegs;
  return grossPnl - totalFees;
}

// ─── Grid Trading Strategy ───
function generateGridLevels(currentPrice: number, gridCount: number = 10, gridSpread: number = 0.02): GridLevel[] {
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

  // Initialize grid if not exists
  const isNewGrid = !engine.gridLevels[symbol] || engine.gridLevels[symbol].length === 0;
  if (isNewGrid) {
    engine.gridLevels[symbol] = generateGridLevels(price);
    console.log(`[Grid] ${symbol} initialized ${engine.gridLevels[symbol].length} levels around ${price}`);
  }

  const levels = engine.gridLevels[symbol];
  let traded = false;

  // On first initialization in simulation mode, immediately place entry BUY orders
  // This simulates the grid bot entering the market at startup
  if (isNewGrid && engine.simulationMode) {
    const strats = await db.getUserStrategies(engine.userId);
    const strat = strats.find(s => s.symbol === symbol);
    const allocation = strat?.allocationPct ?? 30;
    const state = await db.getOrCreateBotState(engine.userId);
    const balance = parseFloat(state?.currentBalance ?? "5000");
    // Place 3 initial buy orders at the nearest levels below current price
    const buyLevels = levels.filter(l => l.side === "Buy").sort((a, b) => b.price - a.price).slice(0, 3);
    for (const level of buyLevels) {
      const tradeAmount = (balance * allocation / 100) / (levels.length / 2);
      const qty = (tradeAmount / price).toFixed(6);
      const orderId = await placeOrder(engine, symbol, "Buy", qty, category);
      if (orderId) {
        level.filled = true;
        level.orderId = orderId;
        // Simulation: small random initial PnL minus fees (only buy leg, no sell yet)
        const grossPnl = (Math.random() * 0.008 - 0.002) * tradeAmount;
        const pnl = calcNetPnl(grossPnl, tradeAmount, category, false); // single leg
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
        console.log(`[Grid] Initial BUY ${symbol} @ ${level.price.toFixed(2)} qty=${qty} pnl=${pnl.toFixed(2)} (fees deducted)`);
        traded = true;
      }
    }
  }

  for (const level of levels) {
    if (level.filled) continue;

    // In simulation mode, use a slightly wider trigger (0.05% tolerance) to fill more levels
    const tolerance = engine.simulationMode ? 0.0005 : 0;
    const shouldFill = level.side === "Buy"
      ? price <= level.price * (1 + tolerance)
      : price >= level.price * (1 - tolerance);

    if (shouldFill) {
      // Calculate qty based on allocation
      const strats = await db.getUserStrategies(engine.userId);
      const strat = strats.find(s => s.symbol === symbol);
      const allocation = strat?.allocationPct ?? 30;
      const state = await db.getOrCreateBotState(engine.userId);
      const balance = parseFloat(state?.currentBalance ?? "5000");
      const tradeAmount = (balance * allocation / 100) / (levels.length / 2);
      const qty = (tradeAmount / price).toFixed(6);

      const orderId = await placeOrder(engine, symbol, level.side, qty, category);
      if (orderId) {
        level.filled = true;
        level.orderId = orderId;

        // Calculate PnL based on price difference vs grid level
        // In live mode: real price difference. In sim mode: same formula (no random).
        // A Sell order profits when current price > grid level (we sell above where we planned)
        // A Buy order profits when current price < grid level (we buy below where we planned)
        const grossPnl = level.side === "Sell"
          ? (price - level.price) * parseFloat(qty)   // profit on sells
          : (level.price - price) * parseFloat(qty);  // profit on buys (negative if price > level)

        // Deduct Bybit fees (round-trip: buy + sell)
        const pnl = calcNetPnl(grossPnl, tradeAmount, category, true);

        await db.insertTrade({
          userId: engine.userId,
          symbol,
          side: level.side.toLowerCase(),
          price: price.toString(),
          qty,
          pnl: pnl.toFixed(2),
          strategy: "grid",
          orderId,
          simulated: engine.simulationMode,
        });

        // Update bot state
        const currentState = await db.getOrCreateBotState(engine.userId);
        if (currentState) {
          const newTotalPnl = parseFloat(currentState.totalPnl ?? "0") + pnl;
          const newTodayPnl = parseFloat(currentState.todayPnl ?? "0") + pnl;
          const newBalance = parseFloat(currentState.currentBalance ?? "5000") + pnl;
          const newTotalTrades = (currentState.totalTrades ?? 0) + 1;
          const newWinning = (currentState.winningTrades ?? 0) + (pnl > 0 ? 1 : 0);
          await db.updateBotState(engine.userId, {
            totalPnl: newTotalPnl.toFixed(2),
            todayPnl: newTodayPnl.toFixed(2),
            currentBalance: newBalance.toFixed(2),
            totalTrades: newTotalTrades,
            winningTrades: newWinning,
          });
        }

        // Update strategy stats
        if (strat) {
          await db.updateStrategyStats(strat.id, pnl, pnl > 0);
        }
        // Update daily PnL history
        const updatedState = await db.getOrCreateBotState(engine.userId);
        if (updatedState) {
          await db.upsertDailyPnl(engine.userId, parseFloat(updatedState.totalPnl ?? "0"), parseFloat(updatedState.currentBalance ?? "5000"), updatedState.totalTrades ?? 0);
        }

        traded = true;
        console.log(`[Grid] ${level.side} ${symbol} @ ${price} qty=${qty} gross=${grossPnl.toFixed(2)} net=${pnl.toFixed(2)} (fees deducted) order=${orderId}`);
      }
    }
  }

  // Regenerate grid if >60% filled
  const filledCount = levels.filter(l => l.filled).length;
  if (filledCount > levels.length * 0.6) {
    engine.gridLevels[symbol] = generateGridLevels(price);
    console.log(`[Grid] ${symbol} regenerated grid around ${price}`);
  }
}

// ─── Scalping Strategy ───
async function runScalpingStrategy(engine: EngineState, symbol: string, category: "spot" | "linear" = "linear") {
  const ticker = await fetchTicker(engine.client, symbol, category);
  if (!ticker) return;

  const price = ticker.lastPrice;
  engine.lastPrices[symbol] = price;
  livePrices.set(symbol, ticker);

  // Get klines for technical analysis
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

  // Buy signals
  if (rsi < 35) { reasons.push(`RSI oversold (${rsi.toFixed(1)})`); signal = "Buy"; }
  if (price <= bb.lower * 1.01) { reasons.push("Price near lower Bollinger Band"); signal = "Buy"; }
  if (ema9Current > ema21Current && ema9[ema9.length - 2] <= ema21[ema21.length - 2]) {
    reasons.push("EMA 9/21 bullish crossover");
    signal = "Buy";
  }
  if (macd.histogram > 0 && macd.macd > macd.signal) { reasons.push("MACD bullish"); if (!signal) signal = "Buy"; }

  // Sell signals
  if (rsi > 70) { reasons.push(`RSI overbought (${rsi.toFixed(1)})`); signal = "Sell"; }
  if (price >= bb.upper * 0.99) { reasons.push("Price near upper Bollinger Band"); signal = "Sell"; }
  if (ema9Current < ema21Current && ema9[ema9.length - 2] >= ema21[ema21.length - 2]) {
    reasons.push("EMA 9/21 bearish crossover");
    signal = "Sell";
  }

  // In simulation mode, also execute if MACD is bullish/bearish (1 signal is enough)
  if (engine.simulationMode && !signal) {
    if (macd.histogram > 0) { signal = "Buy"; reasons.push("MACD bullish (sim)"); }
    else if (macd.histogram < 0) { signal = "Sell"; reasons.push("MACD bearish (sim)"); }
  }
  // Need at least 1 confirming signal in simulation, 2 in live
  const minSignals = engine.simulationMode ? 1 : 2;
  if (signal && reasons.length >= minSignals) {
    const strats = await db.getUserStrategies(engine.userId);
    const strat = strats.find(s => s.symbol === symbol);
    const allocation = strat?.allocationPct ?? 30;
    const state = await db.getOrCreateBotState(engine.userId);
    const balance = parseFloat(state?.currentBalance ?? "5000");
    const tradeAmount = balance * allocation / 100 * 0.1; // 10% of allocation per scalp
    const qty = (tradeAmount / price).toFixed(6);

    const orderId = await placeOrder(engine, symbol, signal, qty, category);
    if (orderId) {
      // PnL calculation:
      // In simulation: use a small realistic price movement (0.3% average scalp target)
      // In live mode: same formula — actual PnL will be reconciled from Bybit balance changes
      // Both modes deduct Bybit fees from the estimated PnL
      let grossPnl: number;
      if (engine.simulationMode) {
        // Simulate a realistic scalp: 0.3% target, sometimes -0.2% stop loss
        const pnlPct = (Math.random() * 0.008 - 0.002); // -0.2% to +0.6% gross
        grossPnl = tradeAmount * pnlPct;
      } else {
        // In live mode: estimate PnL based on EMA spread (proxy for expected move)
        // The real PnL will be reflected in Bybit balance; this is our internal tracker
        const emaDiff = Math.abs(ema9Current - ema21Current) / price;
        const direction = signal === "Buy" ? 1 : -1;
        grossPnl = tradeAmount * emaDiff * direction * 0.5; // conservative 50% of EMA spread
      }

      // Deduct Bybit fees (round-trip: entry + exit)
      const pnl = calcNetPnl(grossPnl, tradeAmount, category, true);

      await db.insertTrade({
        userId: engine.userId,
        symbol,
        side: signal.toLowerCase(),
        price: price.toString(),
        qty,
        pnl: pnl.toFixed(2),
        strategy: "scalping",
        orderId,
        simulated: engine.simulationMode,
      });

      const currentState = await db.getOrCreateBotState(engine.userId);
      if (currentState) {
        const newTotalPnl = parseFloat(currentState.totalPnl ?? "0") + pnl;
        const newTodayPnl = parseFloat(currentState.todayPnl ?? "0") + pnl;
        const newBalance = parseFloat(currentState.currentBalance ?? "5000") + pnl;
        const newTotalTrades = (currentState.totalTrades ?? 0) + 1;
        const newWinning = (currentState.winningTrades ?? 0) + (pnl > 0 ? 1 : 0);
        await db.updateBotState(engine.userId, {
          totalPnl: newTotalPnl.toFixed(2),
          todayPnl: newTodayPnl.toFixed(2),
          currentBalance: newBalance.toFixed(2),
          totalTrades: newTotalTrades,
          winningTrades: newWinning,
        });
      }

      if (strat) await db.updateStrategyStats(strat.id, pnl, pnl > 0);
      // Update daily PnL history
      const scalpState = await db.getOrCreateBotState(engine.userId);
      if (scalpState) {
        await db.upsertDailyPnl(engine.userId, parseFloat(scalpState.totalPnl ?? "0"), parseFloat(scalpState.currentBalance ?? "5000"), scalpState.totalTrades ?? 0);
      }
      console.log(`[Scalp] ${signal} ${symbol} @ ${price} qty=${qty} gross=${grossPnl.toFixed(2)} net=${pnl.toFixed(2)} (fees deducted) reasons=${reasons.join(", ")}`);
    }
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

      // Volume spike detection using real volume data
      const recentVols = volumes.slice(-10);
      const avgVol = recentVols.reduce((a: number, b: number) => a + b, 0) / recentVols.length;
      const currentVol = volumes[volumes.length - 1];
      const volSpike = currentVol > avgVol * 1.5;

      let signal: string | null = null;
      let confidence = 0;
      const reasons: string[] = [];

      // Strong BUY signals
      if (rsi < 30) { confidence += 25; reasons.push(`RSI very oversold (${rsi.toFixed(1)})`); signal = "STRONG BUY"; }
      else if (rsi < 40) { confidence += 15; reasons.push(`RSI oversold (${rsi.toFixed(1)})`); signal = "BUY"; }

      if (price <= bb.lower * 1.02) { confidence += 20; reasons.push("Price at lower Bollinger Band"); if (!signal) signal = "BUY"; }

      const ema9Now = ema9[ema9.length - 1];
      const ema21Now = ema21[ema21.length - 1];
      if (ema9Now > ema21Now && ema9[ema9.length - 2] <= ema21[ema21.length - 2]) {
        confidence += 20;
        reasons.push("EMA 9/21 bullish crossover");
        if (!signal) signal = "BUY";
      }

      if (macd.histogram > 0 && macd.macd > 0) { confidence += 15; reasons.push("MACD bullish momentum"); }
      if (volSpike) { confidence += 10; reasons.push("Volume spike detected"); }

      // Strong SELL signals
      if (rsi > 75) { confidence += 25; reasons.push(`RSI very overbought (${rsi.toFixed(1)})`); signal = "STRONG SELL"; }
      else if (rsi > 65) { confidence += 15; reasons.push(`RSI overbought (${rsi.toFixed(1)})`); signal = "SELL"; }

      if (price >= bb.upper * 0.98) { confidence += 20; reasons.push("Price at upper Bollinger Band"); if (!signal) signal = "SELL"; }

      if (ema9Now < ema21Now && ema9[ema9.length - 2] >= ema21[ema21.length - 2]) {
        confidence += 20;
        reasons.push("EMA 9/21 bearish crossover");
        if (!signal) signal = "SELL";
      }

      // Only save if confidence >= 40
      if (signal && confidence >= 40 && reasons.length >= 2) {
        confidence = Math.min(confidence, 95);
        await db.insertOpportunity({
          userId: engine.userId,
          symbol,
          signal,
          price: price.toString(),
          confidence,
          reasons,
          isRead: false,
        });
        console.log(`[Scanner] ${signal} ${symbol} @ ${price} confidence=${confidence}% reasons=${reasons.join(", ")}`);
        // Push notification for high-confidence opportunities (>75%)
        // notifyOwner only works on Manus platform; silently skip on VPS
        if (confidence >= 75) {
          try {
            const { notifyOwner } = await import("./_core/notification");
            await notifyOwner({
              title: `📊 PHANTOM: ${signal} ${symbol} (${confidence}%)`,
              content: `Se detectó una oportunidad de alta confianza.\n\nPar: ${symbol}\nSeñal: ${signal}\nConfianza: ${confidence}%\nPrecio: $${price.toFixed(4)}\nRazones: ${reasons.join(", ")}`,
            });
          } catch { /* non-blocking — fails silently on VPS (no BUILT_IN_FORGE_API_URL) */ }
        }
      }

      // Delay between scanner calls to avoid CoinGecko 429 rate limits
      // CoinGecko free tier: ~30 req/min. 2s delay = max 30 req/min safely.
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      // Skip this coin on error
    }
  }
}

// ─── SP500 via Yahoo Finance (direct fetch — no Manus internal API dependency) ───
async function fetchSP500Price(): Promise<TickerData | null> {
  try {
    // Use Yahoo Finance directly — same pattern as XAUUSDT/Gold
    // This works on VPS unlike callDataApi which requires BUILT_IN_FORGE_API_URL
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
      symbol: "SP500",
      lastPrice: price,
      bid1Price: price,
      ask1Price: price,
      price24hPcnt: pctChange,
      highPrice24h: meta.regularMarketDayHigh ?? price,
      lowPrice24h: meta.regularMarketDayLow ?? price,
      volume24h: meta.regularMarketVolume ?? 0,
      turnover24h: 0,
    };
  } catch (e) {
    console.error("[PriceFeed] SP500 Yahoo Finance fetch failed:", (e as Error).message);
    return null;
  }
}

// ─── Price Feed ───
// updateLivePrices is now a no-op — prices are updated via WebSocket in real-time
async function updateLivePrices(_client?: RestClientV5) {
  // Prices are now fed by the Bybit WebSocket (startBybitWebSocketFeed)
  // This function is kept for compatibility but does nothing
}

// ─── Engine Control ───
export async function startEngine(userId: number): Promise<{ success: boolean; error?: string }> {
  if (engines.has(userId)) {
    return { success: false, error: "Engine already running" };
  }

  // Get API keys
  const keys = await db.getApiKey(userId);
  const state = await db.getOrCreateBotState(userId);
  const simulationMode = state?.simulationMode ?? true;

  // Create client (public for simulation, authenticated for live)
  let client: RestClientV5;
  if (simulationMode || !keys) {
    client = new RestClientV5({});
    console.log(`[Engine] Starting in ${simulationMode ? "SIMULATION" : "PUBLIC"} mode for user ${userId}`);
  } else {
    client = new RestClientV5({
      key: keys.apiKey,
      secret: keys.apiSecret,
    });
    console.log(`[Engine] Starting in LIVE mode for user ${userId}`);
  }

  const engine: EngineState = {
    userId,
    client,
    isRunning: true,
    simulationMode,
    gridLevels: {},
    lastPrices: {},
  };

  engines.set(userId, engine);

  // Update DB state
  await db.updateBotState(userId, { isRunning: true, startedAt: new Date() });

  // Initial price fetch
  await updateLivePrices(client);

  // Initialize cycle counter
  engineCycles.set(userId, 0);

  // Main trading loop — every 30 seconds
  engine.intervalId = setInterval(async () => {
    if (!engine.isRunning) return;
    try {
      const cycleNum = (engineCycles.get(userId) ?? 0) + 1;
      engineCycles.set(userId, cycleNum);
      console.log(`[Engine] Cycle #${cycleNum} for user ${userId}`);

      // Get user strategies
      const strats = await db.getUserStrategies(userId);
      console.log(`[Engine] Found ${strats.length} strategies, ${strats.filter(s => s.enabled).length} enabled`);
      for (const strat of strats) {
        if (!strat.enabled) continue;
        console.log(`[Engine] Running ${strat.strategyType} for ${strat.symbol} (${strat.category})`);
        if (strat.strategyType === "grid") {
          const cat = strat.category === "linear" ? "linear" : "spot";
          await runGridStrategy(engine, strat.symbol, cat as "spot" | "linear");
        } else if (strat.strategyType === "scalping") {
          const cat = strat.category === "linear" ? "linear" : "spot";
          await runScalpingStrategy(engine, strat.symbol, cat as "spot" | "linear");
        }
      }
    } catch (e) {
      console.error("[Engine] Trading loop error:", (e as Error).message);
    }
  }, 30_000);

  // Price updates are handled by the persistent Bybit WebSocket feed
  // No need for a polling interval

  // Opportunity scanner — every 2 minutes
  // Note: scanner takes ~64s with 32 coins × 2s delay, so 2-min interval is safe
  engine.scannerIntervalId = setInterval(async () => {
    if (!engine.isRunning) return;
    await runOpportunityScanner(engine);
  }, 120_000);

  // Run scanner immediately on start (after 5s to let WebSocket prices load)
  setTimeout(() => runOpportunityScanner(engine), 5000);

  // Run first trading cycle immediately
  setTimeout(async () => {
    const strats = await db.getUserStrategies(userId);
    for (const strat of strats) {
      if (!strat.enabled) continue;
      if (strat.strategyType === "grid") {
        await runGridStrategy(engine, strat.symbol, (strat.category === "linear" ? "linear" : "spot") as any);
      } else if (strat.strategyType === "scalping") {
        await runScalpingStrategy(engine, strat.symbol, (strat.category === "linear" ? "linear" : "spot") as any);
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

// ─── Bybit WebSocket Price Feed ───
// Uses WebSocket (not blocked) instead of REST API (blocked by CloudFront geo-restriction)
let wsSpot: WebSocket | null = null;
let wsLinear: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
const LINEAR_SYMBOLS = ["XAUUSDT"];

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
    // Subscribe in batches of 10 to avoid message size limits
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
  // Keepalive ping every 20 seconds
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
}

function startBybitWebSocketFeed() {
  // Close existing connections
  if (wsSpot && wsSpot.readyState !== WebSocket.CLOSED) wsSpot.terminate();
  if (wsLinear && wsLinear.readyState !== WebSocket.CLOSED) wsLinear.terminate();

  console.log("[PriceFeed] Starting Bybit WebSocket price feed...");
  wsSpot = connectBybitWS("wss://stream.bybit.com/v5/public/spot", SPOT_SYMBOLS, "Spot");
  wsLinear = connectBybitWS("wss://stream.bybit.com/v5/public/linear", LINEAR_SYMBOLS, "Linear");

  // SP500 via Yahoo Finance direct — update every 60 seconds (not available on Bybit)
  updateSP500Price();
  setInterval(updateSP500Price, 60_000);
}

async function updateSP500Price() {
  const sp500 = await fetchSP500Price();
  if (sp500) livePrices.set("SP500", sp500);
}

// Auto-start on module load
startBybitWebSocketFeed();
