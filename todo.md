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
