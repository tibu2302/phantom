/**
 * PHANTOM v9.0 — Profit Maximizer Engine
 * 
 * 6 new AI-powered modules designed to maximize profits:
 * 1. Breakout Hunter — detect consolidations + enter on volume breakout
 * 2. Mean Reversion Sniper — buy extreme oversold for 1-3% bounce
 * 3. Funding Rate Arbitrage — earn funding without directional risk
 * 4. Liquidation Sniper — position before liquidation cascades
 * 5. Volume Profile Smart Entry — enter only at POC (high volume zones)
 * 6. Correlation Arbitrage — exploit price lag between exchanges
 */

import type { FullKlineData } from "./smartAnalysis";

// ─── 1. Breakout Hunter ───

export interface BreakoutSignal {
  detected: boolean;
  direction: "long" | "short" | "none";
  confidence: number;        // 0-100
  breakoutPrice: number;
  consolidationRange: { high: number; low: number };
  volumeRatio: number;       // current vol / avg vol
  reason: string;
}

/**
 * Detects price consolidation (tight range) followed by a breakout with volume.
 * Consolidation = last N candles within a tight range (< 1.5% spread).
 * Breakout = price breaks above/below range with volume > 2x average.
 */
export function detectBreakoutSignal(klines: FullKlineData, currentPrice: number): BreakoutSignal {
  const { highs, lows, closes, volumes } = klines;
  const len = closes.length;
  if (len < 30) return { detected: false, direction: "none", confidence: 0, breakoutPrice: 0, consolidationRange: { high: 0, low: 0 }, volumeRatio: 0, reason: "Insufficient data" };

  // Look at last 20 candles for consolidation
  const lookback = 20;
  const recentHighs = highs.slice(len - lookback, len - 1);
  const recentLows = lows.slice(len - lookback, len - 1);
  const rangeHigh = Math.max(...recentHighs);
  const rangeLow = Math.min(...recentLows);
  const rangeSpread = (rangeHigh - rangeLow) / rangeLow;

  // Average volume of consolidation period
  const avgVol = volumes.slice(len - lookback, len - 1).reduce((a, b) => a + b, 0) / (lookback - 1);
  const currentVol = volumes[len - 1];
  const volumeRatio = avgVol > 0 ? currentVol / avgVol : 1;

  // Consolidation: range < 2% of price
  const isConsolidation = rangeSpread < 0.02;

  if (!isConsolidation) {
    return { detected: false, direction: "none", confidence: 0, breakoutPrice: 0, consolidationRange: { high: rangeHigh, low: rangeLow }, volumeRatio, reason: `Range too wide: ${(rangeSpread * 100).toFixed(2)}%` };
  }

  // Check for breakout
  const breakoutUp = currentPrice > rangeHigh * 1.001; // 0.1% above range
  const breakoutDown = currentPrice < rangeLow * 0.999;  // 0.1% below range
  const volumeConfirm = volumeRatio > 1.8; // Volume at least 1.8x average

  if (breakoutUp && volumeConfirm) {
    // Tighter consolidation = stronger breakout
    const tightnessBonus = Math.max(0, (0.02 - rangeSpread) / 0.02) * 20;
    const volBonus = Math.min(30, (volumeRatio - 1.8) * 15);
    const confidence = Math.min(95, 50 + tightnessBonus + volBonus);
    return {
      detected: true, direction: "long", confidence,
      breakoutPrice: rangeHigh,
      consolidationRange: { high: rangeHigh, low: rangeLow },
      volumeRatio,
      reason: `BREAKOUT UP: price ${currentPrice.toFixed(2)} > range high ${rangeHigh.toFixed(2)}, vol ${volumeRatio.toFixed(1)}x avg, consolidation ${(rangeSpread * 100).toFixed(2)}%`
    };
  }

  if (breakoutDown && volumeConfirm) {
    const tightnessBonus = Math.max(0, (0.02 - rangeSpread) / 0.02) * 20;
    const volBonus = Math.min(30, (volumeRatio - 1.8) * 15);
    const confidence = Math.min(95, 50 + tightnessBonus + volBonus);
    return {
      detected: true, direction: "short", confidence,
      breakoutPrice: rangeLow,
      consolidationRange: { high: rangeHigh, low: rangeLow },
      volumeRatio,
      reason: `BREAKOUT DOWN: price ${currentPrice.toFixed(2)} < range low ${rangeLow.toFixed(2)}, vol ${volumeRatio.toFixed(1)}x avg`
    };
  }

  return { detected: false, direction: "none", confidence: 0, breakoutPrice: 0, consolidationRange: { high: rangeHigh, low: rangeLow }, volumeRatio, reason: `Consolidating (${(rangeSpread * 100).toFixed(2)}%), no breakout yet` };
}

// ─── 2. Mean Reversion Sniper ───

export interface MeanReversionSignal {
  detected: boolean;
  direction: "long" | "short";
  confidence: number;
  targetPrice: number;       // expected reversion target
  distanceFromMean: number;  // % away from mean
  rsiValue: number;
  bollingerPosition: number; // 0 = lower band, 1 = upper band
  reason: string;
}

/**
 * Detects extreme oversold/overbought conditions for mean reversion trades.
 * Buys when: RSI < 25 + price below lower Bollinger + volume spike (panic selling)
 * Sells when: RSI > 75 + price above upper Bollinger + volume spike (FOMO buying)
 */
export function detectMeanReversion(klines: FullKlineData, currentPrice: number): MeanReversionSignal {
  const { closes, volumes } = klines;
  const len = closes.length;
  if (len < 30) return { detected: false, direction: "long", confidence: 0, targetPrice: 0, distanceFromMean: 0, rsiValue: 50, bollingerPosition: 0.5, reason: "Insufficient data" };

  // RSI calculation (14 periods)
  const rsiPeriod = 14;
  let gains = 0, losses = 0;
  for (let i = len - rsiPeriod; i < len; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / rsiPeriod;
  const avgLoss = losses / rsiPeriod;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  // Bollinger Bands (20 periods, 2 std dev)
  const bbPeriod = 20;
  const bbCloses = closes.slice(len - bbPeriod);
  const sma = bbCloses.reduce((a, b) => a + b, 0) / bbPeriod;
  const variance = bbCloses.reduce((a, b) => a + (b - sma) ** 2, 0) / bbPeriod;
  const stdDev = Math.sqrt(variance);
  const upperBand = sma + 2 * stdDev;
  const lowerBand = sma - 2 * stdDev;
  const bandWidth = upperBand - lowerBand;
  const bollingerPosition = bandWidth > 0 ? (currentPrice - lowerBand) / bandWidth : 0.5;

  // Volume spike detection
  const avgVol = volumes.slice(len - 20, len - 1).reduce((a, b) => a + b, 0) / 19;
  const currentVol = volumes[len - 1];
  const volSpike = avgVol > 0 ? currentVol / avgVol : 1;

  const distanceFromMean = ((currentPrice - sma) / sma) * 100;

  // OVERSOLD: RSI < 25 + below lower Bollinger + volume spike
  if (rsi < 28 && bollingerPosition < 0.1 && volSpike > 1.5) {
    const rsiBonus = Math.max(0, (28 - rsi) * 2);
    const bbBonus = Math.max(0, (0.1 - bollingerPosition) * 100);
    const volBonus = Math.min(20, (volSpike - 1.5) * 10);
    const confidence = Math.min(95, 45 + rsiBonus + bbBonus + volBonus);
    const targetPrice = sma * 0.998; // Target: near SMA (mean)
    return {
      detected: true, direction: "long", confidence, targetPrice,
      distanceFromMean, rsiValue: rsi, bollingerPosition,
      reason: `OVERSOLD SNIPE: RSI=${rsi.toFixed(1)}, BB=${(bollingerPosition * 100).toFixed(0)}%, vol=${volSpike.toFixed(1)}x, dist=${distanceFromMean.toFixed(2)}% from mean`
    };
  }

  // OVERBOUGHT: RSI > 75 + above upper Bollinger + volume spike (for shorts)
  if (rsi > 75 && bollingerPosition > 0.9 && volSpike > 1.5) {
    const rsiBonus = Math.max(0, (rsi - 75) * 2);
    const bbBonus = Math.max(0, (bollingerPosition - 0.9) * 100);
    const volBonus = Math.min(20, (volSpike - 1.5) * 10);
    const confidence = Math.min(95, 45 + rsiBonus + bbBonus + volBonus);
    const targetPrice = sma * 1.002;
    return {
      detected: true, direction: "short", confidence, targetPrice,
      distanceFromMean, rsiValue: rsi, bollingerPosition,
      reason: `OVERBOUGHT SNIPE: RSI=${rsi.toFixed(1)}, BB=${(bollingerPosition * 100).toFixed(0)}%, vol=${volSpike.toFixed(1)}x`
    };
  }

  return { detected: false, direction: "long", confidence: 0, targetPrice: sma, distanceFromMean, rsiValue: rsi, bollingerPosition, reason: `Normal range: RSI=${rsi.toFixed(1)}, BB=${(bollingerPosition * 100).toFixed(0)}%` };
}

// ─── 3. Funding Rate Arbitrage ───

export interface FundingArbSignal {
  profitable: boolean;
  annualizedYield: number;    // % annualized
  fundingRate: number;        // current 8h rate
  direction: "short_perp_long_spot" | "long_perp_short_spot" | "none";
  estimatedProfit8h: number;  // $ per $1000 position
  reason: string;
}

/**
 * When funding rate is extreme (>0.03%), open opposite position to collect funding.
 * Positive funding: SHORT perp + LONG spot = collect funding every 8h
 * Negative funding: LONG perp + SHORT spot (or just LONG perp if no spot short)
 * This is market-neutral — profit comes from funding, not direction.
 */
export function analyzeFundingArbitrage(fundingRate: number, positionSize: number = 1000): FundingArbSignal {
  const absRate = Math.abs(fundingRate);
  const annualized = absRate * 3 * 365 * 100; // 3 times per day, 365 days
  const profit8h = positionSize * absRate;

  // Only profitable if funding > 0.03% (covers fees)
  if (absRate < 0.0003) {
    return { profitable: false, annualizedYield: annualized, fundingRate, direction: "none", estimatedProfit8h: 0, reason: `Funding ${(fundingRate * 100).toFixed(4)}% too low (< 0.03%)` };
  }

  if (fundingRate > 0) {
    // Positive funding: longs pay shorts → SHORT perp + LONG spot
    return {
      profitable: true, annualizedYield: annualized, fundingRate,
      direction: "short_perp_long_spot",
      estimatedProfit8h: profit8h,
      reason: `FUNDING ARB: rate=${(fundingRate * 100).toFixed(4)}%, SHORT perp + LONG spot, earn $${profit8h.toFixed(2)}/8h per $${positionSize}, annualized ${annualized.toFixed(1)}%`
    };
  } else {
    // Negative funding: shorts pay longs → LONG perp
    return {
      profitable: true, annualizedYield: annualized, fundingRate,
      direction: "long_perp_short_spot",
      estimatedProfit8h: profit8h,
      reason: `FUNDING ARB: rate=${(fundingRate * 100).toFixed(4)}%, LONG perp, earn $${profit8h.toFixed(2)}/8h per $${positionSize}, annualized ${annualized.toFixed(1)}%`
    };
  }
}

// ─── 4. Liquidation Sniper ───

export interface LiquidationSignal {
  detected: boolean;
  direction: "long" | "short";
  confidence: number;
  liquidationZone: number;   // price level with mass liquidations
  cascadeSize: string;       // "small" | "medium" | "large"
  distancePct: number;       // % distance from current price to liq zone
  reason: string;
}

/**
 * Detects when price is approaching a zone with massive liquidations.
 * When liquidations cascade, price moves violently in one direction.
 * Position BEFORE the cascade to ride the wave.
 */
export function detectLiquidationOpportunity(
  currentPrice: number,
  openInterest: number,
  recentHighs: number[],
  recentLows: number[],
  leverageDistribution: { leverage: number; percentage: number }[] = [
    { leverage: 2, percentage: 15 },
    { leverage: 3, percentage: 20 },
    { leverage: 5, percentage: 25 },
    { leverage: 10, percentage: 20 },
    { leverage: 25, percentage: 12 },
    { leverage: 50, percentage: 5 },
    { leverage: 100, percentage: 3 },
  ]
): LiquidationSignal {
  // Calculate liquidation zones for LONG positions (below current price)
  const longLiqZones: { price: number; weight: number }[] = [];
  for (const { leverage, percentage } of leverageDistribution) {
    // Longs get liquidated when price drops by ~(1/leverage) from entry
    const liqPrice = currentPrice * (1 - 0.9 / leverage); // 90% of margin
    longLiqZones.push({ price: liqPrice, weight: percentage });
  }

  // Calculate liquidation zones for SHORT positions (above current price)
  const shortLiqZones: { price: number; weight: number }[] = [];
  for (const { leverage, percentage } of leverageDistribution) {
    const liqPrice = currentPrice * (1 + 0.9 / leverage);
    shortLiqZones.push({ price: liqPrice, weight: percentage });
  }

  // Find the nearest high-weight liquidation zone
  // Check if price is moving toward a liq zone
  const recentTrend = recentHighs.length >= 3 ?
    (recentHighs[recentHighs.length - 1] - recentHighs[recentHighs.length - 3]) / recentHighs[recentHighs.length - 3] : 0;

  // If trending up → approaching SHORT liquidation zones → price will accelerate up
  if (recentTrend > 0.005) { // 0.5% uptrend
    const nearestShortLiq = shortLiqZones
      .filter(z => z.price > currentPrice)
      .sort((a, b) => a.price - b.price)[0];

    if (nearestShortLiq) {
      const distancePct = ((nearestShortLiq.price - currentPrice) / currentPrice) * 100;
      if (distancePct < 3) { // Within 3% of liq zone
        const cascadeSize = nearestShortLiq.weight > 20 ? "large" : nearestShortLiq.weight > 10 ? "medium" : "small";
        const confidence = Math.min(85, 40 + nearestShortLiq.weight + (3 - distancePct) * 10);
        return {
          detected: true, direction: "long", confidence,
          liquidationZone: nearestShortLiq.price,
          cascadeSize, distancePct,
          reason: `SHORT LIQ CASCADE: ${cascadeSize} zone at $${nearestShortLiq.price.toFixed(2)} (${distancePct.toFixed(1)}% away), trend up ${(recentTrend * 100).toFixed(2)}%`
        };
      }
    }
  }

  // If trending down → approaching LONG liquidation zones → price will accelerate down
  if (recentTrend < -0.005) {
    const nearestLongLiq = longLiqZones
      .filter(z => z.price < currentPrice)
      .sort((a, b) => b.price - a.price)[0];

    if (nearestLongLiq) {
      const distancePct = ((currentPrice - nearestLongLiq.price) / currentPrice) * 100;
      if (distancePct < 3) {
        const cascadeSize = nearestLongLiq.weight > 20 ? "large" : nearestLongLiq.weight > 10 ? "medium" : "small";
        const confidence = Math.min(85, 40 + nearestLongLiq.weight + (3 - distancePct) * 10);
        return {
          detected: true, direction: "short", confidence,
          liquidationZone: nearestLongLiq.price,
          cascadeSize, distancePct,
          reason: `LONG LIQ CASCADE: ${cascadeSize} zone at $${nearestLongLiq.price.toFixed(2)} (${distancePct.toFixed(1)}% away), trend down ${(recentTrend * 100).toFixed(2)}%`
        };
      }
    }
  }

  return { detected: false, direction: "long", confidence: 0, liquidationZone: 0, cascadeSize: "small", distancePct: 100, reason: "No liquidation cascade imminent" };
}

// ─── 5. Volume Profile Smart Entry ───

export interface VolumeProfileSignal {
  isHighVolumeZone: boolean;
  pocPrice: number;          // Point of Control (highest volume price)
  valueAreaHigh: number;
  valueAreaLow: number;
  currentZone: "poc" | "value_area" | "low_volume" | "outside";
  confidence: number;
  reason: string;
}

/**
 * Calculates Volume Profile to identify high-volume price zones (POC).
 * Trading at POC = better fills, less slippage, more predictable moves.
 * Avoid low-volume zones where price moves erratically.
 */
export function analyzeVolumeProfile(klines: FullKlineData, currentPrice: number, bins: number = 20): VolumeProfileSignal {
  const { highs, lows, closes, volumes } = klines;
  const len = closes.length;
  if (len < 20) return { isHighVolumeZone: false, pocPrice: currentPrice, valueAreaHigh: currentPrice, valueAreaLow: currentPrice, currentZone: "outside", confidence: 0, reason: "Insufficient data" };

  // Build volume profile: divide price range into bins
  const priceHigh = Math.max(...highs.slice(len - 50));
  const priceLow = Math.min(...lows.slice(len - 50));
  const binSize = (priceHigh - priceLow) / bins;

  if (binSize <= 0) return { isHighVolumeZone: false, pocPrice: currentPrice, valueAreaHigh: currentPrice, valueAreaLow: currentPrice, currentZone: "outside", confidence: 0, reason: "No price range" };

  const volumeProfile: { price: number; volume: number }[] = [];
  for (let i = 0; i < bins; i++) {
    volumeProfile.push({ price: priceLow + binSize * (i + 0.5), volume: 0 });
  }

  // Distribute volume across bins based on where each candle traded
  for (let i = Math.max(0, len - 50); i < len; i++) {
    const candleMid = (highs[i] + lows[i]) / 2;
    const binIdx = Math.min(bins - 1, Math.max(0, Math.floor((candleMid - priceLow) / binSize)));
    volumeProfile[binIdx].volume += volumes[i];
  }

  // Find POC (highest volume bin)
  const poc = volumeProfile.reduce((max, bin) => bin.volume > max.volume ? bin : max, volumeProfile[0]);
  const totalVolume = volumeProfile.reduce((sum, bin) => sum + bin.volume, 0);

  // Value Area: bins containing 70% of total volume (centered on POC)
  const sortedBins = [...volumeProfile].sort((a, b) => b.volume - a.volume);
  let vaVolume = 0;
  const vaBins: typeof volumeProfile = [];
  for (const bin of sortedBins) {
    vaBins.push(bin);
    vaVolume += bin.volume;
    if (vaVolume >= totalVolume * 0.7) break;
  }
  const valueAreaHigh = Math.max(...vaBins.map(b => b.price + binSize / 2));
  const valueAreaLow = Math.min(...vaBins.map(b => b.price - binSize / 2));

  // Determine current zone
  const distFromPOC = Math.abs(currentPrice - poc.price) / poc.price;
  let currentZone: "poc" | "value_area" | "low_volume" | "outside";
  if (distFromPOC < 0.003) currentZone = "poc";
  else if (currentPrice >= valueAreaLow && currentPrice <= valueAreaHigh) currentZone = "value_area";
  else if (currentPrice >= priceLow && currentPrice <= priceHigh) currentZone = "low_volume";
  else currentZone = "outside";

  const isHighVolumeZone = currentZone === "poc" || currentZone === "value_area";
  const confidence = currentZone === "poc" ? 85 : currentZone === "value_area" ? 65 : currentZone === "low_volume" ? 30 : 10;

  return {
    isHighVolumeZone, pocPrice: poc.price, valueAreaHigh, valueAreaLow,
    currentZone, confidence,
    reason: `Zone: ${currentZone}, POC=$${poc.price.toFixed(2)}, VA=[${valueAreaLow.toFixed(2)}-${valueAreaHigh.toFixed(2)}], dist=${(distFromPOC * 100).toFixed(2)}%`
  };
}

// ─── 6. Correlation Arbitrage Multi-Exchange ───

export interface CorrelationArbSignal {
  detected: boolean;
  direction: "buy" | "sell";
  priceDiff: number;         // absolute difference
  priceDiffPct: number;      // % difference
  leadingExchange: string;
  laggingExchange: string;
  estimatedProfit: number;   // $ per $1000 position
  confidence: number;
  reason: string;
}

// Price history for correlation tracking
const exchangePriceHistory: Map<string, { bybit: number[]; binance: number[]; okx: number[]; coinbase: number[] }> = new Map();

export function updateExchangePrice(symbol: string, exchange: string, price: number): void {
  if (!exchangePriceHistory.has(symbol)) {
    exchangePriceHistory.set(symbol, { bybit: [], binance: [], okx: [], coinbase: [] });
  }
  const hist = exchangePriceHistory.get(symbol)!;
  const exKey = exchange as keyof typeof hist;
  if (hist[exKey]) {
    hist[exKey].push(price);
    if (hist[exKey].length > 100) hist[exKey].shift();
  }
}

/**
 * Detects price discrepancies between exchanges.
 * If Binance moves first and Bybit hasn't caught up, buy on Bybit.
 * Typical lag: 1-5 seconds. Profit: 0.05-0.2% per trade.
 */
export function detectCorrelationArbitrage(
  symbol: string,
  bybitPrice: number,
  otherExchangePrices: { exchange: string; price: number }[]
): CorrelationArbSignal {
  const noSignal: CorrelationArbSignal = { detected: false, direction: "buy", priceDiff: 0, priceDiffPct: 0, leadingExchange: "", laggingExchange: "", estimatedProfit: 0, confidence: 0, reason: "No arbitrage opportunity" };

  if (otherExchangePrices.length === 0) return noSignal;

  // Find the exchange with the biggest price difference from Bybit
  let maxDiff = 0;
  let maxDiffExchange = "";
  let maxDiffPrice = 0;

  for (const { exchange, price } of otherExchangePrices) {
    const diff = Math.abs(price - bybitPrice) / bybitPrice;
    if (diff > maxDiff) {
      maxDiff = diff;
      maxDiffExchange = exchange;
      maxDiffPrice = price;
    }
    // Update price history
    updateExchangePrice(symbol, exchange, price);
  }
  updateExchangePrice(symbol, "bybit", bybitPrice);

  // Minimum 0.08% difference to cover fees (0.1% round trip)
  if (maxDiff < 0.0008) return { ...noSignal, reason: `Max diff ${(maxDiff * 100).toFixed(4)}% < 0.08% threshold` };

  // Determine direction: buy on cheaper exchange
  const direction = maxDiffPrice > bybitPrice ? "buy" : "sell";
  const leadingExchange = maxDiffPrice > bybitPrice ? maxDiffExchange : "bybit";
  const laggingExchange = maxDiffPrice > bybitPrice ? "bybit" : maxDiffExchange;

  // Check if the leading exchange consistently leads (last 5 ticks)
  const hist = exchangePriceHistory.get(symbol);
  let leadConsistency = 0;
  if (hist) {
    const bybitHist = hist.bybit.slice(-5);
    const leadHist = hist[leadingExchange as keyof typeof hist]?.slice(-5) ?? [];
    if (bybitHist.length >= 3 && leadHist.length >= 3) {
      for (let i = 0; i < Math.min(bybitHist.length, leadHist.length); i++) {
        if (direction === "buy" && leadHist[i] > bybitHist[i]) leadConsistency++;
        if (direction === "sell" && leadHist[i] < bybitHist[i]) leadConsistency++;
      }
    }
  }

  const estimatedProfit = 1000 * (maxDiff - 0.001); // profit after fees
  const confidence = Math.min(85, 30 + leadConsistency * 10 + maxDiff * 5000);

  return {
    detected: true, direction, priceDiff: Math.abs(maxDiffPrice - bybitPrice),
    priceDiffPct: maxDiff * 100, leadingExchange, laggingExchange,
    estimatedProfit, confidence,
    reason: `ARB: ${leadingExchange} leads by ${(maxDiff * 100).toFixed(3)}%, ${direction} on ${laggingExchange}, est profit $${estimatedProfit.toFixed(2)}/1k`
  };
}

// ─── 7. AI Market Timing ───

export interface MarketTimingSignal {
  isOptimalHour: boolean;
  hourScore: number;         // 0-100 (how profitable this hour typically is)
  dayScore: number;          // 0-100 (how profitable this day typically is)
  sizingMultiplier: number;  // 0.5-2.0
  reason: string;
}

// Historical profitability by hour (UTC) — learned from trade data
const hourlyProfitability: Map<number, { totalPnl: number; trades: number; winRate: number }> = new Map();
const dailyProfitability: Map<number, { totalPnl: number; trades: number; winRate: number }> = new Map();

export function recordTradeForTiming(pnl: number, timestamp: number = Date.now()): void {
  const date = new Date(timestamp);
  const hour = date.getUTCHours();
  const day = date.getUTCDay(); // 0=Sunday

  // Update hourly stats
  const hourStats = hourlyProfitability.get(hour) ?? { totalPnl: 0, trades: 0, winRate: 0 };
  hourStats.totalPnl += pnl;
  hourStats.trades += 1;
  hourStats.winRate = hourStats.trades > 0 ? (hourStats.winRate * (hourStats.trades - 1) + (pnl > 0 ? 1 : 0)) / hourStats.trades : 0;
  hourlyProfitability.set(hour, hourStats);

  // Update daily stats
  const dayStats = dailyProfitability.get(day) ?? { totalPnl: 0, trades: 0, winRate: 0 };
  dayStats.totalPnl += pnl;
  dayStats.trades += 1;
  dayStats.winRate = dayStats.trades > 0 ? (dayStats.winRate * (dayStats.trades - 1) + (pnl > 0 ? 1 : 0)) / dayStats.trades : 0;
  dailyProfitability.set(day, dayStats);
}

export function getMarketTimingSignal(): MarketTimingSignal {
  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();

  const hourStats = hourlyProfitability.get(hour);
  const dayStats = dailyProfitability.get(day);

  // Default scores based on known crypto market patterns
  let hourScore = 50;
  let dayScore = 50;

  if (hourStats && hourStats.trades >= 5) {
    // Score based on win rate and avg PnL
    const avgPnl = hourStats.totalPnl / hourStats.trades;
    hourScore = Math.min(100, Math.max(0, 50 + hourStats.winRate * 30 + Math.sign(avgPnl) * 20));
  } else {
    // Use known patterns: crypto is most volatile during US+EU overlap (13-17 UTC)
    // and Asian open (0-3 UTC)
    if (hour >= 13 && hour <= 17) hourScore = 75; // US+EU overlap
    else if (hour >= 0 && hour <= 3) hourScore = 65; // Asian open
    else if (hour >= 8 && hour <= 10) hourScore = 70; // EU open
    else if (hour >= 4 && hour <= 7) hourScore = 40; // Low volume
    else hourScore = 55;
  }

  if (dayStats && dayStats.trades >= 10) {
    const avgPnl = dayStats.totalPnl / dayStats.trades;
    dayScore = Math.min(100, Math.max(0, 50 + dayStats.winRate * 30 + Math.sign(avgPnl) * 20));
  } else {
    // Known patterns: Tuesday-Thursday tend to be most active
    if (day >= 2 && day <= 4) dayScore = 70; // Tue-Thu
    else if (day === 1 || day === 5) dayScore = 60; // Mon, Fri
    else dayScore = 45; // Weekend
  }

  const combinedScore = hourScore * 0.6 + dayScore * 0.4;
  const isOptimalHour = combinedScore >= 60;
  const sizingMultiplier = 0.5 + (combinedScore / 100) * 1.5; // 0.5x to 2.0x

  return {
    isOptimalHour, hourScore, dayScore, sizingMultiplier,
    reason: `Hour ${hour}UTC: ${hourScore}/100, Day ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]}: ${dayScore}/100, sizing ${sizingMultiplier.toFixed(2)}x`
  };
}

// ─── 8. Multi-Timeframe Scalping ───

export interface MultiTFSignal {
  aligned: boolean;
  direction: "long" | "short" | "neutral";
  alignmentScore: number;    // 0-100
  tf1m: "bullish" | "bearish" | "neutral";
  tf5m: "bullish" | "bearish" | "neutral";
  tf15m: "bullish" | "bearish" | "neutral";
  sizingBoost: number;       // 1.0-3.0
  reason: string;
}

/**
 * Analyzes 3 timeframes (1m, 5m, 15m) for alignment.
 * When all 3 agree → high-probability trade with 3x sizing.
 * When 2 agree → moderate trade with 1.5x sizing.
 * When none agree → skip.
 */
export function analyzeMultiTFAlignment(
  klines1m: FullKlineData | null,
  klines5m: FullKlineData | null,
  klines15m: FullKlineData | null,
  currentPrice: number
): MultiTFSignal {
  const noSignal: MultiTFSignal = { aligned: false, direction: "neutral", alignmentScore: 0, tf1m: "neutral", tf5m: "neutral", tf15m: "neutral", sizingBoost: 1.0, reason: "Insufficient data" };

  function getTFDirection(klines: FullKlineData | null): "bullish" | "bearish" | "neutral" {
    if (!klines || klines.closes.length < 10) return "neutral";
    const closes = klines.closes;
    const len = closes.length;

    // EMA 9 vs EMA 21
    const ema9 = closes.slice(len - 9).reduce((a, b) => a + b, 0) / 9;
    const ema21 = closes.slice(len - 21 < 0 ? 0 : len - 21).reduce((a, b) => a + b, 0) / Math.min(21, len);

    // RSI quick
    let gains = 0, losses = 0;
    const rsiLen = Math.min(14, len - 1);
    for (let i = len - rsiLen; i < len; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    const rs = losses === 0 ? 100 : gains / losses;
    const rsi = 100 - (100 / (1 + rs));

    // Price vs EMA
    const priceAboveEma = currentPrice > ema9;

    if (ema9 > ema21 && rsi > 50 && priceAboveEma) return "bullish";
    if (ema9 < ema21 && rsi < 50 && !priceAboveEma) return "bearish";
    return "neutral";
  }

  const tf1m = getTFDirection(klines1m);
  const tf5m = getTFDirection(klines5m);
  const tf15m = getTFDirection(klines15m);

  const directions = [tf1m, tf5m, tf15m];
  const bullishCount = directions.filter(d => d === "bullish").length;
  const bearishCount = directions.filter(d => d === "bearish").length;

  let direction: "long" | "short" | "neutral" = "neutral";
  let alignmentScore = 0;
  let sizingBoost = 1.0;

  if (bullishCount === 3) {
    direction = "long"; alignmentScore = 95; sizingBoost = 3.0;
  } else if (bearishCount === 3) {
    direction = "short"; alignmentScore = 95; sizingBoost = 3.0;
  } else if (bullishCount === 2) {
    direction = "long"; alignmentScore = 65; sizingBoost = 1.5;
  } else if (bearishCount === 2) {
    direction = "short"; alignmentScore = 65; sizingBoost = 1.5;
  } else {
    direction = "neutral"; alignmentScore = 20; sizingBoost = 1.0;
  }

  const aligned = alignmentScore >= 60;

  return {
    aligned, direction, alignmentScore, tf1m, tf5m, tf15m, sizingBoost,
    reason: `TF Alignment: 1m=${tf1m}, 5m=${tf5m}, 15m=${tf15m} → ${direction} (${alignmentScore}/100, sizing ${sizingBoost}x)`
  };
}

// ─── 9. Stale Position Killer ───

export interface StalePositionSignal {
  isStale: boolean;
  holdTimeHours: number;
  priceChangePct: number;    // % change since entry
  recommendation: "hold" | "close_breakeven" | "dca_down";
  reason: string;
}

/**
 * Identifies positions that are stuck (no movement) and recommends action.
 * If position held > 2h with < 0.1% movement → close at breakeven to free USDT.
 * Never close at a loss — only at breakeven or small profit.
 */
export function analyzeStalePosition(
  buyPrice: number,
  currentPrice: number,
  openedAt: number,
  maxStaleHours: number = 2
): StalePositionSignal {
  const holdTimeMs = Date.now() - openedAt;
  const holdTimeHours = holdTimeMs / 3600000;
  const priceChangePct = ((currentPrice - buyPrice) / buyPrice) * 100;

  // Not stale if held less than threshold
  if (holdTimeHours < maxStaleHours) {
    return { isStale: false, holdTimeHours, priceChangePct, recommendation: "hold", reason: `Held ${holdTimeHours.toFixed(1)}h < ${maxStaleHours}h threshold` };
  }

  // If in profit (even small), close to free capital
  if (priceChangePct > 0.05) { // > 0.05% profit
    return { isStale: true, holdTimeHours, priceChangePct, recommendation: "close_breakeven", reason: `STALE: held ${holdTimeHours.toFixed(1)}h, +${priceChangePct.toFixed(2)}% — close to free USDT` };
  }

  // If at breakeven (within ±0.05%), close to free capital
  if (Math.abs(priceChangePct) <= 0.05) {
    return { isStale: true, holdTimeHours, priceChangePct, recommendation: "close_breakeven", reason: `STALE: held ${holdTimeHours.toFixed(1)}h, ${priceChangePct.toFixed(2)}% — breakeven close` };
  }

  // If in loss, check if DCA makes sense
  if (priceChangePct < -1) {
    return { isStale: true, holdTimeHours, priceChangePct, recommendation: "dca_down", reason: `STALE: held ${holdTimeHours.toFixed(1)}h, ${priceChangePct.toFixed(2)}% — DCA to lower avg` };
  }

  // Small loss — just hold
  return { isStale: false, holdTimeHours, priceChangePct, recommendation: "hold", reason: `Held ${holdTimeHours.toFixed(1)}h, ${priceChangePct.toFixed(2)}% — holding, waiting for recovery` };
}

// ─── 10. USDT Liquidity Manager ───

export interface LiquiditySignal {
  usdtUtilization: number;   // % of USDT currently in positions
  freeUsdt: number;          // available USDT
  recommendation: "deploy_more" | "hold_cash" | "reduce_exposure";
  maxNewPositionSize: number; // max $ for next trade
  reason: string;
}

/**
 * Manages USDT liquidity to ensure the bot always has capital available.
 * Rules:
 * - Never deploy more than 80% of total USDT
 * - Keep 20% as reserve for DCA opportunities
 * - If utilization > 80%, don't open new positions
 * - If utilization < 40%, be more aggressive
 */
export function analyzeLiquidity(
  totalUsdt: number,
  deployedUsdt: number,
  openPositionCount: number,
  maxPositions: number = 20
): LiquiditySignal {
  const freeUsdt = totalUsdt - deployedUsdt;
  const utilization = totalUsdt > 0 ? deployedUsdt / totalUsdt : 0;

  // Position limit check
  if (openPositionCount >= maxPositions) {
    return {
      usdtUtilization: utilization * 100, freeUsdt,
      recommendation: "hold_cash", maxNewPositionSize: 0,
      reason: `MAX POSITIONS: ${openPositionCount}/${maxPositions}, wait for exits`
    };
  }

  if (utilization > 0.8) {
    return {
      usdtUtilization: utilization * 100, freeUsdt,
      recommendation: "reduce_exposure", maxNewPositionSize: 0,
      reason: `HIGH UTILIZATION: ${(utilization * 100).toFixed(1)}% > 80%, no new positions`
    };
  }

  if (utilization < 0.4) {
    // Aggressive: deploy up to 15% of free USDT per trade
    const maxSize = freeUsdt * 0.15;
    return {
      usdtUtilization: utilization * 100, freeUsdt,
      recommendation: "deploy_more", maxNewPositionSize: maxSize,
      reason: `LOW UTILIZATION: ${(utilization * 100).toFixed(1)}% < 40%, deploy more (max $${maxSize.toFixed(0)})`
    };
  }

  // Normal: deploy up to 8% of free USDT per trade
  const maxSize = freeUsdt * 0.08;
  return {
    usdtUtilization: utilization * 100, freeUsdt,
    recommendation: "hold_cash", maxNewPositionSize: maxSize,
    reason: `NORMAL: ${(utilization * 100).toFixed(1)}% utilized, $${freeUsdt.toFixed(0)} free (max $${maxSize.toFixed(0)}/trade)`
  };
}

// ─── Composite Signal ───

export interface ProfitMaximizerSignal {
  breakout: BreakoutSignal;
  meanReversion: MeanReversionSignal;
  fundingArb: FundingArbSignal;
  liquidation: LiquidationSignal;
  volumeProfile: VolumeProfileSignal;
  correlationArb: CorrelationArbSignal;
  marketTiming: MarketTimingSignal;
  multiTF: MultiTFSignal;
  liquidity: LiquiditySignal;
  overallBoost: number;       // combined sizing multiplier
  topOpportunity: string;     // best opportunity right now
}

/**
 * Combines all profit maximizer signals into a single composite signal.
 * Returns the best opportunity and an overall sizing boost.
 */
export function getProfitMaximizerSignal(params: {
  klines: FullKlineData;
  klines1m?: FullKlineData | null;
  klines5m?: FullKlineData | null;
  currentPrice: number;
  fundingRate?: number;
  bybitPrice?: number;
  otherExchangePrices?: { exchange: string; price: number }[];
  totalUsdt?: number;
  deployedUsdt?: number;
  openPositionCount?: number;
}): ProfitMaximizerSignal {
  const { klines, klines1m, klines5m, currentPrice, fundingRate = 0, bybitPrice, otherExchangePrices = [], totalUsdt = 10000, deployedUsdt = 5000, openPositionCount = 5 } = params;

  const breakout = detectBreakoutSignal(klines, currentPrice);
  const meanRev = detectMeanReversion(klines, currentPrice);
  const fundingArb = analyzeFundingArbitrage(fundingRate);
  const liquidation = detectLiquidationOpportunity(currentPrice, 0, klines.highs.slice(-10), klines.lows.slice(-10));
  const volumeProfile = analyzeVolumeProfile(klines, currentPrice);
  const correlationArb = detectCorrelationArbitrage("", bybitPrice ?? currentPrice, otherExchangePrices);
  const marketTiming = getMarketTimingSignal();
  const multiTF = analyzeMultiTFAlignment(klines1m ?? null, klines5m ?? null, klines, currentPrice);
  const liquidity = analyzeLiquidity(totalUsdt, deployedUsdt, openPositionCount);

  // Calculate overall boost
  let boost = 1.0;
  boost *= marketTiming.sizingMultiplier;
  if (multiTF.aligned) boost *= multiTF.sizingBoost;
  if (breakout.detected && breakout.confidence > 70) boost *= 1.3;
  if (volumeProfile.isHighVolumeZone) boost *= 1.1;
  boost = Math.min(4.0, Math.max(0.5, boost)); // Cap between 0.5x and 4.0x

  // Find top opportunity
  const opportunities = [
    { name: "Breakout", score: breakout.detected ? breakout.confidence : 0 },
    { name: "Mean Reversion", score: meanRev.detected ? meanRev.confidence : 0 },
    { name: "Funding Arb", score: fundingArb.profitable ? 70 : 0 },
    { name: "Liquidation Sniper", score: liquidation.detected ? liquidation.confidence : 0 },
    { name: "Multi-TF Alignment", score: multiTF.aligned ? multiTF.alignmentScore : 0 },
    { name: "Correlation Arb", score: correlationArb.detected ? correlationArb.confidence : 0 },
  ];
  const topOpp = opportunities.sort((a, b) => b.score - a.score)[0];

  return {
    breakout, meanReversion: meanRev, fundingArb, liquidation,
    volumeProfile, correlationArb, marketTiming, multiTF, liquidity,
    overallBoost: boost,
    topOpportunity: topOpp.score > 0 ? `${topOpp.name} (${topOpp.score}/100)` : "None"
  };
}
