// ─── Auto-Convert ALL Coins to USDT ───
// v11.1.1: FIXED NaN qty bug — use walletBalance, validate everything, robust error handling
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
  free?: string;
}

// Bybit spot minimum order sizes and step sizes for common pairs
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

/**
 * Safe parse float — returns 0 if NaN/undefined/null/empty
 */
function safeFloat(val: string | number | undefined | null): number {
  if (val === undefined || val === null || val === "") return 0;
  const n = typeof val === "number" ? val : parseFloat(val);
  return isNaN(n) || !isFinite(n) ? 0 : n;
}

/**
 * Round down qty to the nearest valid step size for Bybit spot
 */
function roundToStepSize(qty: number, stepSize: number): number {
  if (isNaN(qty) || isNaN(stepSize) || stepSize <= 0 || qty <= 0) return 0;
  const decimals = Math.max(0, -Math.floor(Math.log10(stepSize)));
  const factor = Math.pow(10, decimals);
  return Math.floor(qty * factor) / factor;
}

/**
 * Get the number of decimal places for a step size
 */
function getDecimals(stepSize: number): number {
  if (isNaN(stepSize) || stepSize <= 0) return 2;
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

    return safeFloat(result[0]?.avgPrice);
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
        const minQty = safeFloat(lotFilter.minOrderQty);
        const stepSize = safeFloat(lotFilter.basePrecision) || safeFloat(lotFilter.minOrderQty);
        if (minQty > 0 && stepSize > 0) {
          return { minQty, stepSize };
        }
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
          
          // v11.1.1: Use walletBalance as primary (total coins held), 
          // fall back to availableToWithdraw, then free
          const walletBal = safeFloat(coin.walletBalance);
          const availBal = safeFloat(coin.availableToWithdraw);
          const freeBal = safeFloat(coin.free);
          const usdValue = safeFloat(coin.usdValue);
          
          // Use the best available qty — prefer availableToWithdraw (what we can actually sell),
          // but if it's 0 while walletBalance is positive, try walletBalance
          let sellQty = availBal > 0 ? availBal : (freeBal > 0 ? freeBal : walletBal);
          
          // Debug log for diagnosis
          console.log(`[AutoConvert] ${symbol}: walletBal=${walletBal}, availBal=${availBal}, free=${freeBal}, usdValue=${usdValue}, sellQty=${sellQty}`);
          
          // Skip dust (< $1) or zero balances
          if (usdValue < 1 || sellQty <= 0) {
            continue;
          }
          
          const pair = `${symbol}USDT`;
          
          // Calculate profit/loss for logging only
          const avgBuyPrice = await getAvgBuyPrice(engine.userId, pair);
          const currentPrice = sellQty > 0 ? usdValue / sellQty : 0;
          let profitInfo = "";
          
          if (avgBuyPrice > 0 && currentPrice > 0) {
            const profitPctNum = (currentPrice - avgBuyPrice) / avgBuyPrice;
            const pctStr = (profitPctNum * 100).toFixed(2);
            profitInfo = `${profitPctNum >= 0 ? "+" : ""}${pctStr}% (avg=$${avgBuyPrice.toFixed(4)})`;
          } else {
            profitInfo = "no buy history";
          }
          
          // v11.1.1: Get proper lot size — try hardcoded first (faster), then API
          let lotInfo = SPOT_LOT_SIZES[pair];
          if (!lotInfo) {
            const fetched = await fetchLotSize(engine.client, pair);
            if (fetched) {
              lotInfo = { ...fetched, minNotional: 1 };
              console.log(`[AutoConvert] ${symbol}: fetched lot size from API — minQty=${fetched.minQty}, stepSize=${fetched.stepSize}`);
            } else {
              // Conservative fallback
              lotInfo = { minQty: 0.01, stepSize: 0.01, minNotional: 1 };
              console.log(`[AutoConvert] ${symbol}: using fallback lot size — minQty=0.01, stepSize=0.01`);
            }
          }
          
          // Round down to valid step size
          const roundedQty = roundToStepSize(sellQty, lotInfo.stepSize);
          
          // v11.1.1: Validate roundedQty is not NaN or 0
          if (isNaN(roundedQty) || roundedQty <= 0) {
            console.log(`[AutoConvert] Bybit: SKIP ${symbol} — roundedQty is ${roundedQty} (NaN or 0), sellQty=${sellQty}, stepSize=${lotInfo.stepSize}`);
            continue;
          }
          
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
          
          // v11.1.1: FORCE SELL with properly formatted and validated qty
          try {
            const decimals = getDecimals(lotInfo.stepSize);
            const qtyStr = roundedQty.toFixed(decimals);
            
            // Final NaN check on the string
            if (qtyStr === "NaN" || qtyStr === "Infinity" || qtyStr === "0") {
              console.log(`[AutoConvert] Bybit: SKIP ${symbol} — qtyStr is "${qtyStr}" after formatting`);
              continue;
            }
            
            console.log(`[AutoConvert] Bybit: Selling ${qtyStr} ${symbol} (~$${usdValue.toFixed(2)}) — ${profitInfo}`);
            
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
              const retMsg = (sellRes as any).retMsg ?? "unknown";
              console.log(`[AutoConvert] Bybit: Sell failed for ${symbol} (retCode=${sellRes.retCode}, msg=${retMsg})`);
              
              // v11.1.1: If standard sell fails, try with explicit marketUnit=baseCoin
              if (sellRes.retCode === 170130 || sellRes.retCode === 170131) {
                try {
                  console.log(`[AutoConvert] Bybit: Retrying ${symbol} with marketUnit=baseCoin...`);
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
                    console.log(`[AutoConvert] ❌ Bybit: baseCoin also failed for ${symbol}: retCode=${sellRes2.retCode}, msg=${(sellRes2 as any).retMsg}`);
                    
                    // v11.1.1: Last resort — try selling by quoteCoin (USDT amount)
                    try {
                      const usdQty = Math.floor(usdValue * 0.98).toString(); // 2% buffer for slippage
                      console.log(`[AutoConvert] Bybit: Last resort — selling ${symbol} by quoteCoin amount $${usdQty}...`);
                      const sellRes3 = await withRetry(() => engine.client.submitOrder({
                        category: "spot",
                        symbol: pair,
                        side: "Sell",
                        orderType: "Market",
                        qty: usdQty,
                        marketUnit: "quoteCoin",
                      }), `AutoConvert Bybit sell ${symbol} (quoteCoin)`);
                      
                      if (sellRes3.retCode === 0 && sellRes3.result?.orderId) {
                        console.log(`[AutoConvert] ✅ Bybit: SOLD ${symbol} via quoteCoin (~$${usdQty}) — orderId: ${sellRes3.result.orderId}`);
                      } else {
                        console.log(`[AutoConvert] ❌ Bybit: ALL methods failed for ${symbol}: retCode=${sellRes3.retCode}, msg=${(sellRes3 as any).retMsg}`);
                      }
                    } catch (e3) {
                      console.log(`[AutoConvert] ❌ Bybit: quoteCoin sell failed for ${symbol}: ${(e3 as Error).message}`);
                    }
                  }
                } catch (e2) {
                  console.log(`[AutoConvert] ❌ Bybit: baseCoin sell failed for ${symbol}: ${(e2 as Error).message}`);
                }
              }
            }
          } catch (e) {
            console.log(`[AutoConvert] Bybit: Error selling ${symbol}: ${(e as Error).message}`);
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
            const bal = safeFloat(acc.available);
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
          
          if (avgBuyPrice > 0 && currentPrice > 0) {
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
