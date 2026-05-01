// ─── Auto-Convert Coins to USDT ───
// v12.0: Removed KuCoin, added whitelist protection for active trading coins
// Sells non-USDT spot coins to free capital for linear trading

import type { RestClientV5 } from "bybit-api";
import { getDb } from "./db";
import { trades } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

interface CoinBalance {
  coin: string;
  walletBalance: string;
  usdValue: string;
  availableToWithdraw: string;
  free?: string;
}

// Bybit spot minimum order sizes and step sizes
const SPOT_LOT_SIZES: Record<string, { minQty: number; stepSize: number; minNotional: number }> = {
  BTCUSDT:  { minQty: 0.000048, stepSize: 0.000001, minNotional: 1 },
  ETHUSDT:  { minQty: 0.00006,  stepSize: 0.00001,  minNotional: 1 },
  SOLUSDT:  { minQty: 0.01,     stepSize: 0.01,      minNotional: 1 },
  XRPUSDT:  { minQty: 0.1,      stepSize: 0.1,       minNotional: 1 },
  DOGEUSDT: { minQty: 1,        stepSize: 1,         minNotional: 1 },
  ADAUSDT:  { minQty: 1,        stepSize: 1,         minNotional: 1 },
  AVAXUSDT: { minQty: 0.01,     stepSize: 0.01,      minNotional: 1 },
  LINKUSDT: { minQty: 0.01,     stepSize: 0.01,      minNotional: 1 },
  ARBUSDT:  { minQty: 0.1,      stepSize: 0.1,       minNotional: 1 },
  SUIUSDT:  { minQty: 0.01,     stepSize: 0.01,      minNotional: 1 },
  PEPEUSDT: { minQty: 100,      stepSize: 100,       minNotional: 1 },
  SHIBUSDT: { minQty: 100,      stepSize: 100,       minNotional: 1 },
  WIFUSDT:  { minQty: 0.1,      stepSize: 0.1,       minNotional: 1 },
  FLOKIUSDT:{ minQty: 100,      stepSize: 100,       minNotional: 1 },
  BONKUSDT: { minQty: 100,      stepSize: 100,       minNotional: 1 },
};

// v12.0: Coins that should NEVER be auto-converted (active trading coins)
// These are the coins the bot actively trades on linear perpetuals.
// In a unified account, spot holdings of these coins serve as margin.
const PROTECTED_COINS = new Set(["BTC", "ETH", "SOL", "XAU"]);

function safeFloat(val: string | number | undefined | null): number {
  if (val === undefined || val === null || val === "") return 0;
  const n = typeof val === "number" ? val : parseFloat(val);
  return isNaN(n) || !isFinite(n) ? 0 : n;
}

function roundToStepSize(qty: number, stepSize: number): number {
  if (isNaN(qty) || isNaN(stepSize) || stepSize <= 0 || qty <= 0) return 0;
  const decimals = Math.max(0, -Math.floor(Math.log10(stepSize)));
  const factor = Math.pow(10, decimals);
  return Math.floor(qty * factor) / factor;
}

function getDecimals(stepSize: number): number {
  if (isNaN(stepSize) || stepSize <= 0) return 2;
  return Math.max(0, -Math.floor(Math.log10(stepSize)));
}

async function getAvgBuyPrice(userId: number, symbol: string): Promise<number> {
  try {
    const pair = symbol.includes("USDT") ? symbol : `${symbol}USDT`;
    const db = await getDb();
    if (!db) return 0;
    const result = await db
      .select({
        avgPrice: sql<string>`AVG(CAST(price AS DECIMAL(18,8)))`,
        totalQty: sql<string>`SUM(CAST(qty AS DECIMAL(18,8)))`,
      })
      .from(trades)
      .where(
        and(
          eq(trades.userId, userId),
          eq(trades.symbol, pair),
          eq(trades.side, "Buy"),
          eq(trades.simulated, false)
        )
      );
    return safeFloat(result[0]?.avgPrice);
  } catch (e) {
    console.log(`[AutoConvert] Cannot get avg buy price for ${symbol}: ${(e as Error).message}`);
    return 0;
  }
}

async function fetchLotSize(client: RestClientV5, pair: string): Promise<{ minQty: number; stepSize: number } | null> {
  try {
    const res = await client.getInstrumentsInfo({ category: "spot", symbol: pair });
    if (res.retCode === 0 && res.result?.list?.[0]) {
      const info = res.result.list[0] as any;
      const lotFilter = info.lotSizeFilter;
      if (lotFilter) {
        const minQty = safeFloat(lotFilter.minOrderQty);
        const stepSize = safeFloat(lotFilter.basePrecision) || safeFloat(lotFilter.minOrderQty);
        if (minQty > 0 && stepSize > 0) return { minQty, stepSize };
      }
    }
  } catch { /* use fallback */ }
  return null;
}

// Helper for retry logic (standalone, no import from tradingEngine to avoid circular deps)
async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error(`${label}: max retries exceeded`);
}

/**
 * v12.0: Auto-convert non-USDT spot coins to USDT
 * - Protects coins in PROTECTED_COINS set
 * - Bybit only (KuCoin removed)
 */
export async function autoConvertCoinsToUSDT(
  client: RestClientV5,
  userId: number,
  simulationMode: boolean
): Promise<void> {
  if (simulationMode) return;

  try {
    const res = await withRetry(() => client.getWalletBalance({ accountType: "UNIFIED" }), "AutoConvert getWalletBalance");
    if (res.retCode !== 0) return;

    const coins: CoinBalance[] = (res.result as any)?.list?.[0]?.coin ?? [];

    for (const coin of coins) {
      const symbol = coin.coin;

      // Skip stablecoins
      if (symbol === "USDT" || symbol === "USDC" || symbol === "USD") continue;

      // v12.0: Skip protected coins (active trading coins)
      if (PROTECTED_COINS.has(symbol)) {
        const usdValue = safeFloat(coin.usdValue);
        if (usdValue > 1) {
          console.log(`[AutoConvert] PROTECTED: ${symbol} ($${usdValue.toFixed(2)}) — skipping (active trading coin)`);
        }
        continue;
      }

      const walletBal = safeFloat(coin.walletBalance);
      const availBal = safeFloat(coin.availableToWithdraw);
      const freeBal = safeFloat(coin.free);
      const usdValue = safeFloat(coin.usdValue);

      let sellQty = availBal > 0 ? availBal : (freeBal > 0 ? freeBal : walletBal);

      console.log(`[AutoConvert] ${symbol}: walletBal=${walletBal}, availBal=${availBal}, usdValue=${usdValue}`);

      // Skip dust (< $1) or zero balances
      if (usdValue < 1 || sellQty <= 0) continue;

      const pair = `${symbol}USDT`;

      // Calculate profit/loss for logging
      const avgBuyPrice = await getAvgBuyPrice(userId, pair);
      const currentPrice = sellQty > 0 ? usdValue / sellQty : 0;
      let profitInfo = "";
      if (avgBuyPrice > 0 && currentPrice > 0) {
        const profitPctNum = (currentPrice - avgBuyPrice) / avgBuyPrice;
        profitInfo = `${profitPctNum >= 0 ? "+" : ""}${(profitPctNum * 100).toFixed(2)}%`;
      } else {
        profitInfo = "no buy history";
      }

      // Get lot size
      let lotInfo = SPOT_LOT_SIZES[pair];
      if (!lotInfo) {
        const fetched = await fetchLotSize(client, pair);
        if (fetched) {
          lotInfo = { ...fetched, minNotional: 1 };
        } else {
          lotInfo = { minQty: 0.01, stepSize: 0.01, minNotional: 1 };
        }
      }

      const roundedQty = roundToStepSize(sellQty, lotInfo.stepSize);
      if (isNaN(roundedQty) || roundedQty <= 0) continue;
      if (roundedQty < lotInfo.minQty) continue;
      if (usdValue < lotInfo.minNotional) continue;

      try {
        const decimals = getDecimals(lotInfo.stepSize);
        const qtyStr = roundedQty.toFixed(decimals);
        if (qtyStr === "NaN" || qtyStr === "Infinity" || qtyStr === "0") continue;

        console.log(`[AutoConvert] Selling ${qtyStr} ${symbol} (~$${usdValue.toFixed(2)}) — ${profitInfo}`);

        const sellRes = await withRetry(() => client.submitOrder({
          category: "spot",
          symbol: pair,
          side: "Sell",
          orderType: "Market",
          qty: qtyStr,
        }), `AutoConvert sell ${symbol}`);

        if (sellRes.retCode === 0 && sellRes.result?.orderId) {
          console.log(`[AutoConvert] Sold ${qtyStr} ${symbol} (~$${usdValue.toFixed(2)}) — ${profitInfo}`);
        } else {
          const retMsg = (sellRes as any).retMsg ?? "unknown";
          console.log(`[AutoConvert] Sell failed for ${symbol}: retCode=${sellRes.retCode}, msg=${retMsg}`);

          // Retry with marketUnit=baseCoin
          if (sellRes.retCode === 170130 || sellRes.retCode === 170131) {
            try {
              const sellRes2 = await withRetry(() => client.submitOrder({
                category: "spot", symbol: pair, side: "Sell",
                orderType: "Market", qty: qtyStr, marketUnit: "baseCoin",
              }), `AutoConvert sell ${symbol} (baseCoin)`);

              if (sellRes2.retCode === 0 && sellRes2.result?.orderId) {
                console.log(`[AutoConvert] Sold ${symbol} via baseCoin (~$${usdValue.toFixed(2)})`);
              } else {
                // Last resort: sell by quoteCoin
                try {
                  const usdQty = Math.floor(usdValue * 0.98).toString();
                  const sellRes3 = await withRetry(() => client.submitOrder({
                    category: "spot", symbol: pair, side: "Sell",
                    orderType: "Market", qty: usdQty, marketUnit: "quoteCoin",
                  }), `AutoConvert sell ${symbol} (quoteCoin)`);

                  if (sellRes3.retCode === 0 && sellRes3.result?.orderId) {
                    console.log(`[AutoConvert] Sold ${symbol} via quoteCoin (~$${usdQty})`);
                  } else {
                    console.log(`[AutoConvert] ALL methods failed for ${symbol}`);
                  }
                } catch (e3) {
                  console.log(`[AutoConvert] quoteCoin sell failed: ${(e3 as Error).message}`);
                }
              }
            } catch (e2) {
              console.log(`[AutoConvert] baseCoin sell failed: ${(e2 as Error).message}`);
            }
          }
        }
      } catch (e) {
        console.log(`[AutoConvert] Error selling ${symbol}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    console.error(`[AutoConvert] Error:`, (e as Error).message);
  }
}
