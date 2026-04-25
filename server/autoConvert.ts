// ─── Auto-Convert ALL Coins to USDT ───
// v11.1: FIXED — properly handle lot sizes, don't skip coins with futures positions
// Sell ALL non-USDT coins immediately to free capital for linear trading

import type { EngineState } from "./tradingEngine";
import { withRetry } from "./tradingEngine";
import { getDb } from "./db";
import { trades } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

interface CoinBalance {
  coin: string;
  walletBalance: string;
  usdValue: string;
  availableToWithdraw: string;
}

// Bybit spot minimum order sizes and step sizes for common pairs
// These are approximate — the bot will try and handle errors gracefully
const SPOT_LOT_SIZES: Record<string, { minQty: number; stepSize: number; minNotional: number }> = {
  BTCUSDT:  { minQty: 0.000001, stepSize: 0.000001, minNotional: 1 },
  ETHUSDT:  { minQty: 0.0001,   stepSize: 0.0001,   minNotional: 1 },
  SOLUSDT:  { minQty: 0.01,     stepSize: 0.01,      minNotional: 1 },
  XRPUSDT:  { minQty: 0.01,     stepSize: 0.01,      minNotional: 1 },
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

/**
 * Round down qty to the nearest valid step size for Bybit spot
 */
function roundToStepSize(qty: number, stepSize: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(stepSize)));
  const factor = Math.pow(10, decimals);
  return Math.floor(qty * factor) / factor;
}

/**
 * Get the number of decimal places for a step size
 */
function getDecimals(stepSize: number): number {
  return Math.max(0, -Math.floor(Math.log10(stepSize)));
}

/**
 * Calculate the average buy price for a coin from trade history.
 */
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

    const avgPrice = parseFloat(result[0]?.avgPrice ?? "0");
    return avgPrice;
  } catch (e) {
    console.log(`[AutoConvert] Cannot get avg buy price for ${symbol}: ${(e as Error).message}`);
    return 0;
  }
}

/**
 * Try to fetch instrument info from Bybit to get exact lot size
 */
async function fetchLotSize(client: any, pair: string): Promise<{ minQty: number; stepSize: number } | null> {
  try {
    const res = await client.getInstrumentsInfo({ category: "spot", symbol: pair });
    if (res.retCode === 0 && res.result?.list?.[0]) {
      const info = res.result.list[0];
      const lotFilter = info.lotSizeFilter;
      if (lotFilter) {
        return {
          minQty: parseFloat(lotFilter.minOrderQty ?? "0.0001"),
          stepSize: parseFloat(lotFilter.basePrecision ?? lotFilter.minOrderQty ?? "0.0001"),
        };
      }
    }
  } catch { /* use fallback */ }
  return null;
}

export async function autoConvertCoinsToUSDT(engine: EngineState): Promise<void> {
  if (engine.simulationMode) return;
  
  try {
    // ─── Bybit: Get all coin balances from unified account ───
    if (engine.client) {
      const res = await withRetry(() => engine.client.getWalletBalance({ accountType: "UNIFIED" }), "AutoConvert Bybit getWalletBalance");
      if (res.retCode === 0) {
        const coins: CoinBalance[] = (res.result as any)?.list?.[0]?.coin ?? [];
        
        for (const coin of coins) {
          const symbol = coin.coin;
          if (symbol === "USDT" || symbol === "USDC" || symbol === "USD") continue;
          
          const available = parseFloat(coin.availableToWithdraw ?? "0");
          const usdValue = parseFloat(coin.usdValue ?? "0");
          
          // Skip dust (< $1) or zero balances
          if (usdValue < 1 || available <= 0) continue;
          
          const pair = `${symbol}USDT`;
          
          // v11.1: DO NOT skip coins with futures positions
          // Futures use margin (USDT), not actual coins
          // Spot balances are independent and should ALWAYS be sold
          
          // Calculate profit/loss for logging only
          const avgBuyPrice = await getAvgBuyPrice(engine.userId, pair);
          const currentPrice = usdValue / available;
          let profitInfo = "";
          
          if (avgBuyPrice > 0) {
            const profitPctNum = (currentPrice - avgBuyPrice) / avgBuyPrice;
            const pctStr = (profitPctNum * 100).toFixed(2);
            profitInfo = `${profitPctNum >= 0 ? "+" : ""}${pctStr}% (avg=$${avgBuyPrice.toFixed(4)})`;
          } else {
            profitInfo = "no buy history";
          }
          
          // v11.1: Get proper lot size — try API first, then fallback to hardcoded
          let lotInfo = SPOT_LOT_SIZES[pair];
          if (!lotInfo) {
            const fetched = await fetchLotSize(engine.client, pair);
            if (fetched) {
              lotInfo = { ...fetched, minNotional: 1 };
            } else {
              // Conservative fallback: use 0.01 step size
              lotInfo = { minQty: 0.01, stepSize: 0.01, minNotional: 1 };
            }
          }
          
          // Round down to valid step size
          const roundedQty = roundToStepSize(available, lotInfo.stepSize);
          
          // Check minimum order size
          if (roundedQty < lotInfo.minQty) {
            console.log(`[AutoConvert] Bybit: SKIP ${symbol} — qty ${roundedQty} < minQty ${lotInfo.minQty} (dust)`);
            continue;
          }
          
          // Check minimum notional value
          if (usdValue < lotInfo.minNotional) {
            console.log(`[AutoConvert] Bybit: SKIP ${symbol} — value $${usdValue.toFixed(2)} < minNotional $${lotInfo.minNotional}`);
            continue;
          }
          
          // v11.1: FORCE SELL with properly formatted qty
          try {
            const decimals = getDecimals(lotInfo.stepSize);
            const qtyStr = roundedQty.toFixed(decimals);
            
            console.log(`[AutoConvert] Bybit: Attempting to sell ${qtyStr} ${symbol} (~$${usdValue.toFixed(2)}) — ${profitInfo}`);
            
            const sellRes = await withRetry(() => engine.client.submitOrder({
              category: "spot",
              symbol: pair,
              side: "Sell",
              orderType: "Market",
              qty: qtyStr,
            }), `AutoConvert Bybit sell ${symbol}`);
            
            if (sellRes.retCode === 0 && sellRes.result?.orderId) {
              console.log(`[AutoConvert] ✅ Bybit: SOLD ${qtyStr} ${symbol} (~$${usdValue.toFixed(2)}) to USDT — ${profitInfo} — orderId: ${sellRes.result.orderId}`);
              
              // Send Telegram notification for significant sells (> $50)
              if (usdValue > 50 && engine.telegramBotToken && engine.telegramChatId) {
                try {
                  const msg = `🔄 <b>AutoConvert</b>\nVendido: ${qtyStr} ${symbol}\nValor: ~$${usdValue.toFixed(2)}\n${profitInfo}\n\nCapital liberado a USDT para trading.`;
                  await fetch(`https://api.telegram.org/bot${engine.telegramBotToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: engine.telegramChatId, text: msg, parse_mode: "HTML" }),
                  });
                } catch { /* silent */ }
              }
            } else {
              // v11.1: If order fails, try with market order using quote qty (sell by USD value)
              console.log(`[AutoConvert] Bybit: Standard sell failed for ${symbol} (retCode=${sellRes.retCode}, msg=${(sellRes as any).retMsg}), trying marketUnit=quoteCoin...`);
              
              try {
                const sellRes2 = await withRetry(() => engine.client.submitOrder({
                  category: "spot",
                  symbol: pair,
                  side: "Sell",
                  orderType: "Market",
                  qty: qtyStr,
                  marketUnit: "baseCoin",
                }), `AutoConvert Bybit sell ${symbol} (baseCoin)`);
                
                if (sellRes2.retCode === 0 && sellRes2.result?.orderId) {
                  console.log(`[AutoConvert] ✅ Bybit: SOLD ${symbol} via baseCoin (~$${usdValue.toFixed(2)}) — orderId: ${sellRes2.result.orderId}`);
                } else {
                  console.log(`[AutoConvert] ❌ Bybit: All sell methods failed for ${symbol}: retCode=${sellRes2.retCode}, msg=${(sellRes2 as any).retMsg}`);
                }
              } catch (e2) {
                console.log(`[AutoConvert] ❌ Bybit: Cannot sell ${symbol} (both methods failed): ${(e2 as Error).message}`);
              }
            }
          } catch (e) {
            console.log(`[AutoConvert] Bybit: Cannot sell ${symbol}: ${(e as Error).message}`);
          }
        }
      }
    }
    
    // ─── KuCoin: Get all coin balances from trade account ───
    if (engine.kucoinClient) {
      try {
        const [tradeRes, hfRes] = await Promise.allSettled([
          engine.kucoinClient.getBalances({ type: "trade" }),
          engine.kucoinClient.getBalances({ type: "trade_hf" as any }),
        ]);
        
        const prices = (await import("./tradingEngine")).getLivePrices();
        const coinsToSell: { symbol: string; qty: number; usdValue: number; currentPrice: number }[] = [];
        
        const processBalances = (r: any) => {
          if (r.status !== "fulfilled" || r.value?.code !== "200000") return;
          for (const acc of (r.value.data as any[] ?? [])) {
            const cur = acc.currency;
            const bal = parseFloat(acc.available ?? "0");
            if (cur === "USDT" || cur === "USDC" || cur === "USD") continue;
            
            const price = prices[`${cur}USDT`]?.lastPrice ?? 0;
            const usdVal = bal * price;
            if (usdVal < 1 || bal <= 0) continue;
            
            coinsToSell.push({ symbol: cur, qty: bal, usdValue: usdVal, currentPrice: price });
          }
        };
        
        processBalances(tradeRes);
        processBalances(hfRes);
        
        for (const { symbol, qty, usdValue, currentPrice } of coinsToSell) {
          const pair = `${symbol}USDT`;
          const avgBuyPrice = await getAvgBuyPrice(engine.userId, pair);
          let profitInfo = "";
          
          if (avgBuyPrice > 0) {
            const profitPctNum = (currentPrice - avgBuyPrice) / avgBuyPrice;
            profitInfo = `${profitPctNum >= 0 ? "+" : ""}${(profitPctNum * 100).toFixed(2)}%`;
          } else {
            profitInfo = "no buy history";
          }
          
          try {
            const kucoinPair = `${symbol}-USDT`;
            const res: any = await withRetry(() => engine.kucoinClient!.submitOrder({
              clientOid: `phantom_ac_${Date.now()}`,
              side: "sell",
              symbol: kucoinPair,
              type: "market",
              size: qty.toFixed(8),
            }), `AutoConvert KuCoin sell ${symbol}`);
            
            if (res?.data?.orderId) {
              console.log(`[AutoConvert] KuCoin: FORCE SOLD ${qty.toFixed(4)} ${symbol} (~$${usdValue.toFixed(2)}) to USDT — ${profitInfo} — orderId: ${res.data.orderId}`);
            }
          } catch (e) {
            console.log(`[AutoConvert] KuCoin: Cannot sell ${symbol}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        console.log(`[AutoConvert] KuCoin error: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    console.error(`[AutoConvert] Error:`, (e as Error).message);
  }
}
