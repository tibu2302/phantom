/**
 * PHANTOM Test Trade Script
 * Executes a real BUY + SELL of minimum BTC/USDT on Bybit Spot
 * to verify API keys and order execution work correctly.
 * 
 * Usage: node scripts/test-trade.mjs
 * (Run inside Docker: docker compose exec app node scripts/test-trade.mjs)
 */
import { RestClientV5 } from "bybit-api";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  PHANTOM — Test Trade (Bybit Spot BTC/USDT)");
  console.log("═══════════════════════════════════════════════\n");

  // 1. Get Bybit API keys from DB
  console.log("[1/6] Connecting to database...");
  const conn = await mysql.createConnection(DATABASE_URL);
  const [rows] = await conn.execute(
    "SELECT apiKey, apiSecret FROM api_keys WHERE exchange = 'bybit' LIMIT 1"
  );
  await conn.end();

  if (!rows || rows.length === 0) {
    console.error("ERROR: No Bybit API keys found in database!");
    process.exit(1);
  }

  const { apiKey, apiSecret } = rows[0];
  console.log(`   API Key: ${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`);
  console.log("   Keys loaded OK ✓\n");

  // 2. Initialize Bybit client
  console.log("[2/6] Initializing Bybit client...");
  const client = new RestClientV5({ key: apiKey, secret: apiSecret });

  // 3. Check wallet balance
  console.log("[3/6] Checking USDT balance...");
  const balRes = await client.getWalletBalance({ accountType: "UNIFIED" });
  const coins = balRes.result?.list?.[0]?.coin || [];
  const usdtCoin = coins.find(c => c.coin === "USDT");
  const usdtBalance = parseFloat(usdtCoin?.walletBalance || "0");
  console.log(`   USDT Balance: $${usdtBalance.toFixed(2)}`);

  if (usdtBalance < 10) {
    console.error("ERROR: Need at least $10 USDT. Current balance: $" + usdtBalance.toFixed(2));
    process.exit(1);
  }

  // 4. Get current BTC price
  console.log("\n[4/6] Getting BTC/USDT price...");
  const tickerRes = await client.getTickers({ category: "spot", symbol: "BTCUSDT" });
  const btcPrice = parseFloat(tickerRes.result?.list?.[0]?.lastPrice || "0");
  console.log(`   BTC Price: $${btcPrice.toFixed(2)}`);

  // Calculate minimum qty (~$11 worth to be safe above Bybit's $10 min)
  // Bybit minimum for BTC spot is 0.000011 BTC
  const targetUsd = 11;
  let qty = (targetUsd / btcPrice).toFixed(6);
  // Ensure minimum 0.000011
  if (parseFloat(qty) < 0.000011) qty = "0.000011";
  const estimatedCost = (parseFloat(qty) * btcPrice).toFixed(2);
  console.log(`   Order qty: ${qty} BTC (~$${estimatedCost})\n`);

  // 5. Place BUY order
  console.log("[5/6] Placing BUY order (Market)...");
  try {
    const buyRes = await client.submitOrder({
      category: "spot",
      symbol: "BTCUSDT",
      side: "Buy",
      orderType: "Market",
      qty: qty,
    });
    console.log(`   Buy Result:`, JSON.stringify(buyRes.result, null, 2));
    if (buyRes.retCode !== 0) {
      console.error(`   BUY FAILED: ${buyRes.retMsg}`);
      process.exit(1);
    }
    console.log(`   BUY ORDER OK ✓ — orderId: ${buyRes.result?.orderId}\n`);

    // Wait 2 seconds for fill
    console.log("   Waiting 2s for fill...");
    await new Promise(r => setTimeout(r, 2000));

    // 6. Place SELL order (sell all BTC we just bought)
    console.log("[6/6] Placing SELL order (Market)...");
    const sellRes = await client.submitOrder({
      category: "spot",
      symbol: "BTCUSDT",
      side: "Sell",
      orderType: "Market",
      qty: qty,
    });
    console.log(`   Sell Result:`, JSON.stringify(sellRes.result, null, 2));
    if (sellRes.retCode !== 0) {
      console.error(`   SELL FAILED: ${sellRes.retMsg}`);
      console.log("   NOTE: You may have BTC that needs to be sold manually.");
      process.exit(1);
    }
    console.log(`   SELL ORDER OK ✓ — orderId: ${sellRes.result?.orderId}\n`);

  } catch (e) {
    console.error("ORDER ERROR:", e.message);
    console.error("Full error:", JSON.stringify(e, null, 2));
    process.exit(1);
  }

  // Summary
  const fee = parseFloat(estimatedCost) * 0.001 * 2; // 0.1% fee x2 (buy+sell)
  console.log("═══════════════════════════════════════════════");
  console.log("  TEST COMPLETE ✓");
  console.log(`  Bought and sold ${qty} BTC (~$${estimatedCost})`);
  console.log(`  Estimated fees: ~$${fee.toFixed(4)}`);
  console.log("  API keys and order execution VERIFIED!");
  console.log("═══════════════════════════════════════════════");
  
  process.exit(0);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
