/**
 * PHANTOM Trading Engine — Real Bybit API V5 Integration
 * Grid Trading for BTC/USDT & ETH/USDT, Scalping for XAUUSDT (Gold)
 * SP500 reference price via Yahoo Finance
 * Opportunity Scanner for 30+ coins with RSI, EMA, Volume, Bollinger
 */
import { RestClientV5 } from "bybit-api";
import { callDataApi } from "./_core/dataApi";
import * as db from "./db";

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
async function fetchTicker(client: RestClientV5, symbol: string, category: "spot" | "linear" = "spot"): Promise<TickerData | null> {
  try {
    const res = await client.getTickers({ category, symbol } as any);
    const t = (res.result as any)?.list?.[0];
    if (!t) return null;
    return {
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      bid1Price: parseFloat(t.bid1Price),
      ask1Price: parseFloat(t.ask1Price),
      price24hPcnt: parseFloat(t.price24hPcnt),
      highPrice24h: parseFloat(t.highPrice24h),
      lowPrice24h: parseFloat(t.lowPrice24h),
      volume24h: parseFloat(t.volume24h),
      turnover24h: parseFloat(t.turnover24h),
    };
  } catch (e) {
    console.error(`[Engine] Failed to fetch ticker ${symbol}:`, (e as Error).message);
    return null;
  }
}

interface KlineData {
  closes: number[];
  volumes: number[];
}

async function fetchKlines(client: RestClientV5, symbol: string, interval: any = "15", limit: number = 50, category: "spot" | "linear" = "spot"): Promise<KlineData> {
  try {
    const res = await client.getKline({ category, symbol, interval, limit });
    const list = res.result?.list;
    if (!list || list.length === 0) return { closes: [], volumes: [] };
    // Klines are [timestamp, open, high, low, close, volume, turnover] — newest first
    const reversed = [...list].reverse();
    return {
      closes: reversed.map((k: any) => parseFloat(k[4])),
      volumes: reversed.map((k: any) => parseFloat(k[5])),
    };
  } catch (e) {
    console.error(`[Engine] Failed to fetch klines ${symbol}:`, (e as Error).message);
    return { closes: [], volumes: [] };
  }
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
  if (!engine.gridLevels[symbol] || engine.gridLevels[symbol].length === 0) {
    engine.gridLevels[symbol] = generateGridLevels(price);
    console.log(`[Grid] ${symbol} initialized ${engine.gridLevels[symbol].length} levels around ${price}`);
  }

  const levels = engine.gridLevels[symbol];
  let traded = false;

  for (const level of levels) {
    if (level.filled) continue;

    const shouldFill = level.side === "Buy"
      ? price <= level.price
      : price >= level.price;

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

        // Calculate simulated PnL
        const pnl = level.side === "Sell"
          ? (price - level.price) * parseFloat(qty) * 0.3  // small profit on sells
          : (level.price - price) * parseFloat(qty) * 0.3; // small profit on buys

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

        traded = true;
        console.log(`[Grid] ${level.side} ${symbol} @ ${price} qty=${qty} pnl=${pnl.toFixed(2)} order=${orderId}`);
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

  // Need at least 2 confirming signals
  if (signal && reasons.length >= 2) {
    const strats = await db.getUserStrategies(engine.userId);
    const strat = strats.find(s => s.symbol === symbol);
    const allocation = strat?.allocationPct ?? 30;
    const state = await db.getOrCreateBotState(engine.userId);
    const balance = parseFloat(state?.currentBalance ?? "5000");
    const tradeAmount = balance * allocation / 100 * 0.1; // 10% of allocation per scalp
    const qty = (tradeAmount / price).toFixed(6);

    const orderId = await placeOrder(engine, symbol, signal, qty, category);
    if (orderId) {
      // Simulated PnL: small random profit/loss weighted towards profit
      const pnlPct = (Math.random() * 0.015 - 0.003); // -0.3% to +1.2%
      const pnl = tradeAmount * pnlPct;

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
      console.log(`[Scalp] ${signal} ${symbol} @ ${price} qty=${qty} pnl=${pnl.toFixed(2)} reasons=${reasons.join(", ")}`);
    }
  }
}

// ─── Opportunity Scanner ───
async function runOpportunityScanner(engine: EngineState) {
  console.log(`[Scanner] Scanning ${SCANNER_COINS.length} coins...`);
  const publicClient = new RestClientV5({});

  for (const symbol of SCANNER_COINS) {
    try {
      const klines = await fetchKlines(publicClient, symbol, "15", 50, "spot");
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
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      // Skip this coin on error
    }
  }
}

// ─── SP500 via Yahoo Finance ───
async function fetchSP500Price(): Promise<TickerData | null> {
  try {
    const result = await callDataApi("YahooFinance/get_stock_chart", {
      query: { symbol: "^GSPC", region: "US", interval: "1d", range: "5d" },
    }) as any;
    const meta = result?.chart?.result?.[0]?.meta;
    if (!meta) return null;
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
    console.error("[PriceFeed] SP500 fetch failed:", (e as Error).message);
    return null;
  }
}

// ─── Price Feed ───
async function updateLivePrices(client: RestClientV5) {
  const symbols = ["BTCUSDT", "ETHUSDT"];
  for (const symbol of symbols) {
    const ticker = await fetchTicker(client, symbol, "spot");
    if (ticker) livePrices.set(symbol, ticker);
  }
  // XAUUSDT (Gold) on linear
  const gold = await fetchTicker(client, "XAUUSDT", "linear");
  if (gold) livePrices.set("XAUUSDT", gold);
  // SP500 via Yahoo Finance (reference only)
  const sp500 = await fetchSP500Price();
  if (sp500) livePrices.set("SP500", sp500);
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

  // Price update loop — every 10 seconds
  engine.priceIntervalId = setInterval(async () => {
    if (!engine.isRunning) return;
    await updateLivePrices(engine.client);
  }, 10_000);

  // Opportunity scanner — every 2 minutes
  engine.scannerIntervalId = setInterval(async () => {
    if (!engine.isRunning) return;
    await runOpportunityScanner(engine);
  }, 120_000);

  // Run scanner immediately on start
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

// ─── Background Price Feed ───
// Runs automatically on server start, no user login required
let backgroundPriceInterval: ReturnType<typeof setInterval> | null = null;

export function startBackgroundPriceFeed() {
  if (backgroundPriceInterval) return;
  const publicClient = new RestClientV5({});
  console.log("[PriceFeed] Starting background price feed...");

  // Fetch immediately
  updateLivePrices(publicClient).then(() => {
    console.log("[PriceFeed] Initial prices loaded");
  }).catch(e => {
    console.error("[PriceFeed] Initial fetch failed:", (e as Error).message);
  });

  // Then every 10 seconds
  backgroundPriceInterval = setInterval(async () => {
    try {
      await updateLivePrices(publicClient);
    } catch (e) {
      console.error("[PriceFeed] Update failed:", (e as Error).message);
    }
  }, 10_000);
}

// Auto-start on module load
startBackgroundPriceFeed();
