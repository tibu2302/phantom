/**
 * PHANTOM v12.3 — Volatility Scanner AI
 * 
 * Scans ALL Bybit linear perpetual pairs to detect:
 * 1. Pumped coins (overextended, ready to dump)
 * 2. Extreme funding rates (everyone long → short opportunity)
 * 3. Volume spikes (hype coins that will retrace)
 * 4. High open interest + price spike (liquidation cascade risk)
 * 
 * Strategy: SHORT overextended coins and ride the dump
 */

import { RestClientV5 } from "bybit-api";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ScanResult {
  symbol: string;
  lastPrice: number;
  change24h: number;        // % change in 24h
  change1h: number;         // % change in 1h (estimated from prevPrice1h)
  volume24h: number;        // USDT volume
  openInterest: number;     // USDT OI
  fundingRate: number;      // Current funding rate
  highLowRange: number;     // (high - low) / low * 100 — daily volatility %
  shortScore: number;       // 0-100 composite score for shorting
  reasons: string[];        // Why this coin is a short candidate
  riskLevel: "low" | "medium" | "high" | "extreme";
  suggestedLeverage: number;
  suggestedEntry: "market" | "limit_high";
  suggestedTP: number;      // % take profit
  suggestedSL: number;      // % stop loss (for emergency only)
}

export interface ScannerConfig {
  minChange24h: number;     // Min 24h pump % to consider (default 10%)
  minVolume: number;        // Min 24h volume in USDT (default 5M)
  minScore: number;         // Min short score to signal (default 60)
  maxResults: number;       // Max results to return (default 5)
  blacklist: string[];      // Symbols to never short
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: ScannerConfig = {
  minChange24h: 8,          // At least 8% pump in 24h
  minVolume: 3_000_000,     // At least $3M volume
  minScore: 40,             // Lowered from 55 - more opportunities
  maxResults: 5,            // Top 5 opportunities
  blacklist: [
    "BTCUSDT", "ETHUSDT",   // Too big to dump hard
    "USDCUSDT", "DAIUSDT",  // Stablecoins
  ],
};

// Coins known to pump and dump frequently (bonus score)
const PUMP_DUMP_HISTORY = [
  "LABUSDT", "PEPEUSDT", "FLOKIUSDT", "SHIBUSDT", "DOGEUSDT",
  "BONKUSDT", "WIFUSDT", "BRETTUSDT", "MEMEUSDT", "TURBOUSDT",
  "ORDIUSDT", "SATSUSDT", "RATSUSDT", "1000PEPEUSDT",
  "SUIUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "TIAUSDT",
  "JUPUSDT", "WUSDT", "STRKUSDT", "PIXELUSDT", "PORTALUSDT",
];

// ═══════════════════════════════════════════════════════════════
// MAIN SCANNER FUNCTION
// ═══════════════════════════════════════════════════════════════

export async function scanVolatileCoins(
  client: RestClientV5,
  config: Partial<ScannerConfig> = {}
): Promise<ScanResult[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  try {
    // 1. Get ALL linear perpetual tickers
    const res = await client.getTickers({ category: "linear" });
    if (res.retCode !== 0 || !res.result?.list) {
      console.log("[Scanner] Failed to get tickers:", res.retMsg);
      return [];
    }

    const tickers = res.result.list;
    console.log(`[Scanner] 🔍 Scanning ${tickers.length} perpetual pairs...`);

    // 2. Filter and score each ticker
    const candidates: ScanResult[] = [];

    for (const t of tickers) {
      const symbol = t.symbol;
      
      // Skip blacklisted
      if (cfg.blacklist.includes(symbol)) continue;
      
      // Skip non-USDT pairs
      if (!symbol.endsWith("USDT")) continue;

      const lastPrice = parseFloat(t.lastPrice) || 0;
      const prevPrice24h = parseFloat(t.prevPrice24h) || 0;
      const prevPrice1h = parseFloat(t.prevPrice1h) || 0;
      const highPrice24h = parseFloat(t.highPrice24h) || 0;
      const lowPrice24h = parseFloat(t.lowPrice24h) || 0;
      const volume24h = parseFloat(t.turnover24h) || 0; // turnover is in USDT
      const openInterest = parseFloat(t.openInterestValue) || 0;
      const fundingRate = parseFloat(t.fundingRate) || 0;

      // Calculate metrics
      const change24h = prevPrice24h > 0 ? ((lastPrice - prevPrice24h) / prevPrice24h) * 100 : 0;
      const change1h = prevPrice1h > 0 ? ((lastPrice - prevPrice1h) / prevPrice1h) * 100 : 0;
      const highLowRange = lowPrice24h > 0 ? ((highPrice24h - lowPrice24h) / lowPrice24h) * 100 : 0;

      // Filter: must be pumping and have volume
      if (change24h < cfg.minChange24h) continue;
      if (volume24h < cfg.minVolume) continue;

      // 3. Calculate SHORT SCORE (0-100)
      const { score, reasons } = calculateShortScore({
        symbol, lastPrice, change24h, change1h, highPrice24h, lowPrice24h,
        volume24h, openInterest, fundingRate, highLowRange,
      });

      if (score < cfg.minScore) continue;

      // 4. Determine risk level and parameters
      const riskLevel = score >= 85 ? "extreme" : score >= 70 ? "high" : score >= 60 ? "medium" : "low";
      
      // Leverage: more confident = more leverage, but cap at 10x
      const suggestedLeverage = riskLevel === "extreme" ? 5 :
                                 riskLevel === "high" ? 4 :
                                 riskLevel === "medium" ? 3 : 2;

      // TP/SL based on how overextended it is
      const suggestedTP = Math.min(change24h * 0.3, 15); // Take 30% of the pump as profit, max 15%
      const suggestedSL = Math.min(change24h * 0.15, 8); // SL at 15% of pump, max 8%

      // Entry: if still pumping hard (1h > 3%), wait for limit; otherwise market
      const suggestedEntry = change1h > 3 ? "limit_high" : "market";

      candidates.push({
        symbol, lastPrice, change24h, change1h, volume24h, openInterest,
        fundingRate, highLowRange, shortScore: score, reasons, riskLevel,
        suggestedLeverage, suggestedEntry, suggestedTP, suggestedSL,
      });
    }

    // 5. Sort by score descending, return top N
    candidates.sort((a, b) => b.shortScore - a.shortScore);
    const results = candidates.slice(0, cfg.maxResults);

    if (results.length > 0) {
      console.log(`[Scanner] 🎯 Found ${results.length} short opportunities:`);
      for (const r of results) {
        console.log(`  ${r.symbol}: score=${r.shortScore} | +${r.change24h.toFixed(1)}% 24h | vol=$${(r.volume24h/1e6).toFixed(1)}M | funding=${(r.fundingRate*100).toFixed(4)}% | risk=${r.riskLevel}`);
      }
    } else {
      console.log(`[Scanner] No short opportunities found (min score: ${cfg.minScore})`);
    }

    return results;
  } catch (err: any) {
    console.log(`[Scanner] Error: ${err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// SCORING ALGORITHM
// ═══════════════════════════════════════════════════════════════

interface ScoreInput {
  symbol: string;
  lastPrice: number;
  change24h: number;
  change1h: number;
  highPrice24h: number;
  lowPrice24h: number;
  volume24h: number;
  openInterest: number;
  fundingRate: number;
  highLowRange: number;
}

function calculateShortScore(input: ScoreInput): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // ── 1. PUMP MAGNITUDE (0-25 points) ──
  // Bigger pump = more likely to retrace
  if (input.change24h >= 50) {
    score += 25;
    reasons.push(`🚀 Extreme pump +${input.change24h.toFixed(1)}% (25pts)`);
  } else if (input.change24h >= 30) {
    score += 20;
    reasons.push(`🚀 Major pump +${input.change24h.toFixed(1)}% (20pts)`);
  } else if (input.change24h >= 20) {
    score += 15;
    reasons.push(`📈 Strong pump +${input.change24h.toFixed(1)}% (15pts)`);
  } else if (input.change24h >= 10) {
    score += 10;
    reasons.push(`📈 Moderate pump +${input.change24h.toFixed(1)}% (10pts)`);
  } else {
    score += 5;
    reasons.push(`📈 Small pump +${input.change24h.toFixed(1)}% (5pts)`);
  }

  // ── 2. EXHAUSTION SIGNAL (0-20 points) ──
  // If price is near the high but 1h change is slowing/negative = exhaustion
  const distFromHigh = input.highPrice24h > 0 
    ? ((input.highPrice24h - input.lastPrice) / input.highPrice24h) * 100 
    : 0;
  
  if (distFromHigh > 5 && input.change1h < 0) {
    // Already dumping from high
    score += 20;
    reasons.push(`💀 Dumping from high: -${distFromHigh.toFixed(1)}% from ATH, 1h=${input.change1h.toFixed(1)}% (20pts)`);
  } else if (distFromHigh > 3) {
    score += 15;
    reasons.push(`📉 Pulling back from high: -${distFromHigh.toFixed(1)}% from peak (15pts)`);
  } else if (input.change1h < -1) {
    score += 12;
    reasons.push(`📉 1h reversal: ${input.change1h.toFixed(1)}% (12pts)`);
  } else if (input.change1h < 0) {
    score += 8;
    reasons.push(`⚠️ 1h momentum fading: ${input.change1h.toFixed(1)}% (8pts)`);
  } else if (input.change1h > 5) {
    // Still pumping hard — risky to short now
    score -= 5;
    reasons.push(`⚠️ Still pumping hard 1h: +${input.change1h.toFixed(1)}% (-5pts, risky)`);
  }

  // ── 3. FUNDING RATE (0-20 points) ──
  // High positive funding = everyone is long = short opportunity
  const fundingPct = input.fundingRate * 100;
  if (fundingPct > 0.1) {
    score += 20;
    reasons.push(`💰 Extreme funding: ${fundingPct.toFixed(4)}% — longs paying shorts (20pts)`);
  } else if (fundingPct > 0.05) {
    score += 15;
    reasons.push(`💰 High funding: ${fundingPct.toFixed(4)}% (15pts)`);
  } else if (fundingPct > 0.02) {
    score += 10;
    reasons.push(`💰 Elevated funding: ${fundingPct.toFixed(4)}% (10pts)`);
  } else if (fundingPct < -0.05) {
    // Negative funding = shorts are paying, bad to short
    score -= 10;
    reasons.push(`⚠️ Negative funding: ${fundingPct.toFixed(4)}% — shorts paying (-10pts)`);
  }

  // ── 4. VOLATILITY RANGE (0-15 points) ──
  // High daily range = volatile, good for shorts
  if (input.highLowRange > 30) {
    score += 15;
    reasons.push(`🌊 Extreme volatility: ${input.highLowRange.toFixed(1)}% range (15pts)`);
  } else if (input.highLowRange > 20) {
    score += 12;
    reasons.push(`🌊 High volatility: ${input.highLowRange.toFixed(1)}% range (12pts)`);
  } else if (input.highLowRange > 10) {
    score += 8;
    reasons.push(`🌊 Good volatility: ${input.highLowRange.toFixed(1)}% range (8pts)`);
  }

  // ── 5. VOLUME vs OI RATIO (0-10 points) ──
  // High volume relative to OI = speculative frenzy
  if (input.openInterest > 0) {
    const volOiRatio = input.volume24h / input.openInterest;
    if (volOiRatio > 5) {
      score += 10;
      reasons.push(`🔥 Speculative frenzy: vol/OI=${volOiRatio.toFixed(1)}x (10pts)`);
    } else if (volOiRatio > 3) {
      score += 7;
      reasons.push(`🔥 High speculation: vol/OI=${volOiRatio.toFixed(1)}x (7pts)`);
    } else if (volOiRatio > 2) {
      score += 4;
      reasons.push(`📊 Elevated activity: vol/OI=${volOiRatio.toFixed(1)}x (4pts)`);
    }
  }

  // ── 6. KNOWN PUMP-DUMP COIN BONUS (0-10 points) ──
  if (PUMP_DUMP_HISTORY.includes(input.symbol)) {
    score += 10;
    reasons.push(`🎰 Known pump-dump coin (10pts bonus)`);
  }

  // ── 7. OPEN INTEREST SPIKE (0-10 points) ──
  // High OI with high price = lots of leveraged longs that will get liquidated
  if (input.openInterest > 50_000_000 && input.change24h > 15) {
    score += 10;
    reasons.push(`💣 High OI ($${(input.openInterest/1e6).toFixed(0)}M) + pump = liquidation risk (10pts)`);
  } else if (input.openInterest > 20_000_000 && input.change24h > 10) {
    score += 6;
    reasons.push(`💣 Elevated OI ($${(input.openInterest/1e6).toFixed(0)}M) + pump (6pts)`);
  }

  // Cap score at 100
  score = Math.max(0, Math.min(100, score));

  return { score, reasons };
}

// ═══════════════════════════════════════════════════════════════
// QUICK SCAN (lighter version for frequent checks)
// ═══════════════════════════════════════════════════════════════

export async function quickScanTopMovers(
  client: RestClientV5,
  topN: number = 10
): Promise<{ symbol: string; change24h: number; volume: number; funding: number }[]> {
  try {
    const res = await client.getTickers({ category: "linear" });
    if (res.retCode !== 0 || !res.result?.list) return [];

    const movers = res.result.list
      .filter(t => t.symbol.endsWith("USDT") && !DEFAULT_CONFIG.blacklist.includes(t.symbol))
      .map(t => ({
        symbol: t.symbol,
        change24h: parseFloat(t.price24hPcnt) * 100,
        volume: parseFloat(t.turnover24h) || 0,
        funding: parseFloat(t.fundingRate) || 0,
      }))
      .filter(t => t.change24h > 5 && t.volume > 1_000_000)
      .sort((a, b) => b.change24h - a.change24h)
      .slice(0, topN);

    return movers;
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// KLINE CONFIRMATION (deeper analysis for top candidates)
// ═══════════════════════════════════════════════════════════════

export async function confirmShortWithKlines(
  client: RestClientV5,
  symbol: string
): Promise<{ confirmed: boolean; confidence: number; reason: string }> {
  try {
    // Get 15m klines for the last 4 hours
    const res = await client.getKline({ category: "linear", symbol, interval: "15", limit: 16 });
    if (res.retCode !== 0 || !res.result?.list || res.result.list.length < 10) {
      return { confirmed: false, confidence: 0, reason: "Insufficient kline data" };
    }

    const klines = res.result.list.reverse(); // oldest first
    const closes = klines.map(k => parseFloat(k[4]));
    const highs = klines.map(k => parseFloat(k[2]));
    const volumes = klines.map(k => parseFloat(k[5]));

    // Check for bearish divergence: price making new highs but volume decreasing
    const recentHighs = highs.slice(-4);
    const recentVols = volumes.slice(-4);
    const priceIncreasing = recentHighs[3] >= recentHighs[0];
    const volumeDecreasing = recentVols[3] < recentVols[0] * 0.7;
    const bearishDivergence = priceIncreasing && volumeDecreasing;

    // Check for topping pattern: long upper wicks
    const lastCandle = klines[klines.length - 1];
    const open = parseFloat(lastCandle[1]);
    const high = parseFloat(lastCandle[2]);
    const low = parseFloat(lastCandle[3]);
    const close = parseFloat(lastCandle[4]);
    const body = Math.abs(close - open);
    const upperWick = high - Math.max(open, close);
    const longUpperWick = upperWick > body * 2;

    // Check for RSI overbought (simple calculation)
    let gains = 0, losses = 0;
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / (closes.length - 1);
    const avgLoss = losses / (closes.length - 1);
    const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
    const rsi = 100 - (100 / (1 + rs));
    const rsiOverbought = rsi > 75;

    // Check for price far from recent average (mean reversion signal)
    const avg = closes.reduce((a, b) => a + b, 0) / closes.length;
    const deviation = ((closes[closes.length - 1] - avg) / avg) * 100;
    const farFromMean = deviation > 5;

    // Composite confirmation
    let confidence = 0;
    const confirmReasons: string[] = [];

    if (bearishDivergence) { confidence += 30; confirmReasons.push("bearish volume divergence"); }
    if (longUpperWick) { confidence += 20; confirmReasons.push("long upper wick (rejection)"); }
    if (rsiOverbought) { confidence += 25; confirmReasons.push(`RSI overbought (${rsi.toFixed(0)})`); }
    if (farFromMean) { confidence += 25; confirmReasons.push(`far from mean (+${deviation.toFixed(1)}%)`); }

    const confirmed = confidence >= 25; // Lowered from 40 - too restrictive
    const reason = confirmed 
      ? `Confirmed: ${confirmReasons.join(", ")}` 
      : `Not confirmed (score ${confidence}/25): ${confirmReasons.join(", ") || "no bearish signals"}`;

    return { confirmed, confidence, reason };
  } catch (err: any) {
    return { confirmed: false, confidence: 0, reason: `Error: ${err.message}` };
  }
}
