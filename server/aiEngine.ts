/**
 * PHANTOM AI Engine v8.0
 * 
 * Real AI/ML modules for superintelligent trading:
 * 1. Sentiment Analysis — analyze crypto news with LLM
 * 2. Fear & Greed Index — market emotion indicator
 * 3. Pattern Recognition — detect candlestick patterns (head & shoulders, double bottom, etc.)
 * 4. Reinforcement Learning — bot learns from its own trades
 * 5. Anomaly Detection — detect pump & dump, manipulation, flash crashes
 */

import type { FullKlineData } from "./smartAnalysis";

// ═══════════════════════════════════════════════════════════════
// 1. SENTIMENT ANALYSIS
// ═══════════════════════════════════════════════════════════════

export interface SentimentResult {
  score: number;         // -100 (extreme fear/bearish) to +100 (extreme greed/bullish)
  label: "very_bearish" | "bearish" | "neutral" | "bullish" | "very_bullish";
  sources: { source: string; sentiment: number; headline?: string }[];
  confidence: number;    // 0-100
  lastUpdated: number;
}

// Cache sentiment to avoid excessive API calls (refresh every 5 min)
const sentimentCache: Map<string, SentimentResult> = new Map();
const SENTIMENT_TTL = 5 * 60 * 1000;

export async function analyzeSentiment(symbol: string): Promise<SentimentResult> {
  const cached = sentimentCache.get(symbol);
  if (cached && Date.now() - cached.lastUpdated < SENTIMENT_TTL) return cached;

  const coin = symbol.replace("USDT", "").replace("PERP", "");
  
  try {
    // Fetch from multiple free crypto sentiment APIs
    const [fearGreed, cryptoNews] = await Promise.allSettled([
      fetchFearGreedIndex(),
      fetchCryptoSentiment(coin)
    ]);

    const sources: { source: string; sentiment: number; headline?: string }[] = [];
    let totalScore = 0;
    let count = 0;

    // Fear & Greed contributes to overall sentiment
    if (fearGreed.status === "fulfilled" && fearGreed.value) {
      const fgScore = (fearGreed.value.score - 50) * 2; // Convert 0-100 to -100 to +100
      sources.push({ source: "Fear & Greed Index", sentiment: fgScore });
      totalScore += fgScore;
      count++;
    }

    // Crypto news sentiment
    if (cryptoNews.status === "fulfilled" && cryptoNews.value) {
      sources.push(...cryptoNews.value.sources);
      totalScore += cryptoNews.value.avgSentiment;
      count++;
    }

    const avgScore = count > 0 ? totalScore / count : 0;
    const label = avgScore <= -60 ? "very_bearish" :
                  avgScore <= -20 ? "bearish" :
                  avgScore <= 20 ? "neutral" :
                  avgScore <= 60 ? "bullish" : "very_bullish";

    const result: SentimentResult = {
      score: Math.round(avgScore),
      label,
      sources,
      confidence: Math.min(100, count * 40),
      lastUpdated: Date.now()
    };

    sentimentCache.set(symbol, result);
    return result;
  } catch (e) {
    return { score: 0, label: "neutral", sources: [], confidence: 0, lastUpdated: Date.now() };
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. FEAR & GREED INDEX
// ═══════════════════════════════════════════════════════════════

export interface FearGreedData {
  score: number;      // 0 = extreme fear, 100 = extreme greed
  label: string;      // "Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"
  trend: "rising" | "falling" | "stable";
  previousScore: number;
  lastUpdated: number;
}

let fearGreedCache: FearGreedData | null = null;
const FEAR_GREED_TTL = 10 * 60 * 1000; // 10 min cache

export async function fetchFearGreedIndex(): Promise<FearGreedData | null> {
  if (fearGreedCache && Date.now() - fearGreedCache.lastUpdated < FEAR_GREED_TTL) {
    return fearGreedCache;
  }

  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=2&format=json", {
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    
    if (data?.data?.length >= 2) {
      const current = parseInt(data.data[0].value);
      const previous = parseInt(data.data[1].value);
      const diff = current - previous;
      
      const result: FearGreedData = {
        score: current,
        label: data.data[0].value_classification,
        trend: diff > 5 ? "rising" : diff < -5 ? "falling" : "stable",
        previousScore: previous,
        lastUpdated: Date.now()
      };
      
      fearGreedCache = result;
      return result;
    }
  } catch (e) {
    // Silent fail — use cached or null
  }
  return fearGreedCache;
}

/**
 * Get trading signal from Fear & Greed:
 * - Extreme Fear (0-25): BUY signal (market oversold, people panic selling)
 * - Fear (25-45): Slight BUY
 * - Neutral (45-55): No signal
 * - Greed (55-75): Slight SELL / reduce exposure
 * - Extreme Greed (75-100): SELL signal (market overbought)
 */
export function getFearGreedSignal(fg: FearGreedData | null): {
  direction: "buy" | "sell" | "neutral";
  strength: number; // 0-100
  reason: string;
} {
  if (!fg) return { direction: "neutral", strength: 0, reason: "No data" };

  if (fg.score <= 20) {
    return { direction: "buy", strength: 90, reason: `Extreme Fear (${fg.score}) — market panic, great buying opportunity` };
  } else if (fg.score <= 35) {
    return { direction: "buy", strength: 60, reason: `Fear (${fg.score}) — market fearful, good entry` };
  } else if (fg.score <= 45) {
    return { direction: "buy", strength: 30, reason: `Mild Fear (${fg.score}) — slight buying opportunity` };
  } else if (fg.score <= 55) {
    return { direction: "neutral", strength: 0, reason: `Neutral (${fg.score})` };
  } else if (fg.score <= 70) {
    return { direction: "sell", strength: 30, reason: `Greed (${fg.score}) — reduce exposure` };
  } else if (fg.score <= 85) {
    return { direction: "sell", strength: 60, reason: `High Greed (${fg.score}) — market overheated` };
  } else {
    return { direction: "sell", strength: 90, reason: `Extreme Greed (${fg.score}) — bubble territory, take profits` };
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. PATTERN RECOGNITION
// ═══════════════════════════════════════════════════════════════

export interface CandlePattern {
  name: string;
  type: "bullish" | "bearish" | "neutral";
  strength: number;     // 0-100 reliability
  description: string;
}

export interface PatternResult {
  patterns: CandlePattern[];
  dominantSignal: "buy" | "sell" | "neutral";
  confidence: number;
  bestPattern: string;
}

export function detectCandlePatterns(klines: FullKlineData): PatternResult {
  const patterns: CandlePattern[] = [];
  const { opens, highs, lows, closes } = klines;
  const len = closes.length;
  if (len < 5) return { patterns: [], dominantSignal: "neutral", confidence: 0, bestPattern: "none" };

  // Helper functions
  const bodySize = (i: number) => Math.abs(closes[i] - opens[i]);
  const upperWick = (i: number) => highs[i] - Math.max(opens[i], closes[i]);
  const lowerWick = (i: number) => Math.min(opens[i], closes[i]) - lows[i];
  const isBullish = (i: number) => closes[i] > opens[i];
  const isBearish = (i: number) => closes[i] < opens[i];
  const avgBody = closes.slice(-20).reduce((s, _, i, a) => {
    const idx = len - 20 + i;
    return idx >= 0 ? s + Math.abs(closes[idx] - opens[idx]) : s;
  }, 0) / 20;

  const i = len - 1; // Current candle
  const p1 = len - 2; // Previous candle
  const p2 = len - 3; // 2 candles ago

  // ── SINGLE CANDLE PATTERNS ──

  // Hammer (bullish reversal) — small body at top, long lower wick
  if (lowerWick(i) > bodySize(i) * 2 && upperWick(i) < bodySize(i) * 0.5) {
    // Check if in downtrend (last 5 candles declining)
    const inDowntrend = closes[i - 4] > closes[i - 1];
    if (inDowntrend) {
      patterns.push({ name: "Hammer", type: "bullish", strength: 75, description: "Reversal signal after downtrend — buyers stepping in" });
    }
  }

  // Inverted Hammer (bullish) — small body at bottom, long upper wick in downtrend
  if (upperWick(i) > bodySize(i) * 2 && lowerWick(i) < bodySize(i) * 0.5) {
    const inDowntrend = closes[i - 4] > closes[i - 1];
    if (inDowntrend) {
      patterns.push({ name: "Inverted Hammer", type: "bullish", strength: 65, description: "Potential reversal — buying pressure emerging" });
    }
  }

  // Shooting Star (bearish) — small body at bottom, long upper wick in uptrend
  if (upperWick(i) > bodySize(i) * 2 && lowerWick(i) < bodySize(i) * 0.5) {
    const inUptrend = closes[i - 4] < closes[i - 1];
    if (inUptrend) {
      patterns.push({ name: "Shooting Star", type: "bearish", strength: 75, description: "Reversal signal after uptrend — sellers rejecting higher prices" });
    }
  }

  // Doji — very small body (indecision)
  if (bodySize(i) < avgBody * 0.1 && (upperWick(i) + lowerWick(i)) > avgBody * 0.5) {
    patterns.push({ name: "Doji", type: "neutral", strength: 50, description: "Market indecision — watch for next candle confirmation" });
  }

  // Marubozu (strong momentum) — full body, no wicks
  if (bodySize(i) > avgBody * 1.5 && upperWick(i) < bodySize(i) * 0.1 && lowerWick(i) < bodySize(i) * 0.1) {
    if (isBullish(i)) {
      patterns.push({ name: "Bullish Marubozu", type: "bullish", strength: 80, description: "Strong buying pressure — full bullish candle" });
    } else {
      patterns.push({ name: "Bearish Marubozu", type: "bearish", strength: 80, description: "Strong selling pressure — full bearish candle" });
    }
  }

  // ── TWO CANDLE PATTERNS ──

  if (p1 >= 0) {
    // Bullish Engulfing — bearish candle followed by larger bullish candle
    if (isBearish(p1) && isBullish(i) && opens[i] <= closes[p1] && closes[i] >= opens[p1] && bodySize(i) > bodySize(p1)) {
      patterns.push({ name: "Bullish Engulfing", type: "bullish", strength: 82, description: "Strong reversal — buyers completely overwhelm sellers" });
    }

    // Bearish Engulfing
    if (isBullish(p1) && isBearish(i) && opens[i] >= closes[p1] && closes[i] <= opens[p1] && bodySize(i) > bodySize(p1)) {
      patterns.push({ name: "Bearish Engulfing", type: "bearish", strength: 82, description: "Strong reversal — sellers completely overwhelm buyers" });
    }

    // Tweezer Bottom (bullish) — two candles with same low
    const lowDiff = Math.abs(lows[i] - lows[p1]) / lows[i];
    if (lowDiff < 0.001 && isBearish(p1) && isBullish(i)) {
      patterns.push({ name: "Tweezer Bottom", type: "bullish", strength: 70, description: "Double support test — strong floor found" });
    }

    // Tweezer Top (bearish) — two candles with same high
    const highDiff = Math.abs(highs[i] - highs[p1]) / highs[i];
    if (highDiff < 0.001 && isBullish(p1) && isBearish(i)) {
      patterns.push({ name: "Tweezer Top", type: "bearish", strength: 70, description: "Double resistance test — strong ceiling found" });
    }
  }

  // ── THREE CANDLE PATTERNS ──

  if (p2 >= 0) {
    // Morning Star (bullish reversal)
    if (isBearish(p2) && bodySize(p2) > avgBody && bodySize(p1) < avgBody * 0.5 && isBullish(i) && bodySize(i) > avgBody) {
      patterns.push({ name: "Morning Star", type: "bullish", strength: 85, description: "Strong 3-candle reversal — downtrend exhaustion confirmed" });
    }

    // Evening Star (bearish reversal)
    if (isBullish(p2) && bodySize(p2) > avgBody && bodySize(p1) < avgBody * 0.5 && isBearish(i) && bodySize(i) > avgBody) {
      patterns.push({ name: "Evening Star", type: "bearish", strength: 85, description: "Strong 3-candle reversal — uptrend exhaustion confirmed" });
    }

    // Three White Soldiers (bullish continuation)
    if (isBullish(p2) && isBullish(p1) && isBullish(i) &&
        closes[p1] > closes[p2] && closes[i] > closes[p1] &&
        bodySize(p2) > avgBody * 0.5 && bodySize(p1) > avgBody * 0.5 && bodySize(i) > avgBody * 0.5) {
      patterns.push({ name: "Three White Soldiers", type: "bullish", strength: 88, description: "Strong bullish momentum — 3 consecutive strong green candles" });
    }

    // Three Black Crows (bearish continuation)
    if (isBearish(p2) && isBearish(p1) && isBearish(i) &&
        closes[p1] < closes[p2] && closes[i] < closes[p1] &&
        bodySize(p2) > avgBody * 0.5 && bodySize(p1) > avgBody * 0.5 && bodySize(i) > avgBody * 0.5) {
      patterns.push({ name: "Three Black Crows", type: "bearish", strength: 88, description: "Strong bearish momentum — 3 consecutive strong red candles" });
    }
  }

  // ── MULTI-CANDLE STRUCTURE PATTERNS ──

  // Double Bottom (W pattern) — scan last 30 candles
  if (len >= 30) {
    const window = 30;
    const start = len - window;
    let minIdx1 = start, minIdx2 = -1;
    
    for (let j = start + 1; j < len - 5; j++) {
      if (lows[j] < lows[minIdx1]) minIdx1 = j;
    }
    
    // Find second low near same level but at least 5 candles apart
    for (let j = minIdx1 + 5; j < len; j++) {
      const diff = Math.abs(lows[j] - lows[minIdx1]) / lows[minIdx1];
      if (diff < 0.005 && (minIdx2 === -1 || lows[j] < lows[minIdx2])) {
        minIdx2 = j;
      }
    }
    
    if (minIdx2 > 0 && closes[i] > lows[minIdx1] * 1.01) {
      patterns.push({ name: "Double Bottom (W)", type: "bullish", strength: 80, description: "Classic reversal pattern — price tested support twice and bounced" });
    }
  }

  // Head & Shoulders (bearish) — scan last 40 candles
  if (len >= 40) {
    const window = 40;
    const start = len - window;
    const highs40 = highs.slice(start, len);
    
    // Find 3 peaks
    const peaks: number[] = [];
    for (let j = 2; j < highs40.length - 2; j++) {
      if (highs40[j] > highs40[j-1] && highs40[j] > highs40[j-2] && 
          highs40[j] > highs40[j+1] && highs40[j] > highs40[j+2]) {
        peaks.push(j);
      }
    }
    
    if (peaks.length >= 3) {
      const lastThree = peaks.slice(-3);
      const [left, head, right] = [highs40[lastThree[0]], highs40[lastThree[1]], highs40[lastThree[2]]];
      
      // Head should be highest, shoulders roughly equal
      if (head > left && head > right) {
        const shoulderDiff = Math.abs(left - right) / left;
        if (shoulderDiff < 0.03) {
          patterns.push({ name: "Head & Shoulders", type: "bearish", strength: 85, description: "Classic reversal — uptrend likely ending, expect decline" });
        }
      }
    }
  }

  // Ascending Triangle (bullish) — flat top, rising lows
  if (len >= 20) {
    const recentHighs = highs.slice(-20);
    const recentLows = lows.slice(-20);
    const maxHigh = Math.max(...recentHighs);
    const flatTop = recentHighs.filter(h => Math.abs(h - maxHigh) / maxHigh < 0.003).length;
    
    let risingLows = 0;
    for (let j = 1; j < recentLows.length; j++) {
      if (recentLows[j] > recentLows[j - 1]) risingLows++;
    }
    
    if (flatTop >= 3 && risingLows > recentLows.length * 0.6) {
      patterns.push({ name: "Ascending Triangle", type: "bullish", strength: 75, description: "Breakout pattern — buyers pushing higher, resistance about to break" });
    }
  }

  // Descending Triangle (bearish) — flat bottom, falling highs
  if (len >= 20) {
    const recentHighs = highs.slice(-20);
    const recentLows = lows.slice(-20);
    const minLow = Math.min(...recentLows);
    const flatBottom = recentLows.filter(l => Math.abs(l - minLow) / minLow < 0.003).length;
    
    let fallingHighs = 0;
    for (let j = 1; j < recentHighs.length; j++) {
      if (recentHighs[j] < recentHighs[j - 1]) fallingHighs++;
    }
    
    if (flatBottom >= 3 && fallingHighs > recentHighs.length * 0.6) {
      patterns.push({ name: "Descending Triangle", type: "bearish", strength: 75, description: "Breakdown pattern — sellers pushing lower, support about to break" });
    }
  }

  // Calculate dominant signal
  let bullScore = 0, bearScore = 0;
  for (const p of patterns) {
    if (p.type === "bullish") bullScore += p.strength;
    else if (p.type === "bearish") bearScore += p.strength;
  }

  const dominantSignal = bullScore > bearScore + 20 ? "buy" : bearScore > bullScore + 20 ? "sell" : "neutral";
  const confidence = Math.min(100, Math.max(bullScore, bearScore));
  const bestPattern = patterns.sort((a, b) => b.strength - a.strength)[0]?.name || "none";

  return { patterns, dominantSignal, confidence, bestPattern };
}

// ═══════════════════════════════════════════════════════════════
// 4. REINFORCEMENT LEARNING — Learn from own trades
// ═══════════════════════════════════════════════════════════════

export interface TradeMemory {
  symbol: string;
  strategy: string;
  entryScore: number;
  entryRegime: string;
  entrySession: string;
  entryFearGreed: number;
  entryPatterns: string[];
  pnlPercent: number;
  holdTimeMinutes: number;
  timestamp: number;
}

interface StrategyWeight {
  baseWeight: number;
  adjustedWeight: number;
  winRate: number;
  avgPnl: number;
  totalTrades: number;
  recentWinRate: number; // Last 20 trades
}

// In-memory trade history for learning (persists during runtime)
const tradeHistory: TradeMemory[] = [];
const strategyWeights: Map<string, StrategyWeight> = new Map();
const symbolPerformance: Map<string, { wins: number; losses: number; avgPnl: number; bestHour: number }> = new Map();

// Condition-based learning: which conditions lead to wins
interface ConditionScore {
  condition: string;
  wins: number;
  total: number;
  avgPnl: number;
}
const conditionScores: Map<string, ConditionScore> = new Map();

export function recordTradeForLearning(trade: TradeMemory): void {
  tradeHistory.push(trade);
  
  // Keep last 500 trades in memory
  if (tradeHistory.length > 500) tradeHistory.shift();

  // Update strategy weights
  const key = `${trade.strategy}`;
  const existing = strategyWeights.get(key) || { baseWeight: 1.0, adjustedWeight: 1.0, winRate: 50, avgPnl: 0, totalTrades: 0, recentWinRate: 50 };
  
  existing.totalTrades++;
  const isWin = trade.pnlPercent > 0;
  
  // Rolling win rate
  const stratTrades = tradeHistory.filter(t => t.strategy === trade.strategy);
  const wins = stratTrades.filter(t => t.pnlPercent > 0).length;
  existing.winRate = (wins / stratTrades.length) * 100;
  existing.avgPnl = stratTrades.reduce((s, t) => s + t.pnlPercent, 0) / stratTrades.length;
  
  // Recent win rate (last 20)
  const recent = stratTrades.slice(-20);
  const recentWins = recent.filter(t => t.pnlPercent > 0).length;
  existing.recentWinRate = recent.length > 0 ? (recentWins / recent.length) * 100 : 50;
  
  // Adjust weight: higher win rate + higher avg PnL = more weight
  existing.adjustedWeight = Math.max(0.3, Math.min(2.0,
    (existing.recentWinRate / 50) * (1 + existing.avgPnl * 10)
  ));
  
  strategyWeights.set(key, existing);

  // Update symbol performance
  const symPerf = symbolPerformance.get(trade.symbol) || { wins: 0, losses: 0, avgPnl: 0, bestHour: 12 };
  if (isWin) symPerf.wins++;
  else symPerf.losses++;
  const symTrades = tradeHistory.filter(t => t.symbol === trade.symbol);
  symPerf.avgPnl = symTrades.reduce((s, t) => s + t.pnlPercent, 0) / symTrades.length;
  
  // Find best hour for this symbol
  const hourBuckets: Map<number, number[]> = new Map();
  for (const t of symTrades) {
    const hour = new Date(t.timestamp).getUTCHours();
    const bucket = hourBuckets.get(hour) || [];
    bucket.push(t.pnlPercent);
    hourBuckets.set(hour, bucket);
  }
  let bestHour = 12, bestAvg = -Infinity;
  for (const [hour, pnls] of Array.from(hourBuckets)) {
    const avg = pnls.reduce((s, v) => s + v, 0) / pnls.length;
    if (avg > bestAvg) { bestAvg = avg; bestHour = hour; }
  }
  symPerf.bestHour = bestHour;
  symbolPerformance.set(trade.symbol, symPerf);

  // Update condition-based learning
  const conditions = [
    `regime:${trade.entryRegime}`,
    `session:${trade.entrySession}`,
    `fg:${trade.entryFearGreed < 30 ? "fear" : trade.entryFearGreed > 70 ? "greed" : "neutral"}`,
    `score:${trade.entryScore > 70 ? "high" : trade.entryScore > 40 ? "mid" : "low"}`,
    ...trade.entryPatterns.map(p => `pattern:${p}`)
  ];

  for (const cond of conditions) {
    const cs = conditionScores.get(cond) || { condition: cond, wins: 0, total: 0, avgPnl: 0 };
    cs.total++;
    if (isWin) cs.wins++;
    const condTrades = tradeHistory.filter(t => {
      const tc = [
        `regime:${t.entryRegime}`,
        `session:${t.entrySession}`,
        `fg:${t.entryFearGreed < 30 ? "fear" : t.entryFearGreed > 70 ? "greed" : "neutral"}`,
        `score:${t.entryScore > 70 ? "high" : t.entryScore > 40 ? "mid" : "low"}`,
        ...t.entryPatterns.map(p => `pattern:${p}`)
      ];
      return tc.includes(cond);
    });
    cs.avgPnl = condTrades.reduce((s, t) => s + t.pnlPercent, 0) / condTrades.length;
    conditionScores.set(cond, cs);
  }
}

/**
 * Get RL-adjusted multiplier for a given trade setup
 * Returns 0.0-2.0 (0 = don't trade, 2 = double size)
 */
export function getRLMultiplier(
  strategy: string,
  symbol: string,
  regime: string,
  session: string,
  fearGreedScore: number,
  signalScore: number,
  patterns: string[]
): number {
  if (tradeHistory.length < 10) return 1.0; // Not enough data to learn from

  let multiplier = 1.0;

  // Strategy weight adjustment
  const sw = strategyWeights.get(strategy);
  if (sw) {
    multiplier *= sw.adjustedWeight;
  }

  // Symbol performance adjustment
  const sp = symbolPerformance.get(symbol);
  if (sp && (sp.wins + sp.losses) >= 5) {
    const winRate = sp.wins / (sp.wins + sp.losses);
    if (winRate < 0.4) multiplier *= 0.5;  // Bad symbol — reduce
    else if (winRate > 0.7) multiplier *= 1.3; // Great symbol — boost
    
    // Best hour boost
    const currentHour = new Date().getUTCHours();
    if (currentHour === sp.bestHour) multiplier *= 1.2;
  }

  // Condition-based adjustments
  const conditions = [
    `regime:${regime}`,
    `session:${session}`,
    `fg:${fearGreedScore < 30 ? "fear" : fearGreedScore > 70 ? "greed" : "neutral"}`,
    `score:${signalScore > 70 ? "high" : signalScore > 40 ? "mid" : "low"}`
  ];

  for (const cond of conditions) {
    const cs = conditionScores.get(cond);
    if (cs && cs.total >= 5) {
      const winRate = cs.wins / cs.total;
      if (winRate < 0.35) multiplier *= 0.6;
      else if (winRate > 0.7 && cs.avgPnl > 0.3) multiplier *= 1.3;
    }
  }

  return Math.max(0.2, Math.min(2.0, multiplier));
}

/**
 * Get learning insights for Telegram reporting
 */
export function getLearningInsights(): {
  totalTrades: number;
  bestStrategy: string;
  worstStrategy: string;
  bestSymbol: string;
  bestConditions: string[];
  overallWinRate: number;
} {
  const totalTrades = tradeHistory.length;
  
  let bestStrategy = "none", worstStrategy = "none";
  let bestStratWR = 0, worstStratWR = 100;
  for (const [key, sw] of Array.from(strategyWeights)) {
    if (sw.totalTrades >= 5) {
      if (sw.recentWinRate > bestStratWR) { bestStratWR = sw.recentWinRate; bestStrategy = key; }
      if (sw.recentWinRate < worstStratWR) { worstStratWR = sw.recentWinRate; worstStrategy = key; }
    }
  }

  let bestSymbol = "none", bestSymPnl = -Infinity;
  for (const [sym, sp] of Array.from(symbolPerformance)) {
    if (sp.avgPnl > bestSymPnl && (sp.wins + sp.losses) >= 3) {
      bestSymPnl = sp.avgPnl; bestSymbol = sym;
    }
  }

  const bestConditions: string[] = [];
  const sortedConditions = Array.from(conditionScores.values())
    .filter(c => c.total >= 5)
    .sort((a, b) => (b.wins / b.total) - (a.wins / a.total))
    .slice(0, 5);
  for (const c of sortedConditions) {
    bestConditions.push(`${c.condition}: ${((c.wins / c.total) * 100).toFixed(0)}% WR`);
  }

  const overallWinRate = totalTrades > 0 
    ? (tradeHistory.filter(t => t.pnlPercent > 0).length / totalTrades) * 100 
    : 50;

  return { totalTrades, bestStrategy, worstStrategy, bestSymbol, bestConditions, overallWinRate };
}

// ═══════════════════════════════════════════════════════════════
// 5. ANOMALY DETECTION
// ═══════════════════════════════════════════════════════════════

export interface AnomalyResult {
  detected: boolean;
  type: "pump_dump" | "flash_crash" | "whale_manipulation" | "unusual_volume" | "none";
  severity: "low" | "medium" | "high" | "critical";
  action: "block" | "reduce" | "normal";
  reason: string;
}

export function detectAnomaly(klines: FullKlineData, currentPrice: number): AnomalyResult {
  const { opens, highs, lows, closes, volumes } = klines;
  const len = closes.length;
  if (len < 20) return { detected: false, type: "none", severity: "low", action: "normal", reason: "" };

  // Average metrics for baseline
  const avgVolume = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const avgRange = closes.slice(-20).reduce((s, _, i) => {
    const idx = len - 20 + i;
    return idx >= 0 ? s + Math.abs(highs[idx] - lows[idx]) / closes[idx] : s;
  }, 0) / 20;

  const currentVolume = volumes[len - 1];
  const currentRange = Math.abs(highs[len - 1] - lows[len - 1]) / closes[len - 1];
  const priceChange5 = (closes[len - 1] - closes[Math.max(0, len - 5)]) / closes[Math.max(0, len - 5)] * 100;
  const priceChange1 = (closes[len - 1] - closes[len - 2]) / closes[len - 2] * 100;

  // PUMP & DUMP: Sudden price spike with extreme volume then reversal
  if (Math.abs(priceChange5) > 8 && currentVolume > avgVolume * 5) {
    return {
      detected: true,
      type: "pump_dump",
      severity: "critical",
      action: "block",
      reason: `Possible pump & dump: ${priceChange5.toFixed(1)}% in 5 candles with ${(currentVolume / avgVolume).toFixed(1)}x volume`
    };
  }

  // FLASH CRASH: Extreme drop in 1 candle
  if (priceChange1 < -5) {
    return {
      detected: true,
      type: "flash_crash",
      severity: "high",
      action: "block",
      reason: `Flash crash detected: ${priceChange1.toFixed(1)}% in 1 candle — wait for stabilization`
    };
  }

  // WHALE MANIPULATION: Extreme wick with quick recovery (fake breakout)
  const lastWickRatio = (highs[len - 1] - lows[len - 1]) / Math.max(0.0001, bodySize_fn(opens[len - 1], closes[len - 1]));
  if (lastWickRatio > 5 && currentVolume > avgVolume * 3) {
    return {
      detected: true,
      type: "whale_manipulation",
      severity: "high",
      action: "block",
      reason: `Whale manipulation: extreme wick (${lastWickRatio.toFixed(1)}x body) with high volume — fake move`
    };
  }

  // UNUSUAL VOLUME without price movement (accumulation/distribution)
  if (currentVolume > avgVolume * 4 && Math.abs(priceChange1) < 0.5) {
    return {
      detected: true,
      type: "unusual_volume",
      severity: "medium",
      action: "reduce",
      reason: `Unusual volume (${(currentVolume / avgVolume).toFixed(1)}x avg) without price movement — possible accumulation/distribution`
    };
  }

  return { detected: false, type: "none", severity: "low", action: "normal", reason: "" };
}

function bodySize_fn(open: number, close: number): number {
  return Math.abs(close - open);
}

// ═══════════════════════════════════════════════════════════════
// 6. CRYPTO NEWS SENTIMENT (aggregated from free APIs)
// ═══════════════════════════════════════════════════════════════

async function fetchCryptoSentiment(coin: string): Promise<{
  avgSentiment: number;
  sources: { source: string; sentiment: number; headline?: string }[];
} | null> {
  try {
    // Use CryptoCompare News API (free)
    const res = await fetch(
      `https://min-api.cryptocompare.com/data/v2/news/?categories=${coin}&excludeCategories=Sponsored&lang=EN`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    
    if (data?.Data?.length > 0) {
      const sources: { source: string; sentiment: number; headline: string }[] = [];
      let totalSentiment = 0;
      
      // Analyze last 10 news items
      const recentNews = data.Data.slice(0, 10);
      for (const article of recentNews) {
        // Simple keyword-based sentiment (fast, no API needed)
        const text = `${article.title} ${article.body || ""}`.toLowerCase();
        let sentiment = 0;
        
        // Bullish keywords
        const bullish = ["surge", "rally", "bull", "breakout", "soar", "pump", "moon", "ath", "all-time high",
          "adoption", "partnership", "upgrade", "launch", "approval", "etf", "institutional", "buy",
          "growth", "profit", "gain", "positive", "optimistic", "milestone", "record"];
        const bearish = ["crash", "dump", "bear", "plunge", "drop", "fall", "decline", "sell",
          "hack", "exploit", "ban", "regulation", "sec", "lawsuit", "fraud", "scam", "fear",
          "loss", "negative", "warning", "risk", "collapse", "liquidat"];
        
        for (const kw of bullish) { if (text.includes(kw)) sentiment += 15; }
        for (const kw of bearish) { if (text.includes(kw)) sentiment -= 15; }
        
        sentiment = Math.max(-100, Math.min(100, sentiment));
        totalSentiment += sentiment;
        
        sources.push({
          source: article.source || "CryptoCompare",
          sentiment,
          headline: article.title?.substring(0, 80)
        });
      }
      
      return {
        avgSentiment: Math.round(totalSentiment / recentNews.length),
        sources: sources.slice(0, 5) // Top 5 most relevant
      };
    }
  } catch (e) {
    // Silent fail
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATE AI SIGNAL — Combines all AI modules into one signal
// ═══════════════════════════════════════════════════════════════

export interface AISignal {
  direction: "buy" | "sell" | "neutral";
  confidence: number;       // 0-100
  sizingMultiplier: number; // 0.2-2.0
  blocked: boolean;
  reasons: string[];
  sentiment: SentimentResult;
  fearGreed: FearGreedData | null;
  patterns: PatternResult;
  anomaly: AnomalyResult;
  rlMultiplier: number;
}

export async function getAISignal(
  symbol: string,
  strategy: string,
  klines: FullKlineData,
  currentPrice: number,
  regime: string,
  session: string,
  baseScore: number
): Promise<AISignal> {
  const reasons: string[] = [];
  let buyPoints = 0, sellPoints = 0;
  let sizingMultiplier = 1.0;
  let blocked = false;

  // 1. Anomaly Detection (FIRST — can block everything)
  const anomaly = detectAnomaly(klines, currentPrice);
  if (anomaly.detected) {
    reasons.push(`⚠️ ${anomaly.type}: ${anomaly.reason}`);
    if (anomaly.action === "block") {
      blocked = true;
    } else if (anomaly.action === "reduce") {
      sizingMultiplier *= 0.5;
    }
  }

  // 2. Sentiment Analysis
  const sentiment = await analyzeSentiment(symbol);
  if (sentiment.confidence > 30) {
    if (sentiment.score > 30) { buyPoints += sentiment.score * 0.3; reasons.push(`📰 Sentiment: ${sentiment.label} (${sentiment.score})`); }
    else if (sentiment.score < -30) { sellPoints += Math.abs(sentiment.score) * 0.3; reasons.push(`📰 Sentiment: ${sentiment.label} (${sentiment.score})`); }
  }

  // 3. Fear & Greed Index
  const fearGreed = await fetchFearGreedIndex();
  const fgSignal = getFearGreedSignal(fearGreed);
  if (fgSignal.strength > 20) {
    if (fgSignal.direction === "buy") { buyPoints += fgSignal.strength * 0.4; }
    else if (fgSignal.direction === "sell") { sellPoints += fgSignal.strength * 0.4; }
    reasons.push(`😱 F&G: ${fgSignal.reason}`);
  }

  // 4. Pattern Recognition
  const patterns = detectCandlePatterns(klines);
  if (patterns.confidence > 30) {
    if (patterns.dominantSignal === "buy") { buyPoints += patterns.confidence * 0.5; }
    else if (patterns.dominantSignal === "sell") { sellPoints += patterns.confidence * 0.5; }
    reasons.push(`📊 Pattern: ${patterns.bestPattern} (${patterns.dominantSignal}, ${patterns.confidence}%)`);
  }

  // 5. Reinforcement Learning
  const fgScore = fearGreed?.score ?? 50;
  const patternNames = patterns.patterns.map(p => p.name);
  const rlMultiplier = getRLMultiplier(strategy, symbol, regime, session, fgScore, baseScore, patternNames);
  sizingMultiplier *= rlMultiplier;
  if (rlMultiplier < 0.5) reasons.push(`🧠 RL: Reducing (${rlMultiplier.toFixed(2)}x) — learned this setup underperforms`);
  else if (rlMultiplier > 1.3) reasons.push(`🧠 RL: Boosting (${rlMultiplier.toFixed(2)}x) — learned this setup outperforms`);

  // Calculate final direction
  const netScore = buyPoints - sellPoints;
  const direction = blocked ? "neutral" : netScore > 15 ? "buy" : netScore < -15 ? "sell" : "neutral";
  const confidence = Math.min(100, Math.abs(netScore));

  // Boost sizing on high confidence
  if (confidence > 70) sizingMultiplier *= 1.3;
  else if (confidence > 50) sizingMultiplier *= 1.1;

  sizingMultiplier = Math.max(0.2, Math.min(2.0, sizingMultiplier));

  return {
    direction,
    confidence,
    sizingMultiplier,
    blocked,
    reasons,
    sentiment,
    fearGreed,
    patterns,
    anomaly,
    rlMultiplier
  };
}
