/**
 * PHANTOM Market Intelligence Engine v7.0
 * 
 * Superintelligence modules:
 * 1. Multi-Timeframe Analysis (MTA) — confirm signals across 5min + 15min + 1h
 * 2. BTC Correlation — track BTC trend to filter alt entries
 * 3. Volume Spike Detection — detect unusual volume for fast entries
 * 4. Order Book Imbalance — read bid/ask pressure
 * 5. Funding Rate — use perpetual funding for futures timing
 * 6. Liquidation Detection — detect squeeze events
 * 7. Mean Reversion — buy sharp dips for bounce plays
 * 8. Breakout Detection — enter range breakouts with volume
 * 9. Arbitrage Scanner — detect price gaps between Bybit and KuCoin
 * 10. Adaptive Grid — recalculate grid params based on real-time volatility
 * 11. Compound Interest — auto-reinvest daily gains
 * 12. Capital Distribution — allocate more to winning strategies
 * 13. Kelly Criterion — optimal position sizing
 * 14. Market Session Detection — adjust aggressiveness by session
 * 15. Intraday Momentum — boost during high-movement hours
 * 16. Max Drawdown Protection — reduce exposure on losing days
 * 17. Forced Diversification — cap per-symbol exposure
 * 18. Anti-Manipulation — detect fake wicks
 * 19. Grid Dynamic Adaptation — recalculate grid every cycle
 */

import { calculateATRPercent, calculateSignalScore, type FullKlineData } from "./smartAnalysis";

// ═══════════════════════════════════════════════════════════════
// 1. MULTI-TIMEFRAME ANALYSIS (MTA)
// ═══════════════════════════════════════════════════════════════

export interface MTAResult {
  direction: "buy" | "sell" | "neutral";
  confidence: number;
  alignment: "strong" | "partial" | "conflicting";
  timeframes: {
    tf5m: { direction: string; confidence: number };
    tf15m: { direction: string; confidence: number };
    tf1h: { direction: string; confidence: number };
  };
  boost: number; // Multiplier for position sizing (1.0 - 2.0)
}

export function multiTimeframeAnalysis(
  klines5m: FullKlineData,
  klines15m: FullKlineData,
  klines1h: FullKlineData,
  currentPrice: number
): MTAResult {
  const score5m = calculateSignalScore(klines5m, currentPrice);
  const score15m = calculateSignalScore(klines15m, currentPrice);
  const score1h = calculateSignalScore(klines1h, currentPrice);

  const directions = [score5m.direction, score15m.direction, score1h.direction];
  const buyCount = directions.filter(d => d === "buy").length;
  const sellCount = directions.filter(d => d === "sell").length;

  let direction: "buy" | "sell" | "neutral" = "neutral";
  let alignment: "strong" | "partial" | "conflicting" = "conflicting";
  let boost = 1.0;

  if (buyCount === 3) {
    direction = "buy";
    alignment = "strong";
    boost = 1.8; // All 3 timeframes agree — very strong
  } else if (sellCount === 3) {
    direction = "sell";
    alignment = "strong";
    boost = 1.8;
  } else if (buyCount === 2) {
    direction = "buy";
    alignment = "partial";
    boost = 1.3;
  } else if (sellCount === 2) {
    direction = "sell";
    alignment = "partial";
    boost = 1.3;
  } else {
    alignment = "conflicting";
    boost = 0.5; // Conflicting signals — reduce size
  }

  // Weight: 1h > 15m > 5m (higher timeframe = more reliable)
  const weightedConfidence = Math.round(
    score5m.confidence * 0.2 +
    score15m.confidence * 0.35 +
    score1h.confidence * 0.45
  );

  return {
    direction,
    confidence: Math.min(95, weightedConfidence),
    alignment,
    timeframes: {
      tf5m: { direction: score5m.direction, confidence: score5m.confidence },
      tf15m: { direction: score15m.direction, confidence: score15m.confidence },
      tf1h: { direction: score1h.direction, confidence: score1h.confidence },
    },
    boost,
  };
}

// ═══════════════════════════════════════════════════════════════
// 2. BTC CORRELATION TRACKER
// ═══════════════════════════════════════════════════════════════

interface BTCState {
  lastPrice: number;
  prices: number[];
  trend: "up" | "down" | "sideways";
  momentum: number; // -100 to +100
  lastUpdate: number;
}

const btcState: BTCState = {
  lastPrice: 0,
  prices: [],
  trend: "sideways",
  momentum: 0,
  lastUpdate: 0,
};

export function updateBTCState(price: number): void {
  btcState.lastPrice = price;
  btcState.prices.push(price);
  if (btcState.prices.length > 200) btcState.prices.shift();
  btcState.lastUpdate = Date.now();

  if (btcState.prices.length >= 10) {
    const recent = btcState.prices.slice(-10);
    const oldest = recent[0];
    const newest = recent[recent.length - 1];
    const changePct = ((newest - oldest) / oldest) * 100;

    btcState.momentum = Math.max(-100, Math.min(100, changePct * 20));

    if (changePct > 0.3) btcState.trend = "up";
    else if (changePct < -0.3) btcState.trend = "down";
    else btcState.trend = "sideways";
  }
}

export function getBTCCorrelationFilter(symbol: string): { allowed: boolean; reason: string; boost: number } {
  // BTC itself is always allowed
  if (symbol.startsWith("BTC")) return { allowed: true, reason: "BTC — no correlation filter", boost: 1.0 };

  // Stale data — allow everything
  if (Date.now() - btcState.lastUpdate > 120_000) return { allowed: true, reason: "BTC data stale", boost: 1.0 };

  if (btcState.trend === "down" && btcState.momentum < -30) {
    return { allowed: false, reason: `BTC cayendo fuerte (momentum ${btcState.momentum.toFixed(0)}) — NO comprar alts`, boost: 0 };
  }

  if (btcState.trend === "down" && btcState.momentum < -10) {
    return { allowed: true, reason: `BTC bajando — reducir tamaño alts`, boost: 0.6 };
  }

  if (btcState.trend === "up" && btcState.momentum > 30) {
    return { allowed: true, reason: `BTC subiendo fuerte — boost alts`, boost: 1.5 };
  }

  if (btcState.trend === "up" && btcState.momentum > 10) {
    return { allowed: true, reason: `BTC alcista — normal`, boost: 1.2 };
  }

  return { allowed: true, reason: "BTC neutral", boost: 1.0 };
}

export function getBTCState(): BTCState {
  return { ...btcState };
}

// ═══════════════════════════════════════════════════════════════
// 3. VOLUME SPIKE DETECTION
// ═══════════════════════════════════════════════════════════════

export interface VolumeSpikeResult {
  isSpike: boolean;
  multiplier: number; // How many times above average
  direction: "buy" | "sell" | "neutral";
  boost: number;
}

export function detectVolumeSpike(klines: FullKlineData, currentPrice: number): VolumeSpikeResult {
  const { volumes, closes } = klines;
  if (volumes.length < 20) return { isSpike: false, multiplier: 1, direction: "neutral", boost: 1.0 };

  const recentVol = volumes[volumes.length - 1];
  const avgVol = volumes.slice(-20, -1).reduce((a, b) => a + b, 0) / 19;
  const multiplier = avgVol > 0 ? recentVol / avgVol : 1;

  if (multiplier < 2.0) return { isSpike: false, multiplier, direction: "neutral", boost: 1.0 };

  // Determine direction: was the spike candle bullish or bearish?
  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const direction: "buy" | "sell" | "neutral" = lastClose > prevClose ? "buy" : lastClose < prevClose ? "sell" : "neutral";

  // Higher spike = higher boost
  const boost = Math.min(2.0, 1.0 + (multiplier - 2) * 0.3);

  return { isSpike: true, multiplier, direction, boost };
}

// ═══════════════════════════════════════════════════════════════
// 4. ORDER BOOK IMBALANCE (via Bybit API)
// ═══════════════════════════════════════════════════════════════

export interface OrderBookImbalance {
  ratio: number; // bids/asks ratio (>1 = more buyers)
  direction: "buy" | "sell" | "neutral";
  strength: number; // 0-100
}

export async function getOrderBookImbalance(client: any, symbol: string, category: string = "linear"): Promise<OrderBookImbalance> {
  try {
    const result = await client.getOrderbook({ category, symbol, limit: 25 });
    if (result?.retCode !== 0 || !result?.result) {
      return { ratio: 1, direction: "neutral", strength: 0 };
    }

    const bids = result.result.b ?? [];
    const asks = result.result.a ?? [];

    let totalBidVol = 0;
    let totalAskVol = 0;

    for (const [, qty] of bids) totalBidVol += parseFloat(qty);
    for (const [, qty] of asks) totalAskVol += parseFloat(qty);

    if (totalAskVol === 0) return { ratio: 10, direction: "buy", strength: 90 };
    if (totalBidVol === 0) return { ratio: 0.1, direction: "sell", strength: 90 };

    const ratio = totalBidVol / totalAskVol;
    let direction: "buy" | "sell" | "neutral" = "neutral";
    let strength = 0;

    if (ratio > 1.5) {
      direction = "buy";
      strength = Math.min(90, Math.round((ratio - 1) * 40));
    } else if (ratio < 0.67) {
      direction = "sell";
      strength = Math.min(90, Math.round((1 / ratio - 1) * 40));
    }

    return { ratio, direction, strength };
  } catch {
    return { ratio: 1, direction: "neutral", strength: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. FUNDING RATE (for Futures timing)
// ═══════════════════════════════════════════════════════════════

export interface FundingRateSignal {
  rate: number;
  direction: "long" | "short" | "neutral";
  strength: number; // 0-100
  reason: string;
}

export async function getFundingRateSignal(client: any, symbol: string): Promise<FundingRateSignal> {
  try {
    const result = await client.getTickers({ category: "linear", symbol });
    const ticker = result?.result?.list?.[0];
    if (!ticker) return { rate: 0, direction: "neutral", strength: 0, reason: "No data" };

    const fundingRate = parseFloat(ticker.fundingRate ?? "0");

    // Very negative funding = shorts paying longs = price likely to rise
    if (fundingRate < -0.001) {
      return {
        rate: fundingRate,
        direction: "long",
        strength: Math.min(80, Math.round(Math.abs(fundingRate) * 10000)),
        reason: `Funding muy negativo (${(fundingRate * 100).toFixed(4)}%) — shorts pagando, precio sube`,
      };
    }

    // Very positive funding = longs paying shorts = price likely to drop
    if (fundingRate > 0.001) {
      return {
        rate: fundingRate,
        direction: "short",
        strength: Math.min(80, Math.round(fundingRate * 10000)),
        reason: `Funding muy positivo (${(fundingRate * 100).toFixed(4)}%) — longs pagando, precio baja`,
      };
    }

    return { rate: fundingRate, direction: "neutral", strength: 0, reason: "Funding neutral" };
  } catch {
    return { rate: 0, direction: "neutral", strength: 0, reason: "Error fetching funding" };
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. LIQUIDATION / SQUEEZE DETECTION
// ═══════════════════════════════════════════════════════════════

export interface SqueezeDetection {
  detected: boolean;
  type: "short_squeeze" | "long_squeeze" | "none";
  strength: number;
  reason: string;
}

export function detectSqueeze(klines: FullKlineData, currentPrice: number): SqueezeDetection {
  const { closes, volumes, highs, lows } = klines;
  if (closes.length < 10) return { detected: false, type: "none", strength: 0, reason: "" };

  // Detect rapid price move + volume spike = likely liquidation cascade
  const last5Closes = closes.slice(-5);
  const last5Vols = volumes.slice(-5);
  const avgVol = volumes.slice(-20, -5).reduce((a, b) => a + b, 0) / 15;
  const recentAvgVol = last5Vols.reduce((a, b) => a + b, 0) / 5;
  const volMultiplier = avgVol > 0 ? recentAvgVol / avgVol : 1;

  const priceChange = ((last5Closes[last5Closes.length - 1] - last5Closes[0]) / last5Closes[0]) * 100;

  // Short squeeze: rapid price UP + high volume
  if (priceChange > 2 && volMultiplier > 2) {
    return {
      detected: true,
      type: "short_squeeze",
      strength: Math.min(90, Math.round(priceChange * volMultiplier * 5)),
      reason: `Short squeeze detectado: +${priceChange.toFixed(1)}% con ${volMultiplier.toFixed(1)}x volumen`,
    };
  }

  // Long squeeze: rapid price DOWN + high volume
  if (priceChange < -2 && volMultiplier > 2) {
    return {
      detected: true,
      type: "long_squeeze",
      strength: Math.min(90, Math.round(Math.abs(priceChange) * volMultiplier * 5)),
      reason: `Long squeeze detectado: ${priceChange.toFixed(1)}% con ${volMultiplier.toFixed(1)}x volumen`,
    };
  }

  // Check for wick-based squeeze (long lower wick = shorts liquidated)
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const lastClose = closes[closes.length - 1];
  const lastOpen = klines.opens[klines.opens.length - 1];
  const body = Math.abs(lastClose - lastOpen);
  const totalRange = lastHigh - lastLow;

  if (totalRange > 0) {
    const lowerWick = Math.min(lastClose, lastOpen) - lastLow;
    const upperWick = lastHigh - Math.max(lastClose, lastOpen);

    // Long lower wick with bullish close = short squeeze
    if (lowerWick > body * 2 && lastClose > lastOpen && volMultiplier > 1.5) {
      return {
        detected: true,
        type: "short_squeeze",
        strength: Math.min(70, Math.round(lowerWick / totalRange * 100)),
        reason: `Wick squeeze alcista: mecha inferior ${(lowerWick / totalRange * 100).toFixed(0)}% del rango`,
      };
    }

    // Long upper wick with bearish close = long squeeze
    if (upperWick > body * 2 && lastClose < lastOpen && volMultiplier > 1.5) {
      return {
        detected: true,
        type: "long_squeeze",
        strength: Math.min(70, Math.round(upperWick / totalRange * 100)),
        reason: `Wick squeeze bajista: mecha superior ${(upperWick / totalRange * 100).toFixed(0)}% del rango`,
      };
    }
  }

  return { detected: false, type: "none", strength: 0, reason: "" };
}

// ═══════════════════════════════════════════════════════════════
// 7. MEAN REVERSION STRATEGY
// ═══════════════════════════════════════════════════════════════

export interface MeanReversionSignal {
  active: boolean;
  direction: "buy" | "sell";
  deviation: number; // % from mean
  expectedBounce: number; // Expected % recovery
  confidence: number;
}

export function detectMeanReversion(klines: FullKlineData, currentPrice: number): MeanReversionSignal | null {
  const { closes, volumes } = klines;
  if (closes.length < 30) return null;

  // Calculate 20-period SMA as "mean"
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const deviation = ((currentPrice - sma20) / sma20) * 100;

  // Check for rapid drop (last 5 candles)
  const recent = closes.slice(-5);
  const rapidChange = ((recent[recent.length - 1] - recent[0]) / recent[0]) * 100;

  // Mean reversion BUY: price dropped 3%+ below SMA rapidly
  if (deviation < -2 && rapidChange < -2) {
    const expectedBounce = Math.min(Math.abs(deviation) * 0.6, 5); // Expect 60% recovery
    const confidence = Math.min(85, Math.round(Math.abs(deviation) * 15 + Math.abs(rapidChange) * 5));
    return {
      active: true,
      direction: "buy",
      deviation,
      expectedBounce,
      confidence,
    };
  }

  // Mean reversion SELL: price spiked 3%+ above SMA rapidly
  if (deviation > 2 && rapidChange > 2) {
    const expectedBounce = Math.min(deviation * 0.6, 5);
    const confidence = Math.min(85, Math.round(deviation * 15 + rapidChange * 5));
    return {
      active: true,
      direction: "sell",
      deviation,
      expectedBounce,
      confidence,
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// 8. BREAKOUT DETECTION
// ═══════════════════════════════════════════════════════════════

export interface BreakoutSignal {
  active: boolean;
  direction: "buy" | "sell";
  rangeHigh: number;
  rangeLow: number;
  breakoutPrice: number;
  volumeConfirmation: boolean;
  confidence: number;
}

export function detectBreakout(klines: FullKlineData, currentPrice: number): BreakoutSignal | null {
  const { closes, highs, lows, volumes } = klines;
  if (closes.length < 30) return null;

  // Find consolidation range (last 20 candles excluding last 3)
  const rangeCandles = 20;
  const lookback = closes.slice(-rangeCandles - 3, -3);
  const rangeHighs = highs.slice(-rangeCandles - 3, -3);
  const rangeLows = lows.slice(-rangeCandles - 3, -3);

  if (lookback.length < rangeCandles) return null;

  const rangeHigh = Math.max(...rangeHighs);
  const rangeLow = Math.min(...rangeLows);
  const rangeWidth = ((rangeHigh - rangeLow) / rangeLow) * 100;

  // Only detect breakouts from tight ranges (< 4% width)
  if (rangeWidth > 4 || rangeWidth < 0.5) return null;

  // Volume confirmation
  const recentVol = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const avgVol = volumes.slice(-rangeCandles - 3, -3).reduce((a, b) => a + b, 0) / rangeCandles;
  const volumeConfirmation = recentVol > avgVol * 1.5;

  // Bullish breakout
  if (currentPrice > rangeHigh * 1.001) {
    const confidence = Math.min(85, Math.round(40 + (volumeConfirmation ? 25 : 0) + (rangeWidth < 2 ? 15 : 5)));
    return {
      active: true,
      direction: "buy",
      rangeHigh,
      rangeLow,
      breakoutPrice: currentPrice,
      volumeConfirmation,
      confidence,
    };
  }

  // Bearish breakout
  if (currentPrice < rangeLow * 0.999) {
    const confidence = Math.min(85, Math.round(40 + (volumeConfirmation ? 25 : 0) + (rangeWidth < 2 ? 15 : 5)));
    return {
      active: true,
      direction: "sell",
      rangeHigh,
      rangeLow,
      breakoutPrice: currentPrice,
      volumeConfirmation,
      confidence,
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// 9. ARBITRAGE SCANNER (Bybit vs KuCoin)
// ═══════════════════════════════════════════════════════════════

export interface ArbitrageOpportunity {
  symbol: string;
  bybitPrice: number;
  kucoinPrice: number;
  spreadPct: number;
  direction: "buy_bybit_sell_kucoin" | "buy_kucoin_sell_bybit";
  profitable: boolean; // After fees
}

const arbPrices: Map<string, { bybit: number; kucoin: number; ts: number }> = new Map();

export function updateArbPrice(symbol: string, exchange: "bybit" | "kucoin", price: number): void {
  const existing = arbPrices.get(symbol) ?? { bybit: 0, kucoin: 0, ts: 0 };
  existing[exchange] = price;
  existing.ts = Date.now();
  arbPrices.set(symbol, existing);
}

export function scanArbitrage(minSpreadPct: number = 0.3): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];
  const totalFees = 0.002; // ~0.1% per side x2

  for (const [symbol, prices] of Array.from(arbPrices.entries())) {
    if (Date.now() - prices.ts > 60_000) continue; // Stale
    if (prices.bybit <= 0 || prices.kucoin <= 0) continue;

    const spreadPct = ((prices.kucoin - prices.bybit) / prices.bybit) * 100;

    if (Math.abs(spreadPct) > minSpreadPct + totalFees * 100) {
      opportunities.push({
        symbol,
        bybitPrice: prices.bybit,
        kucoinPrice: prices.kucoin,
        spreadPct,
        direction: spreadPct > 0 ? "buy_bybit_sell_kucoin" : "buy_kucoin_sell_bybit",
        profitable: Math.abs(spreadPct) > totalFees * 100,
      });
    }
  }

  return opportunities.sort((a, b) => Math.abs(b.spreadPct) - Math.abs(a.spreadPct));
}

// ═══════════════════════════════════════════════════════════════
// 10. ADAPTIVE GRID PARAMETERS
// ═══════════════════════════════════════════════════════════════

export interface AdaptiveGridParams {
  spread: number;
  levels: number;
  trailingPct: number;
  maxHoldHours: number;
}

export function calculateAdaptiveGrid(klines: FullKlineData, currentPrice: number): AdaptiveGridParams {
  const atrPct = calculateATRPercent(klines.highs, klines.lows, klines.closes);

  // Spread scales with volatility
  const spread = Math.max(0.003, Math.min(0.025, atrPct / 100 * 1.2));

  // More levels in low volatility (tighter grid), fewer in high volatility
  const levels = atrPct < 1 ? 12 : atrPct < 2 ? 10 : atrPct < 3 ? 8 : 6;

  // Trailing stop scales with ATR
  const trailingPct = Math.max(0.3, Math.min(2.0, atrPct * 1.2));

  // Hold time: shorter in high volatility (faster rotation)
  const maxHoldHours = atrPct < 1 ? 6 : atrPct < 2 ? 4 : atrPct < 3 ? 3 : 2;

  return { spread, levels, trailingPct, maxHoldHours };
}

// ═══════════════════════════════════════════════════════════════
// 11. COMPOUND INTEREST TRACKER
// ═══════════════════════════════════════════════════════════════

let compoundState = {
  startOfDayBalance: 0,
  currentBalance: 0,
  dailyGainPct: 0,
  compoundedDays: 0,
};

export function updateCompoundState(balance: number, initialBalance: number): void {
  compoundState.currentBalance = balance;
  if (compoundState.startOfDayBalance === 0) {
    compoundState.startOfDayBalance = balance;
  }
  compoundState.dailyGainPct = compoundState.startOfDayBalance > 0
    ? ((balance - compoundState.startOfDayBalance) / compoundState.startOfDayBalance) * 100
    : 0;
}

export function resetDailyCompound(newDayBalance: number): void {
  compoundState.startOfDayBalance = newDayBalance;
  compoundState.compoundedDays++;
}

export function getCompoundState() {
  return { ...compoundState };
}

// ═══════════════════════════════════════════════════════════════
// 12. CAPITAL DISTRIBUTION (allocate more to winners)
// ═══════════════════════════════════════════════════════════════

interface StrategyPerformance {
  strategy: string;
  totalPnl: number;
  trades: number;
  winRate: number;
}

const strategyPerf: Map<string, StrategyPerformance> = new Map();

export function recordStrategyPerformance(strategy: string, pnl: number, isWin: boolean): void {
  const perf = strategyPerf.get(strategy) ?? { strategy, totalPnl: 0, trades: 0, winRate: 0.5 };
  perf.totalPnl += pnl;
  perf.trades++;
  // Rolling win rate
  perf.winRate = perf.winRate * 0.95 + (isWin ? 0.05 : 0);
  strategyPerf.set(strategy, perf);
}

export function getCapitalAllocation(): { grid: number; scalping: number; futures: number } {
  const gridPerf = strategyPerf.get("grid");
  const scalpPerf = strategyPerf.get("scalping");
  const futPerf = strategyPerf.get("futures");

  // Default equal allocation if no data
  if (!gridPerf && !scalpPerf && !futPerf) {
    return { grid: 0.4, scalping: 0.3, futures: 0.3 };
  }

  // Score each strategy: PnL + win rate
  const gridScore = (gridPerf?.totalPnl ?? 0) * (gridPerf?.winRate ?? 0.5);
  const scalpScore = (scalpPerf?.totalPnl ?? 0) * (scalpPerf?.winRate ?? 0.5);
  const futScore = (futPerf?.totalPnl ?? 0) * (futPerf?.winRate ?? 0.5);

  // Ensure minimum allocation (20% each)
  const total = Math.max(1, Math.abs(gridScore) + Math.abs(scalpScore) + Math.abs(futScore));
  const rawGrid = Math.max(0.2, (gridScore > 0 ? gridScore : 0.1) / total);
  const rawScalp = Math.max(0.2, (scalpScore > 0 ? scalpScore : 0.1) / total);
  const rawFut = Math.max(0.2, (futScore > 0 ? futScore : 0.1) / total);

  // Normalize to 1.0
  const sum = rawGrid + rawScalp + rawFut;
  return {
    grid: rawGrid / sum,
    scalping: rawScalp / sum,
    futures: rawFut / sum,
  };
}

// ═══════════════════════════════════════════════════════════════
// 13. KELLY CRITERION
// ═══════════════════════════════════════════════════════════════

export function kellyOptimalSize(winRate: number, avgWin: number, avgLoss: number): number {
  // Kelly formula: f* = (bp - q) / b
  // where b = avgWin/avgLoss, p = winRate, q = 1-winRate
  if (avgLoss === 0 || winRate <= 0) return 0.1; // Minimum

  const b = avgWin / avgLoss;
  const p = winRate;
  const q = 1 - p;
  const kelly = (b * p - q) / b;

  // Use half-Kelly for safety (common practice)
  const halfKelly = kelly / 2;

  // Clamp between 5% and 30% of capital per trade
  return Math.max(0.05, Math.min(0.30, halfKelly));
}

// ═══════════════════════════════════════════════════════════════
// 14. MARKET SESSION DETECTION
// ═══════════════════════════════════════════════════════════════

export type MarketSession = "asia" | "europe" | "usa" | "overlap_eu_us" | "quiet";

export function getCurrentSession(): { session: MarketSession; aggressiveness: number; reason: string } {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // Asia: 00:00-08:00 UTC (Tokyo/Shanghai)
  if (utcHour >= 0 && utcHour < 8) {
    return { session: "asia", aggressiveness: 0.9, reason: "Sesión Asia — volatilidad moderada en alts" };
  }

  // Europe: 08:00-13:00 UTC (London)
  if (utcHour >= 8 && utcHour < 13) {
    return { session: "europe", aggressiveness: 1.1, reason: "Sesión Europa — movimientos medianos" };
  }

  // EU-US Overlap: 13:00-17:00 UTC (HIGHEST VOLUME)
  if (utcHour >= 13 && utcHour < 17) {
    return { session: "overlap_eu_us", aggressiveness: 1.5, reason: "Overlap EU/US — MÁXIMO volumen, ser agresivo" };
  }

  // USA: 17:00-22:00 UTC
  if (utcHour >= 17 && utcHour < 22) {
    return { session: "usa", aggressiveness: 1.3, reason: "Sesión USA — movimientos grandes" };
  }

  // Quiet: 22:00-00:00 UTC
  return { session: "quiet", aggressiveness: 0.7, reason: "Horario tranquilo — reducir exposición" };
}

// ═══════════════════════════════════════════════════════════════
// 15. INTRADAY MOMENTUM
// ═══════════════════════════════════════════════════════════════

export function getIntradayMomentumBoost(): number {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // Peak hours: 13:30-16:30 UTC (US market open + EU overlap)
  if (utcHour >= 13 && utcHour <= 16) return 1.4;

  // Secondary peak: 08:00-10:00 UTC (EU open)
  if (utcHour >= 8 && utcHour <= 10) return 1.2;

  // Asia peak: 01:00-03:00 UTC
  if (utcHour >= 1 && utcHour <= 3) return 1.1;

  // Quiet hours
  if (utcHour >= 22 || utcHour === 0) return 0.7;

  return 1.0;
}

// ═══════════════════════════════════════════════════════════════
// 16. MAX DRAWDOWN PROTECTION
// ═══════════════════════════════════════════════════════════════

interface DrawdownState {
  peakBalance: number;
  currentDrawdown: number;
  dailyLoss: number;
  mode: "normal" | "reduced" | "paused";
}

const drawdownState: DrawdownState = {
  peakBalance: 0,
  currentDrawdown: 0,
  dailyLoss: 0,
  mode: "normal",
};

export function updateDrawdownState(currentBalance: number, todayPnl: number): DrawdownState {
  if (currentBalance > drawdownState.peakBalance) {
    drawdownState.peakBalance = currentBalance;
  }

  drawdownState.currentDrawdown = drawdownState.peakBalance > 0
    ? ((drawdownState.peakBalance - currentBalance) / drawdownState.peakBalance) * 100
    : 0;

  const capital = drawdownState.peakBalance > 0 ? drawdownState.peakBalance : currentBalance;
  drawdownState.dailyLoss = capital > 0 ? (Math.min(0, todayPnl) / capital) * 100 : 0;

  // Mode determination
  if (drawdownState.dailyLoss < -2) {
    drawdownState.mode = "paused"; // Lost >2% today — pause 1 hour
  } else if (drawdownState.dailyLoss < -1) {
    drawdownState.mode = "reduced"; // Lost >1% today — half size
  } else {
    drawdownState.mode = "normal";
  }

  return { ...drawdownState };
}

export function getDrawdownMultiplier(): { multiplier: number; mode: string; reason: string } {
  if (drawdownState.mode === "paused") {
    return { multiplier: 0, mode: "paused", reason: `Drawdown >2% hoy (${drawdownState.dailyLoss.toFixed(1)}%) — PAUSADO` };
  }
  if (drawdownState.mode === "reduced") {
    return { multiplier: 0.5, mode: "reduced", reason: `Drawdown >1% hoy (${drawdownState.dailyLoss.toFixed(1)}%) — tamaño reducido 50%` };
  }
  return { multiplier: 1.0, mode: "normal", reason: "Sin drawdown significativo" };
}

export function resetDailyDrawdown(balance: number): void {
  drawdownState.peakBalance = Math.max(drawdownState.peakBalance, balance);
  drawdownState.dailyLoss = 0;
  drawdownState.mode = "normal";
}

// ═══════════════════════════════════════════════════════════════
// 17. FORCED DIVERSIFICATION
// ═══════════════════════════════════════════════════════════════

const symbolExposure: Map<string, number> = new Map();

export function updateSymbolExposure(symbol: string, amount: number): void {
  symbolExposure.set(symbol, (symbolExposure.get(symbol) ?? 0) + amount);
}

export function clearSymbolExposure(symbol: string, amount: number): void {
  const current = symbolExposure.get(symbol) ?? 0;
  symbolExposure.set(symbol, Math.max(0, current - amount));
}

export function checkDiversification(symbol: string, proposedAmount: number, totalCapital: number): { allowed: boolean; maxAmount: number; reason: string } {
  const maxPctPerSymbol = 0.20; // 20% max per symbol
  const currentExposure = symbolExposure.get(symbol) ?? 0;
  const maxAllowed = totalCapital * maxPctPerSymbol;
  const remaining = maxAllowed - currentExposure;

  if (remaining <= 0) {
    return {
      allowed: false,
      maxAmount: 0,
      reason: `${symbol} ya tiene ${((currentExposure / totalCapital) * 100).toFixed(1)}% del capital (máx 20%)`,
    };
  }

  if (proposedAmount > remaining) {
    return {
      allowed: true,
      maxAmount: remaining,
      reason: `${symbol} limitado a $${remaining.toFixed(2)} más (20% cap)`,
    };
  }

  return { allowed: true, maxAmount: proposedAmount, reason: "OK" };
}

// ═══════════════════════════════════════════════════════════════
// 18. ANTI-MANIPULATION (Fake Wick Detection)
// ═══════════════════════════════════════════════════════════════

export interface ManipulationCheck {
  isFakeWick: boolean;
  wickType: "lower" | "upper" | "none";
  wickPct: number;
  reason: string;
}

export function detectManipulation(klines: FullKlineData): ManipulationCheck {
  const { opens, highs, lows, closes, volumes } = klines;
  if (closes.length < 5) return { isFakeWick: false, wickType: "none", wickPct: 0, reason: "" };

  const i = closes.length - 1;
  const open = opens[i];
  const high = highs[i];
  const low = lows[i];
  const close = closes[i];
  const body = Math.abs(close - open);
  const totalRange = high - low;

  if (totalRange === 0) return { isFakeWick: false, wickType: "none", wickPct: 0, reason: "" };

  const lowerWick = Math.min(open, close) - low;
  const upperWick = high - Math.max(open, close);

  // Fake lower wick: very long lower wick (>70% of range) with tiny body
  if (lowerWick > totalRange * 0.7 && body < totalRange * 0.15) {
    const wickPct = (lowerWick / totalRange) * 100;
    return {
      isFakeWick: true,
      wickType: "lower",
      wickPct,
      reason: `Wick falso inferior (${wickPct.toFixed(0)}% del rango) — posible manipulación de ballena`,
    };
  }

  // Fake upper wick: very long upper wick (>70% of range) with tiny body
  if (upperWick > totalRange * 0.7 && body < totalRange * 0.15) {
    const wickPct = (upperWick / totalRange) * 100;
    return {
      isFakeWick: true,
      wickType: "upper",
      wickPct,
      reason: `Wick falso superior (${wickPct.toFixed(0)}% del rango) — posible manipulación de ballena`,
    };
  }

  return { isFakeWick: false, wickType: "none", wickPct: 0, reason: "" };
}

// ═══════════════════════════════════════════════════════════════
// MASTER INTELLIGENCE AGGREGATOR
// Combines ALL signals into a single decision
// ═══════════════════════════════════════════════════════════════

export interface MasterSignal {
  direction: "buy" | "sell" | "neutral";
  confidence: number; // 0-100
  sizingMultiplier: number; // Final position size multiplier
  reasons: string[];
  blocked: boolean;
  blockReason: string;
  // Component signals
  mta?: MTAResult;
  btcFilter?: { allowed: boolean; reason: string; boost: number };
  volumeSpike?: VolumeSpikeResult;
  orderBook?: OrderBookImbalance;
  fundingRate?: FundingRateSignal;
  squeeze?: SqueezeDetection;
  meanReversion?: MeanReversionSignal | null;
  breakout?: BreakoutSignal | null;
  manipulation?: ManipulationCheck;
  session?: { session: MarketSession; aggressiveness: number };
  drawdown?: { multiplier: number; mode: string };
  diversification?: { allowed: boolean; maxAmount: number };
}

export function aggregateMasterSignal(params: {
  symbol: string;
  currentPrice: number;
  klines5m?: FullKlineData;
  klines15m: FullKlineData;
  klines1h?: FullKlineData;
  orderBookImbalance?: OrderBookImbalance;
  fundingRate?: FundingRateSignal;
  totalCapital: number;
  proposedAmount: number;
  todayPnl: number;
  currentBalance: number;
  strategy: "grid" | "scalping" | "futures";
}): MasterSignal {
  const reasons: string[] = [];
  let buyScore = 0;
  let sellScore = 0;
  let sizingMultiplier = 1.0;
  let blocked = false;
  let blockReason = "";

  // ─── 1. Multi-Timeframe Analysis ───
  let mta: MTAResult | undefined;
  if (params.klines5m && params.klines1h) {
    mta = multiTimeframeAnalysis(params.klines5m, params.klines15m, params.klines1h, params.currentPrice);
    if (mta.alignment === "strong") {
      if (mta.direction === "buy") { buyScore += 25; reasons.push(`MTA FUERTE: 3 timeframes alcistas (conf=${mta.confidence})`); }
      else if (mta.direction === "sell") { sellScore += 25; reasons.push(`MTA FUERTE: 3 timeframes bajistas (conf=${mta.confidence})`); }
      sizingMultiplier *= mta.boost;
    } else if (mta.alignment === "partial") {
      if (mta.direction === "buy") { buyScore += 12; reasons.push(`MTA parcial: 2/3 timeframes alcistas`); }
      else if (mta.direction === "sell") { sellScore += 12; reasons.push(`MTA parcial: 2/3 timeframes bajistas`); }
      sizingMultiplier *= mta.boost;
    } else {
      reasons.push("MTA conflictivo — timeframes en desacuerdo");
      sizingMultiplier *= 0.8; // v11.3: reduced penalty (was 0.5x) — still trade on conflicting signals
    }
  } else {
    // Fallback: single timeframe
    const score = calculateSignalScore(params.klines15m, params.currentPrice);
    if (score.direction === "buy") buyScore += 15;
    else if (score.direction === "sell") sellScore += 15;
  }

  // ─── 2. BTC Correlation ───
  // v11.3: BTC correlation filter DISABLED — never block trades based on BTC movement
  const btcFilter = getBTCCorrelationFilter(params.symbol);
  sizingMultiplier *= Math.max(0.7, btcFilter.boost); // min 0.7x, never block
  if (btcFilter.boost !== 1.0) reasons.push(btcFilter.reason);

  // ─── 3. Volume Spike ───
  const volumeSpike = detectVolumeSpike(params.klines15m, params.currentPrice);
  if (volumeSpike.isSpike) {
    if (volumeSpike.direction === "buy") { buyScore += 10; reasons.push(`Spike de volumen ${volumeSpike.multiplier.toFixed(1)}x — alcista`); }
    else if (volumeSpike.direction === "sell") { sellScore += 10; reasons.push(`Spike de volumen ${volumeSpike.multiplier.toFixed(1)}x — bajista`); }
    sizingMultiplier *= volumeSpike.boost;
  }

  // ─── 4. Order Book ───
  if (params.orderBookImbalance && params.orderBookImbalance.strength > 20) {
    if (params.orderBookImbalance.direction === "buy") { buyScore += 8; reasons.push(`Order book: ${params.orderBookImbalance.ratio.toFixed(1)}x más compradores`); }
    else if (params.orderBookImbalance.direction === "sell") { sellScore += 8; reasons.push(`Order book: ${(1/params.orderBookImbalance.ratio).toFixed(1)}x más vendedores`); }
  }

  // ─── 5. Funding Rate (futures only) ───
  if (params.fundingRate && params.strategy === "futures" && params.fundingRate.strength > 20) {
    if (params.fundingRate.direction === "long") { buyScore += 10; reasons.push(params.fundingRate.reason); }
    else if (params.fundingRate.direction === "short") { sellScore += 10; reasons.push(params.fundingRate.reason); }
  }

  // ─── 6. Squeeze Detection ───
  const squeeze = detectSqueeze(params.klines15m, params.currentPrice);
  if (squeeze.detected) {
    if (squeeze.type === "short_squeeze") { buyScore += 15; reasons.push(squeeze.reason); sizingMultiplier *= 1.5; }
    else if (squeeze.type === "long_squeeze") { sellScore += 15; reasons.push(squeeze.reason); sizingMultiplier *= 1.5; }
  }

  // ─── 7. Mean Reversion ───
  const meanRev = detectMeanReversion(params.klines15m, params.currentPrice);
  if (meanRev) {
    if (meanRev.direction === "buy") { buyScore += 12; reasons.push(`Mean reversion: ${meanRev.deviation.toFixed(1)}% bajo media, rebote esperado ${meanRev.expectedBounce.toFixed(1)}%`); }
    else if (meanRev.direction === "sell") { sellScore += 12; reasons.push(`Mean reversion: ${meanRev.deviation.toFixed(1)}% sobre media`); }
  }

  // ─── 8. Breakout ───
  const breakout = detectBreakout(params.klines15m, params.currentPrice);
  if (breakout) {
    if (breakout.direction === "buy") { buyScore += 15; reasons.push(`Breakout alcista ${breakout.volumeConfirmation ? "con volumen" : "sin volumen"}`); }
    else if (breakout.direction === "sell") { sellScore += 15; reasons.push(`Breakout bajista ${breakout.volumeConfirmation ? "con volumen" : "sin volumen"}`); }
    if (breakout.volumeConfirmation) sizingMultiplier *= 1.3;
  }

  // ─── 14. Session ───
  const session = getCurrentSession();
  sizingMultiplier *= session.aggressiveness;
  reasons.push(session.reason);

  // ─── 15. Intraday Momentum ───
  const intradayBoost = getIntradayMomentumBoost();
  sizingMultiplier *= intradayBoost;

  // ─── 16. Drawdown Protection ───
  // v11.4: Drawdown protection restored — reduce size when losing but never fully stop (emergency stop handles that)
  const drawdown = updateDrawdownState(params.currentBalance, params.todayPnl);
  const ddMultiplier = getDrawdownMultiplier();
  // Never fully block (multiplier 0), minimum 0.5x sizing
  sizingMultiplier *= Math.max(0.5, ddMultiplier.multiplier);
  if (ddMultiplier.mode !== "normal") reasons.push(ddMultiplier.reason);

  // ─── 17. Diversification ───
  // v11.4: Diversification restored — reduce size on over-concentration but don't block
  const diversification = checkDiversification(params.symbol, params.proposedAmount, params.totalCapital);
  if (!diversification.allowed) {
    sizingMultiplier *= 0.6; // Reduce size instead of blocking
    reasons.push(`Diversification: ${diversification.reason} (size reduced)`);
  }

  // ─── 18. Anti-Manipulation ───
  const manipulation = detectManipulation(params.klines15m);
  if (manipulation.isFakeWick) {
    reasons.push(manipulation.reason);
    sizingMultiplier *= 0.7; // v11.3: reduced penalty (was 0.3x) — still trade during manipulation
    if (manipulation.wickType === "lower") sellScore += 5; // Fake lower wick = bearish
    if (manipulation.wickType === "upper") buyScore += 5; // Fake upper wick = bullish
  }

  // ─── Final Calculation ───
  const maxPossible = 100;
  // v11.4: Balanced neutral threshold (6) — IA must have reasonable conviction
  const direction: "buy" | "sell" | "neutral" =
    buyScore > sellScore + 6 ? "buy" :
    sellScore > buyScore + 6 ? "sell" : "neutral";

  const rawConfidence = direction === "buy" ? buyScore : direction === "sell" ? sellScore : Math.max(buyScore, sellScore);
  const confidence = Math.min(95, Math.round((rawConfidence / maxPossible) * 100));

  // Clamp sizing multiplier
  sizingMultiplier = Math.max(0.5, Math.min(3.0, sizingMultiplier)); // v11.3: min 0.5x (was 0.2x) — always trade meaningful size

  return {
    direction,
    confidence,
    sizingMultiplier,
    reasons,
    blocked,
    blockReason,
    mta,
    btcFilter,
    volumeSpike,
    orderBook: params.orderBookImbalance,
    fundingRate: params.fundingRate,
    squeeze,
    meanReversion: meanRev,
    breakout,
    manipulation,
    session: { session: session.session, aggressiveness: session.aggressiveness },
    drawdown: { multiplier: ddMultiplier.multiplier, mode: ddMultiplier.mode },
    diversification,
  };
}
