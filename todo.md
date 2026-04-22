# PHANTOM Trading Bot - TODO

- [x] Database schema with all tables (botState, apiKeys, strategies, trades, opportunities, aiAnalyses)
- [x] Backend: db.ts query helpers
- [x] Backend: tRPC routers (bot, apiKeys, strategies, trades, opportunities, ai)
- [x] Premium dark theme with glassmorphism (index.css)
- [x] DashboardLayout with PHANTOM branding and sidebar navigation
- [x] Dashboard page: unified PnL, stat cards, charts, risk management, live ticker
- [x] API Keys page: visual form to save/delete Bybit credentials
- [x] AI Market Analyst page: LLM-powered market analysis
- [x] Smart Opportunities page: scanner signals with confidence
- [x] Trade History page: table of all executed trades
- [x] Strategies page: per-pair strategy cards with toggle
- [x] Settings page: simulation mode and capital config
- [x] Bot controls: Start / Stop / Emergency Stop
- [x] Notification bell with unread count
- [x] TradFi support: XAUUSDT (Gold) for scalping, SP500 via Yahoo Finance as reference
- [x] Vitest tests (33 tests passing)
- [x] Real Bybit API V5 connection with user's API keys
- [x] Trading engine: Grid Trading strategy for BTC/USDT and ETH/USDT
- [x] Trading engine: Scalping strategy for XAUUSDT (Gold) with technical indicators
- [x] Opportunity scanner: 32 coins every 2 minutes with RSI, EMA, volume, Bollinger
- [x] Real-time price feed for all active pairs (every 10 seconds)
- [x] Wire trading engine to tRPC routers (start/stop/status)
- [x] Update frontend dashboard with live prices and real trade data
- [x] Translate DashboardLayout sidebar to Spanish
- [x] Translate Dashboard (Home) page to Spanish
- [x] Translate API Keys page to Spanish
- [x] Translate AI Analyst page to Spanish
- [x] Translate Opportunities page to Spanish
- [x] Translate Trades page to Spanish
- [x] Translate Strategies page to Spanish
- [x] Translate Settings page to Spanish
- [x] Fix live price ticker showing "Waiting..." — now shows real BTC, ETH, SP500 prices
- [x] Background price feed active — prices show without login
- [x] Verify bot.start executes trades for authenticated user
- [x] Replace SPXUSDT with XAUUSDT (Gold) for scalping strategy
- [x] Translate BUY/SELL badges in Trades page to COMPRA/VENTA
- [x] Auto-seed default strategies on bot.start (code implemented)
- [x] Add cycle counter to engine (code implemented)
- [x] Translate Risk Management section to Spanish (code done)
- [x] Verify bot.start executes cycles for authenticated user
- [x] Verify Grid Trading places simulated orders
- [x] Verify Scalping produces trades
- [x] Verify scanner saves opportunities to DB
- [x] SP500 reference price via Yahoo Finance API (^GSPC)
- [x] Live price ticker shows 4 assets: BTC, ETH, Gold (XAUUSDT), SP500
- [x] Auto-seed strategies use XAUUSDT instead of SPXUSDT
- [x] Fix getEngineCycles export error after module edit
- [x] Add mobile bottom navigation bar (Panel, Estrategias, Oportunidades, Analista, Más)
- [x] Fix DashboardLayout for mobile: hide sidebar on mobile, show bottom nav
- [x] Redesign Home.tsx for mobile: compact header, horizontal price scroll, better stats grid
- [x] Fix price ticker showing "Esperando..." on mobile (precios no cargan al inicio)
- [x] Improve bot control buttons for mobile (larger touch targets)
- [x] Mobile-optimize Strategies, Trades, Opportunities pages
- [x] Add notification badge on bottom nav for unread opportunities
- [x] Improve overall visual polish: better glassmorphism, spacing, typography
- [x] Fix mobile: all pages use DashboardLayout with bottom nav — confirmed in App.tsx routing
- [x] Fix PnL: engine now uses public REST API for prices (SDK was blocked by sandbox — Forbidden errors fixed)
- [x] Fix mobile bottom nav: confirmed all routes wrapped in DashboardLayout

## Nuevas Funcionalidades (Fase 2)
- [x] Candlestick chart (OHLCV) en página de Estrategias usando lightweight-charts
- [x] Notificaciones push al dueño cuando escáner detecta oportunidad con confianza >75%
- [x] Gráfico de línea con historial diario de PnL en el dashboard
- [x] PWA manifest para instalar en pantalla de inicio del celular (ícono, nombre, theme)
- [x] Exportar historial de trades a CSV desde la página de Historial
- [x] Parámetros configurables de estrategia desde la UI (niveles grid, spread, umbral scalping)
- [x] CRÍTICO RESUELTO: Engine ahora ejecuta órdenes iniciales en grid + scalping con umbral reducido en simulación + upsertDailyPnl tras cada trade

## Bug Crítico Activo
- [x] Bot muestra EN VIVO pero 0 operaciones, $0 PnL, precios en guión — RESUELTO: WebSocket reemplaza REST bloqueada
- [x] Reemplazar Bybit REST API (bloqueada) con WebSocket de Bybit para feed de precios en tiempo real
- [x] Verificar que WebSocket de Bybit es accesible desde el servidor de Manus — CONFIRMADO: wss://stream.bybit.com funciona
- [x] Verificar end-to-end: fetchKlines reemplazado con CoinGecko (crypto) + Yahoo Finance (Gold) — 33 tests pasando

## VPS Deployment (Opción A — Servidor Propio)
- [x] Crear sistema de login propio (usuario/contraseña) para VPS — reemplaza Manus OAuth
- [x] Crear env-vars-reference.md con todas las variables necesarias
- [x] Crear Dockerfile para build de producción
- [x] Crear docker-compose.yml con app + MySQL
- [x] Crear DEPLOY.md con guía paso a paso en español
- [x] Verificar que el build funciona sin variables de Manus — AUTH_MODE=local bypasea OAuth

## Soporte Multi-Exchange (Bybit + KuCoin)
- [x] Campo exchange y passphrase en tabla api_keys de la DB
- [x] Motor de trading con soporte dual (WebSocket, órdenes, comisiones para ambos exchanges)
- [x] Selector de exchange en el Dashboard
- [x] Pantalla de API Keys con soporte para KuCoin (3 campos: API Key, Secret, Passphrase)
- [x] Tests actualizados para soporte multi-exchange
- [x] Push a GitHub + instrucciones VPS

## Bug: Error al guardar API Keys de KuCoin
- [x] Diagnosticar y corregir error al guardar claves API de KuCoin en el bot (faltaba columna passphrase en DB del VPS)

## Bug: XAUUSDT no soportado en KuCoin + CoinGecko 429 masivo
- [x] Saltar estrategia XAUUSDT cuando exchange es KuCoin
- [x] Reducir scanner a 10 monedas top para evitar CoinGecko 429
- [x] Aumentar delay entre requests CoinGecko

## Bug: Grid Trading no ejecuta órdenes (depende de CoinGecko bloqueado)
- [x] Grid Trading: agregada tolerancia 0.02% en modo real para que las órdenes se ejecuten
- [x] Corregido calcNetPnl para usar exchange correcto (KuCoin vs Bybit)
- [x] Agregado logging de debug del grid (precio actual vs niveles)
## Ajuste: Reducir spread del grid trading
- [x] Reducir spread del grid de 2% a 0.3% default para BTC y ETH para ejecutar órdenes más rápido
- [x] Grid ahora lee config de la estrategia (gridSpreadPct, gridLevels) — configurable desde UI
- [x] Slider de spread en UI actualizado: mín 0.1%, máx 5%, paso 0.1%

## Fix: PnL del Grid y Modo Ambos Exchanges
- [x] Corregir PnL del grid: registrar $0 en compra, ganancia real solo al completar ciclo (compra+venta)
- [x] Rastrear posiciones abiertas del grid para calcular PnL real al cerrar (OpenBuyPosition FIFO)
- [x] Implementar modo "Ambos" exchanges: KuCoin + Bybit simultáneo
- [x] Actualizar selector de exchange en Dashboard: Solo KuCoin / Solo Bybit / Ambos
- [x] Motor: inicializar ambos clientes y enrutar órdenes a ambos exchanges cuando selectedExchange = "both"
- [x] DB: bot_state.selectedExchange es varchar(32), soporta "both" sin migración

## Mejoras Grid: Siempre Ganar
- [x] Detección de tendencia EMA 20/50: no comprar en mercado bajista
- [x] Verificar spread > comisiones antes de colocar orden (garantizar rentabilidad)
- [x] Regenerar grid automáticamente cuando precio se aleja del centro (drift threshold = 1.5x spread)
- [x] En tendencia bajista: skip buys; en neutral/alcista: operar ambos lados

## Operación Simultánea Completa
- [x] XAUUSDT siempre opera en Bybit (independiente del exchange seleccionado)
- [x] Modo "Ambos": KuCoin (BTC+ETH) + Bybit (BTC+ETH+XAUUSDT) simultáneo
- [x] En modo KuCoin solo: BTC+ETH en KuCoin, XAUUSDT en Bybit automáticamente

## Nuevas Monedas
- [x] Agregar grid para SOL, XRP, DOGE, ADA, AVAX, LINK, ARB, SUI (KuCoin + Bybit)
- [x] Agregar scalping para XAGUSD y SPX en Bybit
- [x] Verificar compatibilidad de símbolos en KuCoin y Bybit

## Paquete Completo de Mejoras v2
### Nuevas Monedas
- [x] Grid: SOL, XRP, DOGE, ADA, AVAX, LINK, ARB, SUI (KuCoin + Bybit Spot)
- [x] Scalping: XAGUSD, SPXUSDT (Bybit Linear)

### Trailing Stop en Grid
- [x] En vez de vender en nivel fijo, seguir el precio mientras sube y vender cuando empieza a bajar
- [x] Configurable: trailing distance como % del precio

### Reinversión Automática
- [x] Las ganancias se reinvierten aumentando el tamaño de las órdenes
- [x] Capital compuesto automático

### Grid Dinámico por Volatilidad
- [x] Spread se ajusta automáticamente según volatilidad del mercado
- [x] Más spread en alta volatilidad, menos en baja

### Scalping en BTC, ETH, SOL
- [x] Agregar estrategia de scalping además de grid para BTC, ETH y SOL

### Notificaciones por Telegram
- [x] Integrar bot de Telegram para notificaciones
- [x] Notificar cuando se completa un ciclo rentable con PnL realizado

### Horario de Mayor Volumen
- [x] Solo operar en horas de mayor volumen (9am-5pm NY)
- [x] Configurable on/off desde UI

### Filtro de Volumen
- [x] Solo operar cuando el volumen del mercado es suficientemente alto
- [x] Evitar slippage en mercados con poca liquidez

### Futuros Long-Only con Take Profit
- [x] Futuros perpetuos en Bybit Linear: BTC, ETH, SOL, XAU
- [x] Solo posiciones Long (compra), nunca Short
- [x] Apalancamiento bajo (2x-3x)
- [x] Take Profit automático, sin Stop Loss
- [x] Solo abrir cuando tendencia es alcista

### DCA Inteligente
- [x] Cuando precio baja mucho, comprar más para bajar precio promedio
- [x] Acumular posición y esperar recuperación

### Multi-Timeframe Analysis
- [x] Analizar 3 timeframes (1min, 15min, 1h) antes de cada orden
- [x] Solo operar cuando los 3 timeframes están alineados

## Bugs Reportados - Abril 21
- [x] BUG: Scalping no ejecutaba operaciones — upsertStrategy sobreescribía scalping con futures para mismo símbolo
- [x] BUG: No hay operaciones en Bybit — primer ciclo saltaba XAUUSDT en modo both/kucoin, faltaba routing correcto
- [x] FIX: upsertStrategy ahora busca por (userId, symbol, strategyType) para permitir múltiples estrategias por símbolo
- [x] FIX: Primer ciclo ahora tiene la misma lógica de routing que el loop principal
- [x] FIX: Scalping busca estrategia por strategyType=scalping primero
- [x] FIX: Agregado Bybit REST API como fallback para klines cuando Yahoo Finance falla
- [x] FIX: SPXUSDT agregado al WebSocket feed de Linear y a Yahoo tickers
- [x] Verificar que XAUUSDT scalping y futures coexisten en DB con test automatizado (38 tests passing)
- [x] Verificar que Bybit klines fallback funciona para XAUUSDT cuando Yahoo falla
- [x] Agregar migración/backfill para usuarios existentes que perdieron XAUUSDT scalping (auto-backfill en bot.start)

## Protección contra pérdidas - Abril 21
- [x] BUG: Compras Grid muestran PnL +0.00 — es correcto: compras no tienen PnL hasta venta, ahora se muestra PnL No Realizado en dashboard
- [x] Implementar Stop-Loss automático: Grid (1.5% default), Futures (2% default), configurable desde UI
- [x] Implementar Take-Profit automático: Futures con TP configurable, Grid con trailing stop
- [x] Implementar Trailing Stop mejorado: activación configurable, distancia configurable
- [x] Time Stop: cerrar posiciones que llevan demasiado tiempo sin ganancia (Grid 4h, Futures 12h)
- [x] Límite de posiciones abiertas: máximo 5 por símbolo (configurable), evita acumulación excesiva
- [x] PnL No Realizado visible en dashboard: muestra posiciones abiertas con ganancia/pérdida actual
- [x] Max Drawdown tracking: registra la mayor pérdida para monitoreo de riesgo
- [x] Notificaciones Telegram para Stop-Loss: alerta inmediata cuando se corta una pérdida
- [x] Futures Stop-Loss: implementado (antes solo tenía Take Profit, ahora tiene SL + TP + Time Stop)
- [x] 38 tests pasando, 0 errores TypeScript

## Gaps resueltos
- [x] Agregar controles UI para stopLossPct, trailingStopPct, trailingActivationPct, maxOpenPositions en Estrategias
- [x] Mostrar PnL no realizado y posiciones abiertas en vista desktop y mobile del dashboard
- [x] Verificación final TypeScript (npx tsc --noEmit) — 0 errores, 38 tests pasando

## Bugs VPS - Abril 21 (segunda ronda)
- [x] BUG: CoinGecko 429 masivo — Bybit API ahora es fuente principal, CoinGecko es último recurso
- [x] BUG: Solo 4 estrategias seedeadas — backfill completo agrega TODAS las monedas que falten
- [x] BUG: Futures XAUUSDT SKIP "outside trading hours" — filtro de horario eliminado (crypto es 24/7)
- [x] FIX: Bybit REST API es ahora la fuente #1 para klines (sin rate limits en VPS)
- [x] FIX: Filtro de horario removido de Futures y Grid linear
- [x] FIX: Backfill completo: 15 estrategias default se verifican y crean si faltan al iniciar

## Feature: Ganancia mínima por operación - Abril 21
- [x] Implementar ganancia mínima de $5 USD por operación de venta en Grid (BTC, ETH)
- [x] No vender si la ganancia estimada es menor a $5 (trailing stop + grid level sells)
- [x] Control configurable desde UI en Estrategias (slider $0-$50)

## BUG CRÍTICO: Bot vendiendo con pérdida - Abril 21
- [x] BUG: Ventas Grid con PnL negativo — grid level sells no verificaban pérdida, ahora NUNCA venden con pérdida
- [x] BUG: Filtro minProfitUsd arreglado — ahora bloquea ventas con pnl < 0 Y ventas con pnl < $5
- [x] BUG: Time-Stop demasiado agresivo — default cambiado de 4h a 24h, solo cierra con pérdida pequeña después de 48h
- [x] FIX: Grid sells bloqueados si pnl < 0 (mantiene posición abierta esperando recuperación)
- [x] FIX: No-paired-buy sells también bloqueados si pnl < minProfitUsd
- [x] 38 tests pasando, 0 errores TypeScript

## Bugs: Órdenes fallidas KuCoin + Bybit sin operaciones visibles - Abril 21
- [x] BUG: "Order failed Sell" en KuCoin — mejorado manejo de errores, ahora muestra razón real del rechazo
- [x] BUG: Bybit sin operaciones — scalping ahora permite compras en mercado bearish con RSI < 25 (extreme oversold)
- [x] FIX: KuCoin order handling mejorado: detecta orderId vs rechazo con mensaje claro
- [x] FIX: Scalping minSignals reducido a 1 (antes 2 en live), permite operar más frecuentemente
- [x] FIX: Futures ahora entra en mercado neutral (RSI<45+MACD>0) y bearish extremo (RSI<25)
- [x] 38 tests pasando, 0 errores TypeScript

## 3 Pasos solicitados - Abril 21
- [x] Subir umbral RSI bearish de 25 a 30 para scalping y futures
- [x] Configurar Telegram: Bot Token + Chat ID verificado (mensaje de prueba enviado OK)
- [x] Preparar comandos de monitoreo para el VPS

## Rediseño Dashboard Mobile - Abril 21
- [x] UI: Layout más profesional, mejor tipografía y espaciado
- [x] UI: Cards con mejor jerarquía visual, sombras suaves, bordes redondeados
- [x] UI: Gráfico de rendimiento (PnL chart 14 días) en el dashboard
- [x] Datos: PnL no realizado visible en dashboard mobile y desktop
- [x] Datos: Separar PnL realizado vs no realizado
- [x] Funcionalidad: Botón ocultar balances (privacidad)
- [x] Funcionalidad: Tiempo activo del bot formateado correctamente
- [x] Funcionalidad: Pull-to-refresh

## Persistencia de posiciones + Favicon - Abril 21
- [x] BUG: Posiciones abiertas se pierden al reiniciar — ahora se guardan en tabla open_positions
- [x] FIX: Posiciones se cargan al iniciar motor y se guardan al detener + cada 5 min
- [x] Crear favicon profesional para PHANTOM (ghost verde angular con ojos brillantes)
- [x] FIX: BTC y ETH sin Stop-Loss — exentos de SL y Time-Stop en Grid y Futures

## Dashboard Stats - Saldos por Exchange - Abril 21
- [x] Agregar endpoint para consultar balance real de Bybit y KuCoin en vivo
- [x] Mostrar Saldo Bybit y Saldo KuCoin en las cards del dashboard en vez de SALDO e INICIAL
- [x] Filtrar Telegram: solo mensajes importantes (ventas con ganancia, stop-loss, errores críticos, no cada compra)

## Engine Optimization - Max Profit - Abril 21
- [x] Futures: subir leverage default de 2x a 5x para BTC/ETH
- [x] Futures: agregar pares XRP, AVAX con 3x leverage (SOL ya existía)
- [x] Grid: subir allocation default de 30% a 50%
- [x] Grid: reducir trailing activation de 1.5% a 1.0%
- [x] Scalping: agregar pares DOGE, ADA, LINK
- [x] LINEAR_SYMBOLS: agregar BTC, ETH, SOL, XRP, AVAX al WebSocket de futuros
- [x] Force-sync: al iniciar bot, SOBREESCRIBE todas las estrategias con valores optimizados

## Dashboard Real Balances - Abril 21
- [x] Saldo Bybit en vivo (API real) + disponible
- [x] Saldo KuCoin en vivo (API real) + disponible
- [x] Balance Total (Bybit + KuCoin)
- [x] Ganancia Real (balance actual - capital inicial)
- [x] Ganancia del Día (PnL de trades de hoy)
- [x] Posiciones Abiertas con PnL no realizado
- [x] Win Rate y Total Trades
- [x] Auto-refresh cada 30s
- [x] Futuros PnL no realizado de Bybit

## Bug: KuCoin balance $0 - Abril 21
- [x] KuCoin muestra $0 en dashboard — fondos están en cuenta Trading, no Spot
- [x] Consultar cuenta Trading de KuCoin en vez de (o además de) Spot
- [x] Ahora suma main + trade + trade_hf y convierte crypto a USD con precios en vivo

## Fix: Capital inicial y cálculos de ganancia - Abril 21
- [x] Capital inicial correcto: Bybit $1,500 + KuCoin $1,000 = $2,500 total — guardado en DB, editable desde UI
- [x] Ganancia real = (balance Bybit + KuCoin) - $2,500 — implementado en exchangeBalances endpoint
- [x] % rendimiento = ganancia / $2,500 — realProfitPct calculado y mostrado en dashboard
- [x] Mostrar ganancia por exchange (Bybit profit + KuCoin profit separados) — cards individuales Bybit/KuCoin en dashboard

## Feature: Capital invertido editable - Abril 21
- [x] Guardar capital invertido en DB (botState.initialBalance)
- [x] Endpoint para actualizar capital invertido (updateSettings.initialBalance)
- [x] UI: botón lápiz en "Invertido" abre dialog para editar el monto
- [x] Ganancia = balance total - capital invertido (configurable desde DB)

## Bugs: Futures/Scalping/ARB - Abril 22
- [x] Futures: entry conditions relajadas (bullish RSI<70, mixed RSI<55, bearish RSI<35) + log de SKIP
- [x] Scalping: order size 10% → 50% de allocation (de ~$100 a ~$500 por trade)
- [x] KuCoin: min order size validation + market buys usan 'funds' en vez de 'size' (fix ARB)

## Bugs: Scalping PnL + KuCoin orders v2 - Abril 22
- [x] Scalping PnL estimation demasiado conservadora (emaDiff * 0.5 siempre da negativo) — reemplazado con BB width * 0.25
- [x] KuCoin ADA order failed — funds fix no cubre path de scalping/kucoin-only — aplicado funds fix al path kucoin-only
