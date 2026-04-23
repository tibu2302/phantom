/**
 * PHANTOM Smart Analysis Engine v6.0
 * Advanced Technical Analysis + Market Regime Detection + Confidence Scoring
 * 
 * This module provides:
 * 1. Advanced indicators: ATR, VWAP, OBV, Stochastic RSI, ADX, Williams %R
 * 2. Divergence detection (RSI + MACD bullish/bearish divergences)
 * 3. Market regime classification (trending, ranging, volatile)
 * 4. Multi-indicator confidence scoring (0-100)
 * 5. Dynamic parameter adaptation based on market conditions
 * 6. Support/Resistance detection via volume profile
 * 7. Smart entry/exit signals with confidence levels
 */

// ─── Core Indicator Functions ───

/** Average True Range — measures volatility, used for dynamic stops and position sizing */
export function calculateATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (highs.length < period + 1) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }
  // Wilder's smoothing (EMA-like)
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

/** ATR as percentage of price — normalized volatility measure */
export function calculateATRPercent(highs: number[], lows: number[], closes: number[], period = 14): number {
  const atr = calculateATR(highs, lows, closes, period);
  const lastPrice = closes[closes.length - 1];
  return lastPrice > 0 ? (atr / lastPrice) * 100 : 0;
}

/** Average Directional Index — measures trend strength (0-100) */
export function calculateADX(highs: number[], lows: number[], closes: number[], period = 14): { adx: number; plusDI: number; minusDI: number } {
  if (highs.length < period * 2) return { adx: 0, plusDI: 0, minusDI: 0 };
  
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];
  
  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  
  // Wilder's smoothing
  const smooth = (arr: number[], p: number): number[] => {
    const result: number[] = [arr.slice(0, p).reduce((a, b) => a + b, 0)];
    for (let i = p; i < arr.length; i++) {
      result.push(result[result.length - 1] - result[result.length - 1] / p + arr[i]);
    }
    return result;
  };
  
  const smoothTR = smooth(tr, period);
  const smoothPlusDM = smooth(plusDM, period);
  const smoothMinusDM = smooth(minusDM, period);
  
  const plusDI: number[] = [];
  const minusDI: number[] = [];
  const dx: number[] = [];
  
  for (let i = 0; i < smoothTR.length; i++) {
    const pdi = smoothTR[i] > 0 ? (smoothPlusDM[i] / smoothTR[i]) * 100 : 0;
    const mdi = smoothTR[i] > 0 ? (smoothMinusDM[i] / smoothTR[i]) * 100 : 0;
    plusDI.push(pdi);
    minusDI.push(mdi);
    const sum = pdi + mdi;
    dx.push(sum > 0 ? (Math.abs(pdi - mdi) / sum) * 100 : 0);
  }
  
  // ADX = smoothed DX
  if (dx.length < period) return { adx: 0, plusDI: plusDI[plusDI.length - 1] ?? 0, minusDI: minusDI[minusDI.length - 1] ?? 0 };
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }
  
  return { adx, plusDI: plusDI[plusDI.length - 1], minusDI: minusDI[minusDI.length - 1] };
}

/** Stochastic RSI — RSI of RSI, more sensitive to overbought/oversold */
export function calculateStochRSI(closes: number[], rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3): { k: number; d: number } {
  if (closes.length < rsiPeriod + stochPeriod + kSmooth) return { k: 50, d: 50 };
  
  // Calculate RSI series
  const rsiValues: number[] = [];
  for (let i = rsiPeriod + 1; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    let gains = 0, losses = 0;
    for (let j = slice.length - rsiPeriod; j < slice.length; j++) {
      const diff = slice[j] - slice[j - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / rsiPeriod;
    const avgLoss = losses / rsiPeriod;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rs)));
  }
  
  if (rsiValues.length < stochPeriod) return { k: 50, d: 50 };
  
  // Stochastic of RSI
  const stochK: number[] = [];
  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    const window = rsiValues.slice(i - stochPeriod + 1, i + 1);
    const min = Math.min(...window);
    const max = Math.max(...window);
    stochK.push(max === min ? 50 : ((rsiValues[i] - min) / (max - min)) * 100);
  }
  
  // Smooth K
  const smoothedK: number[] = [];
  for (let i = kSmooth - 1; i < stochK.length; i++) {
    const avg = stochK.slice(i - kSmooth + 1, i + 1).reduce((a, b) => a + b, 0) / kSmooth;
    smoothedK.push(avg);
  }
  
  // D = SMA of smoothed K
  const smoothedD: number[] = [];
  for (let i = dSmooth - 1; i < smoothedK.length; i++) {
    const avg = smoothedK.slice(i - dSmooth + 1, i + 1).reduce((a, b) => a + b, 0) / dSmooth;
    smoothedD.push(avg);
  }
  
  return {
    k: smoothedK[smoothedK.length - 1] ?? 50,
    d: smoothedD[smoothedD.length - 1] ?? 50,
  };
}

/** On Balance Volume — confirms price moves with volume */
export function calculateOBV(closes: number[], volumes: number[]): { obv: number; obvSlope: number; obvDivergence: "bullish" | "bearish" | "none" } {
  if (closes.length < 10 || volumes.length < 10) return { obv: 0, obvSlope: 0, obvDivergence: "none" };
  
  const len = Math.min(closes.length, volumes.length);
  let obv = 0;
  const obvSeries: number[] = [0];
  
  for (let i = 1; i < len; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    obvSeries.push(obv);
  }
  
  // OBV slope (last 10 periods)
  const recentOBV = obvSeries.slice(-10);
  const obvSlope = recentOBV.length >= 2 ? (recentOBV[recentOBV.length - 1] - recentOBV[0]) / recentOBV.length : 0;
  
  // Divergence detection: price vs OBV direction
  const recentCloses = closes.slice(-10);
  const priceSlope = recentCloses.length >= 2 ? (recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0] : 0;
  const normalizedOBVSlope = obvSeries[obvSeries.length - 1] !== 0 ? obvSlope / Math.abs(obvSeries[obvSeries.length - 1]) : 0;
  
  let divergence: "bullish" | "bearish" | "none" = "none";
  if (priceSlope < -0.005 && normalizedOBVSlope > 0.01) divergence = "bullish"; // Price down, OBV up
  if (priceSlope > 0.005 && normalizedOBVSlope < -0.01) divergence = "bearish"; // Price up, OBV down
  
  return { obv, obvSlope, obvDivergence: divergence };
}

/** Williams %R — momentum oscillator (-100 to 0) */
export function calculateWilliamsR(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (highs.length < period) return -50;
  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const highestHigh = Math.max(...recentHighs);
  const lowestLow = Math.min(...recentLows);
  const close = closes[closes.length - 1];
  if (highestHigh === lowestLow) return -50;
  return ((highestHigh - close) / (highestHigh - lowestLow)) * -100;
}

/** VWAP — Volume Weighted Average Price (intraday reference) */
export function calculateVWAP(highs: number[], lows: number[], closes: number[], volumes: number[]): number {
  if (closes.length < 5 || volumes.length < 5) return closes[closes.length - 1] ?? 0;
  const len = Math.min(highs.length, lows.length, closes.length, volumes.length);
  let cumTPV = 0;
  let cumVol = 0;
  // Use last 50 candles as "session"
  const start = Math.max(0, len - 50);
  for (let i = start; i < len; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumTPV += tp * volumes[i];
    cumVol += volumes[i];
  }
  return cumVol > 0 ? cumTPV / cumVol : closes[closes.length - 1];
}

/** RSI Divergence Detection */
export function detectRSIDivergence(closes: number[], period = 14, lookback = 20): "bullish" | "bearish" | "none" {
  if (closes.length < period + lookback) return "none";
  
  // Calculate RSI series for last N candles
  const rsiSeries: number[] = [];
  for (let i = period + 1; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    let gains = 0, losses = 0;
    for (let j = slice.length - period; j < slice.length; j++) {
      const diff = slice[j] - slice[j - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiSeries.push(100 - (100 / (1 + rs)));
  }
  
  if (rsiSeries.length < lookback) return "none";
  
  const recentRSI = rsiSeries.slice(-lookback);
  const recentCloses = closes.slice(-lookback);
  
  // Find local lows in price and RSI
  const priceLows: { idx: number; val: number }[] = [];
  const rsiLows: { idx: number; val: number }[] = [];
  const priceHighs: { idx: number; val: number }[] = [];
  const rsiHighs: { idx: number; val: number }[] = [];
  
  for (let i = 2; i < lookback - 2; i++) {
    if (recentCloses[i] < recentCloses[i - 1] && recentCloses[i] < recentCloses[i - 2] &&
        recentCloses[i] < recentCloses[i + 1] && recentCloses[i] < recentCloses[i + 2]) {
      priceLows.push({ idx: i, val: recentCloses[i] });
      rsiLows.push({ idx: i, val: recentRSI[i] });
    }
    if (recentCloses[i] > recentCloses[i - 1] && recentCloses[i] > recentCloses[i - 2] &&
        recentCloses[i] > recentCloses[i + 1] && recentCloses[i] > recentCloses[i + 2]) {
      priceHighs.push({ idx: i, val: recentCloses[i] });
      rsiHighs.push({ idx: i, val: recentRSI[i] });
    }
  }
  
  // Bullish divergence: price makes lower low, RSI makes higher low
  if (priceLows.length >= 2) {
    const last = priceLows[priceLows.length - 1];
    const prev = priceLows[priceLows.length - 2];
    const lastRSI = rsiLows[rsiLows.length - 1];
    const prevRSI = rsiLows[rsiLows.length - 2];
    if (last.val < prev.val && lastRSI && prevRSI && lastRSI.val > prevRSI.val) {
      return "bullish";
    }
  }
  
  // Bearish divergence: price makes higher high, RSI makes lower high
  if (priceHighs.length >= 2) {
    const last = priceHighs[priceHighs.length - 1];
    const prev = priceHighs[priceHighs.length - 2];
    const lastRSI = rsiHighs[rsiHighs.length - 1];
    const prevRSI = rsiHighs[rsiHighs.length - 2];
    if (last.val > prev.val && lastRSI && prevRSI && lastRSI.val < prevRSI.val) {
      return "bearish";
    }
  }
  
  return "none";
}

/** MACD Divergence Detection */
export function detectMACDDivergence(closes: number[], lookback = 20): "bullish" | "bearish" | "none" {
  if (closes.length < 26 + lookback) return "none";
  
  // Calculate MACD histogram series
  const ema = (data: number[], period: number): number[] => {
    const k = 2 / (period + 1);
    const result: number[] = [data[0]];
    for (let i = 1; i < data.length; i++) {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  };
  
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine.slice(-9), 9);
  
  // Get histogram for last lookback candles
  const histLen = Math.min(lookback, signalLine.length);
  const histogram: number[] = [];
  for (let i = 0; i < histLen; i++) {
    const mIdx = macdLine.length - histLen + i;
    const sIdx = signalLine.length - histLen + i;
    if (mIdx >= 0 && sIdx >= 0) {
      histogram.push(macdLine[mIdx] - signalLine[sIdx]);
    }
  }
  
  if (histogram.length < 10) return "none";
  
  const recentCloses = closes.slice(-histogram.length);
  
  // Find local extremes in histogram
  const histLows: { idx: number; val: number }[] = [];
  const histHighs: { idx: number; val: number }[] = [];
  
  for (let i = 1; i < histogram.length - 1; i++) {
    if (histogram[i] < histogram[i - 1] && histogram[i] < histogram[i + 1] && histogram[i] < 0) {
      histLows.push({ idx: i, val: histogram[i] });
    }
    if (histogram[i] > histogram[i - 1] && histogram[i] > histogram[i + 1] && histogram[i] > 0) {
      histHighs.push({ idx: i, val: histogram[i] });
    }
  }
  
  // Bullish: price lower low + histogram higher low
  if (histLows.length >= 2) {
    const last = histLows[histLows.length - 1];
    const prev = histLows[histLows.length - 2];
    if (recentCloses[last.idx] < recentCloses[prev.idx] && last.val > prev.val) {
      return "bullish";
    }
  }
  
  // Bearish: price higher high + histogram lower high
  if (histHighs.length >= 2) {
    const last = histHighs[histHighs.length - 1];
    const prev = histHighs[histHighs.length - 2];
    if (recentCloses[last.idx] > recentCloses[prev.idx] && last.val < prev.val) {
      return "bearish";
    }
  }
  
  return "none";
}

// ─── Market Regime Detection ───

export type MarketRegime = "strong_trend_up" | "trend_up" | "ranging" | "trend_down" | "strong_trend_down" | "volatile";

export interface RegimeAnalysis {
  regime: MarketRegime;
  adx: number;
  atrPct: number;
  trendStrength: number; // 0-100
  description: string;
}

/** Classify current market conditions */
export function detectMarketRegime(
  highs: number[], lows: number[], closes: number[], volumes: number[]
): RegimeAnalysis {
  const adxResult = calculateADX(highs, lows, closes);
  const atrPct = calculateATRPercent(highs, lows, closes);
  
  // EMA trend direction
  const ema20 = emaCalc(closes, 20);
  const ema50 = emaCalc(closes, Math.min(50, closes.length));
  const ema20Now = ema20[ema20.length - 1] ?? 0;
  const ema50Now = ema50[ema50.length - 1] ?? 0;
  const emaDiff = ema50Now > 0 ? (ema20Now - ema50Now) / ema50Now * 100 : 0;
  
  // Price position relative to EMAs
  const price = closes[closes.length - 1];
  const aboveEMA20 = price > ema20Now;
  const aboveEMA50 = price > ema50Now;
  
  let regime: MarketRegime;
  let trendStrength: number;
  let description: string;
  
  // High volatility override
  if (atrPct > 3.0) {
    regime = "volatile";
    trendStrength = adxResult.adx;
    description = `Alta volatilidad (ATR ${atrPct.toFixed(1)}%), mercado inestable`;
  }
  // Strong trending
  else if (adxResult.adx > 40) {
    if (adxResult.plusDI > adxResult.minusDI && aboveEMA20) {
      regime = "strong_trend_up";
      trendStrength = Math.min(100, adxResult.adx * 1.5);
      description = `Tendencia alcista fuerte (ADX ${adxResult.adx.toFixed(0)}, +DI>${adxResult.plusDI.toFixed(0)})`;
    } else if (adxResult.minusDI > adxResult.plusDI && !aboveEMA20) {
      regime = "strong_trend_down";
      trendStrength = Math.min(100, adxResult.adx * 1.5);
      description = `Tendencia bajista fuerte (ADX ${adxResult.adx.toFixed(0)}, -DI>${adxResult.minusDI.toFixed(0)})`;
    } else {
      regime = emaDiff > 0 ? "trend_up" : "trend_down";
      trendStrength = adxResult.adx;
      description = `Tendencia ${emaDiff > 0 ? "alcista" : "bajista"} (ADX ${adxResult.adx.toFixed(0)})`;
    }
  }
  // Moderate trending
  else if (adxResult.adx > 25) {
    if (emaDiff > 0.1 && aboveEMA50) {
      regime = "trend_up";
      trendStrength = adxResult.adx;
      description = `Tendencia alcista moderada (ADX ${adxResult.adx.toFixed(0)})`;
    } else if (emaDiff < -0.1 && !aboveEMA50) {
      regime = "trend_down";
      trendStrength = adxResult.adx;
      description = `Tendencia bajista moderada (ADX ${adxResult.adx.toFixed(0)})`;
    } else {
      regime = "ranging";
      trendStrength = 50 - adxResult.adx;
      description = `Rango con sesgo (ADX ${adxResult.adx.toFixed(0)})`;
    }
  }
  // Ranging/Consolidation
  else {
    regime = "ranging";
    trendStrength = Math.max(0, 25 - adxResult.adx);
    description = `Mercado lateral/consolidación (ADX ${adxResult.adx.toFixed(0)})`;
  }
  
  return { regime, adx: adxResult.adx, atrPct, trendStrength, description };
}

// ─── Confidence Scoring System ───

export interface SignalScore {
  direction: "buy" | "sell" | "neutral";
  confidence: number; // 0-100
  reasons: string[];
  regime: MarketRegime;
  suggestedSizePct: number; // 0.5-1.5 multiplier for position size
  suggestedTrailingPct: number; // dynamic trailing stop %
  urgency: "high" | "medium" | "low";
}

export interface FullKlineData {
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
}

/** 
 * Master scoring function — analyzes all indicators and returns a confidence-weighted signal.
 * This is the brain of the bot. Every buy/sell decision should go through this.
 */
export function calculateSignalScore(klines: FullKlineData, currentPrice: number): SignalScore {
  const { highs, lows, closes, volumes } = klines;
  
  if (closes.length < 30) {
    return { direction: "neutral", confidence: 0, reasons: [], regime: "ranging", suggestedSizePct: 1.0, suggestedTrailingPct: 0.5, urgency: "low" };
  }
  
  let buyScore = 0;
  let sellScore = 0;
  const reasons: string[] = [];
  
  // ─── 1. RSI Analysis (weight: 15) ───
  const rsi = calcRSI(closes);
  if (rsi < 25) { buyScore += 15; reasons.push(`RSI extremo oversold (${rsi.toFixed(1)})`); }
  else if (rsi < 35) { buyScore += 10; reasons.push(`RSI oversold (${rsi.toFixed(1)})`); }
  else if (rsi < 45) { buyScore += 5; reasons.push(`RSI bajo (${rsi.toFixed(1)})`); }
  else if (rsi > 75) { sellScore += 15; reasons.push(`RSI extremo overbought (${rsi.toFixed(1)})`); }
  else if (rsi > 65) { sellScore += 10; reasons.push(`RSI overbought (${rsi.toFixed(1)})`); }
  else if (rsi > 55) { sellScore += 3; }
  
  // ─── 2. Stochastic RSI (weight: 10) ───
  const stochRSI = calculateStochRSI(closes);
  if (stochRSI.k < 20 && stochRSI.d < 20) { buyScore += 10; reasons.push(`StochRSI oversold (K=${stochRSI.k.toFixed(0)})`); }
  else if (stochRSI.k < 30) { buyScore += 5; }
  if (stochRSI.k > 80 && stochRSI.d > 80) { sellScore += 10; reasons.push(`StochRSI overbought (K=${stochRSI.k.toFixed(0)})`); }
  else if (stochRSI.k > 70) { sellScore += 5; }
  // Crossover signals
  if (stochRSI.k > stochRSI.d && stochRSI.k < 30) { buyScore += 5; reasons.push("StochRSI bullish cross"); }
  if (stochRSI.k < stochRSI.d && stochRSI.k > 70) { sellScore += 5; reasons.push("StochRSI bearish cross"); }
  
  // ─── 3. MACD Analysis (weight: 12) ───
  const macd = calcMACD(closes);
  if (macd.histogram > 0 && macd.macd > macd.signal) {
    buyScore += 8;
    if (macd.histogram > Math.abs(macd.signal) * 0.1) { buyScore += 4; reasons.push("MACD fuerte bullish"); }
    else reasons.push("MACD bullish");
  }
  if (macd.histogram < 0 && macd.macd < macd.signal) {
    sellScore += 8;
    if (Math.abs(macd.histogram) > Math.abs(macd.signal) * 0.1) { sellScore += 4; reasons.push("MACD fuerte bearish"); }
    else reasons.push("MACD bearish");
  }
  
  // ─── 4. Bollinger Bands (weight: 12) ───
  const bb = calcBB(closes);
  const bbWidth = bb.middle > 0 ? (bb.upper - bb.lower) / bb.middle : 0;
  const bbPosition = bb.upper !== bb.lower ? (currentPrice - bb.lower) / (bb.upper - bb.lower) : 0.5;
  
  if (bbPosition < 0.1) { buyScore += 12; reasons.push(`Precio en BB inferior (${(bbPosition * 100).toFixed(0)}%)`); }
  else if (bbPosition < 0.25) { buyScore += 7; reasons.push("Precio cerca de BB inferior"); }
  if (bbPosition > 0.9) { sellScore += 12; reasons.push(`Precio en BB superior (${(bbPosition * 100).toFixed(0)}%)`); }
  else if (bbPosition > 0.75) { sellScore += 7; reasons.push("Precio cerca de BB superior"); }
  
  // BB squeeze (low volatility → breakout coming)
  if (bbWidth < 0.02) { reasons.push("BB squeeze — breakout inminente"); }
  
  // ─── 5. EMA Crossovers (weight: 10) ───
  const ema9 = emaCalc(closes, 9);
  const ema21 = emaCalc(closes, 21);
  const ema50 = emaCalc(closes, Math.min(50, closes.length));
  const ema9Now = ema9[ema9.length - 1];
  const ema21Now = ema21[ema21.length - 1];
  const ema50Now = ema50[ema50.length - 1];
  
  if (ema9Now > ema21Now && ema21Now > ema50Now) { buyScore += 10; reasons.push("EMAs alineadas alcistas (9>21>50)"); }
  else if (ema9Now > ema21Now) { buyScore += 5; reasons.push("EMA 9 > 21 (bullish)"); }
  if (ema9Now < ema21Now && ema21Now < ema50Now) { sellScore += 10; reasons.push("EMAs alineadas bajistas (9<21<50)"); }
  else if (ema9Now < ema21Now) { sellScore += 5; reasons.push("EMA 9 < 21 (bearish)"); }
  
  // Fresh crossover (stronger signal)
  if (ema9.length >= 2 && ema21.length >= 2) {
    if (ema9[ema9.length - 2] <= ema21[ema21.length - 2] && ema9Now > ema21Now) {
      buyScore += 8; reasons.push("EMA 9/21 cruce alcista FRESCO");
    }
    if (ema9[ema9.length - 2] >= ema21[ema21.length - 2] && ema9Now < ema21Now) {
      sellScore += 8; reasons.push("EMA 9/21 cruce bajista FRESCO");
    }
  }
  
  // ─── 6. ADX / Trend Strength (weight: 8) ───
  const adxResult = calculateADX(highs, lows, closes);
  if (adxResult.adx > 25) {
    if (adxResult.plusDI > adxResult.minusDI) { buyScore += 8; reasons.push(`ADX trending alcista (${adxResult.adx.toFixed(0)})`); }
    else { sellScore += 8; reasons.push(`ADX trending bajista (${adxResult.adx.toFixed(0)})`); }
  }
  
  // ─── 7. OBV / Volume Confirmation (weight: 8) ───
  const obv = calculateOBV(closes, volumes);
  if (obv.obvDivergence === "bullish") { buyScore += 8; reasons.push("OBV divergencia alcista (volumen acumulando)"); }
  if (obv.obvDivergence === "bearish") { sellScore += 8; reasons.push("OBV divergencia bajista (volumen distribuyendo)"); }
  if (obv.obvSlope > 0 && buyScore > sellScore) { buyScore += 3; }
  if (obv.obvSlope < 0 && sellScore > buyScore) { sellScore += 3; }
  
  // ─── 8. VWAP (weight: 6) ───
  const vwap = calculateVWAP(highs, lows, closes, volumes);
  if (currentPrice < vwap * 0.995) { buyScore += 6; reasons.push("Precio bajo VWAP (descuento)"); }
  if (currentPrice > vwap * 1.005) { sellScore += 6; reasons.push("Precio sobre VWAP (premium)"); }
  
  // ─── 9. Divergences (weight: 12 — very powerful signals) ───
  const rsiDiv = detectRSIDivergence(closes);
  if (rsiDiv === "bullish") { buyScore += 12; reasons.push("DIVERGENCIA RSI alcista (señal fuerte)"); }
  if (rsiDiv === "bearish") { sellScore += 12; reasons.push("DIVERGENCIA RSI bajista (señal fuerte)"); }
  
  const macdDiv = detectMACDDivergence(closes);
  if (macdDiv === "bullish") { buyScore += 10; reasons.push("DIVERGENCIA MACD alcista"); }
  if (macdDiv === "bearish") { sellScore += 10; reasons.push("DIVERGENCIA MACD bajista"); }
  
  // ─── 10. Williams %R (weight: 5) ───
  const willR = calculateWilliamsR(highs, lows, closes);
  if (willR < -80) { buyScore += 5; reasons.push(`Williams %R oversold (${willR.toFixed(0)})`); }
  if (willR > -20) { sellScore += 5; reasons.push(`Williams %R overbought (${willR.toFixed(0)})`); }
  
  // ─── Market Regime ───
  const regimeAnalysis = detectMarketRegime(highs, lows, closes, volumes);
  
  // ─── Regime-Based Adjustments ───
  // In strong trends, boost trend-following signals
  if (regimeAnalysis.regime === "strong_trend_up") {
    buyScore = Math.round(buyScore * 1.2);
    sellScore = Math.round(sellScore * 0.7); // Reduce sell signals in strong uptrend
  }
  if (regimeAnalysis.regime === "strong_trend_down") {
    sellScore = Math.round(sellScore * 1.2);
    buyScore = Math.round(buyScore * 0.7); // Reduce buy signals in strong downtrend
  }
  // In ranging market, boost mean-reversion signals (BB, RSI extremes)
  if (regimeAnalysis.regime === "ranging") {
    // Already captured by BB and RSI scoring
  }
  // In volatile market, require higher confidence
  if (regimeAnalysis.regime === "volatile") {
    buyScore = Math.round(buyScore * 0.8);
    sellScore = Math.round(sellScore * 0.8);
  }
  
  // ─── Final Score Calculation ───
  const maxPossible = 100; // Theoretical max from all indicators
  const direction: "buy" | "sell" | "neutral" = 
    buyScore > sellScore + 10 ? "buy" :
    sellScore > buyScore + 10 ? "sell" : "neutral";
  
  const rawConfidence = direction === "buy" ? buyScore : direction === "sell" ? sellScore : Math.max(buyScore, sellScore);
  const confidence = Math.min(95, Math.round((rawConfidence / maxPossible) * 100));
  
  // ─── Dynamic Position Sizing ───
  // Higher confidence → larger position (0.5x to 1.5x)
  const suggestedSizePct = confidence >= 70 ? 1.3 :
                           confidence >= 55 ? 1.0 :
                           confidence >= 40 ? 0.7 : 0.5;
  
  // ─── Dynamic Trailing Stop based on ATR ───
  const atrPct = calculateATRPercent(highs, lows, closes);
  // Trailing = 1.5x ATR% (tighter in low vol, wider in high vol)
  const suggestedTrailingPct = Math.max(0.3, Math.min(2.0, atrPct * 1.5));
  
  // ─── Urgency ───
  const urgency: "high" | "medium" | "low" = 
    confidence >= 65 ? "high" :
    confidence >= 45 ? "medium" : "low";
  
  return {
    direction,
    confidence,
    reasons,
    regime: regimeAnalysis.regime,
    suggestedSizePct,
    suggestedTrailingPct,
    urgency,
  };
}

// ─── Support/Resistance via Volume Profile ───

export interface SupportResistance {
  supports: number[];
  resistances: number[];
  nearestSupport: number;
  nearestResistance: number;
}

export function findSupportResistance(highs: number[], lows: number[], closes: number[], volumes: number[], currentPrice: number, buckets = 20): SupportResistance {
  if (closes.length < 20) {
    return { supports: [], resistances: [], nearestSupport: currentPrice * 0.99, nearestResistance: currentPrice * 1.01 };
  }
  
  const allPrices = [...highs, ...lows, ...closes];
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const range = maxPrice - minPrice;
  if (range === 0) return { supports: [], resistances: [], nearestSupport: currentPrice * 0.99, nearestResistance: currentPrice * 1.01 };
  
  const bucketSize = range / buckets;
  const volumeProfile: number[] = new Array(buckets).fill(0);
  
  // Distribute volume into price buckets
  const len = Math.min(closes.length, volumes.length);
  for (let i = 0; i < len; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    const bucket = Math.min(buckets - 1, Math.floor((tp - minPrice) / bucketSize));
    volumeProfile[bucket] += volumes[i];
  }
  
  // Find high-volume nodes (potential S/R)
  const avgVolume = volumeProfile.reduce((a, b) => a + b, 0) / buckets;
  const highVolNodes: number[] = [];
  
  for (let i = 0; i < buckets; i++) {
    if (volumeProfile[i] > avgVolume * 1.5) {
      highVolNodes.push(minPrice + (i + 0.5) * bucketSize);
    }
  }
  
  const supports = highVolNodes.filter(p => p < currentPrice).sort((a, b) => b - a);
  const resistances = highVolNodes.filter(p => p > currentPrice).sort((a, b) => a - b);
  
  return {
    supports,
    resistances,
    nearestSupport: supports[0] ?? currentPrice * 0.98,
    nearestResistance: resistances[0] ?? currentPrice * 1.02,
  };
}

// ─── Loss Streak Cooldown ───

const lossStreaks: Map<string, { consecutive: number; lastLossTime: number }> = new Map();

export function recordTradeResult(symbol: string, strategy: string, isWin: boolean): void {
  const key = `${symbol}_${strategy}`;
  const streak = lossStreaks.get(key) ?? { consecutive: 0, lastLossTime: 0 };
  if (isWin) {
    streak.consecutive = 0;
  } else {
    streak.consecutive++;
    streak.lastLossTime = Date.now();
  }
  lossStreaks.set(key, streak);
}

export function getLossCooldownMultiplier(symbol: string, strategy: string): number {
  const key = `${symbol}_${strategy}`;
  const streak = lossStreaks.get(key);
  if (!streak || streak.consecutive === 0) return 1.0;
  
  // Reduce size after consecutive losses
  // 1 loss: 80%, 2 losses: 60%, 3+ losses: 40%
  if (streak.consecutive >= 3) return 0.4;
  if (streak.consecutive >= 2) return 0.6;
  return 0.8;
}

// ─── Helper functions (duplicated from tradingEngine to keep module independent) ───

function calcRSI(closes: number[], period = 14): number {
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
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function emaCalc(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcMACD(closes: number[]) {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = emaCalc(closes, 12);
  const ema26 = emaCalc(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = emaCalc(macdLine.slice(-9), 9);
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { macd, signal, histogram: macd - signal };
}

function calcBB(closes: number[], period = 20, stdDev = 2) {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: mean + stdDev * std, middle: mean, lower: mean - stdDev * std };
}
