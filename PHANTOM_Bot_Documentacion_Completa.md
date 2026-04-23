# PHANTOM Trading Bot — Documentación Completa

**Versión 7.0 — Superintelligence Engine**
**Fecha:** 23 de Abril de 2026
**Autor:** Francisco García Santillán

---

## 1. Introducción

PHANTOM es un bot de trading automatizado de alta frecuencia diseñado para operar 24 horas al día, 7 días a la semana, en los exchanges **Bybit** y **KuCoin** simultáneamente. Su objetivo principal es generar ganancias diarias consistentes del 2-5% operando criptomonedas, oro (XAUUSDT), plata (XAGUSD) y el índice S&P 500 (SP500USDT).

El bot combina tres estrategias de trading (Grid, Scalping y Futures) con un motor de superinteligencia compuesto por 19 módulos de análisis avanzado que incluyen análisis multi-timeframe, correlación con Bitcoin, detección de manipulación de mercado, gestión de capital con Kelly Criterion, y protección contra drawdown, entre otros.

La filosofía fundamental del bot es simple pero poderosa: **nunca vender a pérdida**. Cada operación debe generar al menos un 0.5% de ganancia neta después de comisiones antes de ejecutarse. Si una posición está en pérdida, el bot la mantiene (HOLD) hasta que recupere y genere ganancia real.

---

## 2. Arquitectura del Sistema

### 2.1 Stack Tecnológico

PHANTOM está construido sobre una arquitectura moderna de TypeScript full-stack que permite tanto el desarrollo rápido como la ejecución eficiente en producción.

| Componente | Tecnología | Propósito |
|---|---|---|
| Backend | Node.js + Express + tRPC | API tipada end-to-end, procedures protegidas |
| Frontend | React 19 + Tailwind CSS 4 | Dashboard interactivo con tema oscuro premium |
| Base de Datos | MySQL / TiDB | Persistencia de trades, estrategias, posiciones |
| ORM | Drizzle ORM | Schema-first, migraciones automáticas |
| Exchange API | Bybit API V5 (REST + WebSocket) | Órdenes, balances, precios en tiempo real |
| Exchange API | KuCoin API (REST + WebSocket) | Soporte dual de exchanges |
| Notificaciones | Telegram Bot API | Alertas en tiempo real al celular |
| Deployment | Docker + Docker Compose | Contenedores para app + base de datos |
| Repositorio | GitHub (privado) | Control de versiones y deploy en VPS |

### 2.2 Estructura de Archivos

El proyecto se organiza en módulos claramente separados por responsabilidad:

```
phantom/
├── server/
│   ├── tradingEngine.ts      → Motor principal (3,000+ líneas)
│   ├── smartAnalysis.ts      → Indicadores técnicos avanzados (400+ líneas)
│   ├── marketIntelligence.ts → 19 módulos de superinteligencia (700+ líneas)
│   ├── autoConvert.ts        → Conversión automática a USDT
│   ├── routers.ts            → API endpoints (tRPC procedures)
│   ├── db.ts                 → Helpers de base de datos
│   └── localAuth.ts          → Autenticación local para VPS
├── drizzle/
│   └── schema.ts             → Schema de base de datos (9 tablas)
├── client/
│   └── src/
│       ├── pages/            → Dashboard, Estrategias, Trades, etc.
│       └── components/       → Componentes reutilizables
├── Dockerfile                → Build de producción
├── docker-compose.yml        → Orquestación app + MySQL
└── DEPLOY.md                 → Guía de deployment
```

### 2.3 Modelo de Datos

La base de datos contiene 9 tablas que almacenan todo el estado del bot:

| Tabla | Propósito | Campos Clave |
|---|---|---|
| `users` | Usuarios del sistema | id, openId, name, email, role |
| `bot_state` | Estado global del bot por usuario | isActive, simulationMode, selectedExchange, totalBalance, realizedPnl, winCount, lossCount, initialBalance |
| `api_keys` | Claves API de exchanges (encriptadas) | exchange, apiKey, apiSecret, passphrase |
| `strategies` | Configuración de cada estrategia | symbol, strategyType, market, category, allocationPct, enabled, config, balance, pnl, tradeCount |
| `trades` | Historial de todas las operaciones | symbol, side, price, qty, pnl, strategy, exchange, orderId, simulated |
| `opportunities` | Señales detectadas por el scanner | symbol, signal, confidence, price, indicators |
| `pnl_history` | PnL diario agregado | date, pnl, tradeCount, winCount, lossCount |
| `open_positions` | Posiciones abiertas persistidas | symbol, strategyType, exchange, buyPrice, qty, tradeAmount, highestPrice |
| `ai_analyses` | Análisis de IA guardados | type, content, sentiment |

---

## 3. Las Tres Estrategias de Trading

### 3.1 Grid Trading — "Compra Bajo, Vende Alto"

El Grid Trading es la estrategia principal del bot. Funciona creando una "grilla" de niveles de precio alrededor del precio actual de cada moneda. Cuando el precio baja a un nivel de la grilla, el bot compra. Cuando sube a otro nivel, vende. Cada ciclo completo (compra + venta) genera una ganancia igual al spread de la grilla menos las comisiones.

**Cómo funciona paso a paso:**

1. El bot obtiene el precio actual de la moneda (por ejemplo, BTC a $78,000).
2. Calcula la volatilidad actual usando ATR (Average True Range) y el régimen de mercado.
3. Genera niveles de grilla dinámicos. Por ejemplo, con un spread de 0.3%:
   - Nivel de compra: $77,766 (precio - 0.3%)
   - Nivel de venta: $78,234 (precio + 0.3%)
4. Cuando el precio baja a $77,766, compra una cantidad calculada según el score de confianza.
5. Activa un trailing stop dinámico basado en ATR que sigue el precio mientras sube.
6. Cuando el trailing stop se activa (el precio empieza a bajar después de subir), vende — pero SOLO si la ganancia neta es >= 0.5%.

**Parámetros del Grid:**

| Parámetro | Valor | Descripción |
|---|---|---|
| Spread base | 0.3% | Distancia entre niveles de compra y venta |
| Spread dinámico | 0.15% - 2.0% | Se ajusta según volatilidad (ATR) y régimen |
| Max posiciones | 5 | Máximo de posiciones abiertas simultáneas por moneda |
| Max hold time | 4 horas | Tiempo máximo antes de intentar cerrar (solo en ganancia) |
| Trailing distance | Basado en ATR | Se adapta a la volatilidad real del mercado |
| Ganancia mínima | 0.5% neto | Nunca vende si la ganancia no cubre comisiones + 0.5% |
| Categoría | LINEAR | Opera en contratos perpetuos USDT (no compra monedas reales) |

**Monedas activas en Grid:**
BTC, ETH, SOL, XRP, DOGE, ADA, AVAX, LINK, ARB, SUI (10 monedas).

**Spread dinámico por régimen de mercado:**

| Régimen | Multiplicador | Ejemplo (spread base 0.3%) |
|---|---|---|
| Trending (tendencia fuerte) | 1.2x | 0.36% |
| Ranging (lateral) | 0.65x | 0.195% (más ciclos) |
| Volatile (alta volatilidad) | 1.5x | 0.45% (más protección) |

### 3.2 Scalping — "Entradas Rápidas con Análisis Técnico"

El Scalping busca oportunidades de corto plazo usando análisis técnico avanzado. A diferencia del Grid que opera mecánicamente en niveles, el Scalping analiza múltiples indicadores para encontrar el momento óptimo de entrada.

**Cómo funciona paso a paso:**

1. El bot analiza 11 indicadores técnicos para cada moneda (RSI, MACD, Bollinger Bands, ATR, ADX, Stochastic RSI, OBV, VWAP, Williams %R, divergencias RSI y MACD).
2. Calcula un score de confianza de 0 a 100.
3. Si el score es >= 30 y la dirección es "buy", abre una posición de scalping.
4. El tamaño de la posición se ajusta según la fuerza de la señal (boost 1.3x-1.8x en señales fuertes).
5. Monitorea la posición y vende cuando la ganancia neta es >= 0.5%.

**Parámetros del Scalping:**

| Parámetro | Valor | Descripción |
|---|---|---|
| Score mínimo | 30 | Confianza mínima para abrir posición |
| Max posiciones | 3 | Máximo simultáneas por moneda |
| Strength boost | 1.3x - 1.8x | Más tamaño en señales fuertes (score > 50/70) |
| Ganancia mínima | 0.5% neto | Solo vende con ganancia real |

**Monedas activas en Scalping:**
BTC, ETH, SOL, XAU (Oro), DOGE, ADA, LINK.

### 3.3 Futures — "LONG y SHORT con Apalancamiento"

La estrategia de Futures permite al bot apostar tanto a que el precio sube (LONG) como a que baja (SHORT), usando apalancamiento para amplificar las ganancias. Todo se opera en contratos perpetuos lineales (USDT-settled), por lo que las ganancias y pérdidas se liquidan directamente en USDT.

**Cómo funciona paso a paso:**

1. El bot analiza la moneda con el Master Signal (combinación de todos los módulos de inteligencia).
2. Si el Master Signal dice "buy" con confianza >= 35, abre un LONG (apuesta a que sube).
3. Si dice "sell" con confianza >= 35, abre un SHORT (apuesta a que baja).
4. El apalancamiento es configurable (default 5x para BTC/ETH, 3x para el resto).
5. Activa un trailing stop dinámico basado en ATR.
6. Solo cierra la posición cuando la ganancia neta es >= 0.5%.

**Parámetros de Futures:**

| Parámetro | Valor | Descripción |
|---|---|---|
| Score mínimo | 35 | Confianza mínima del Master Signal |
| Max posiciones | 5 | Máximo simultáneas totales |
| Leverage BTC/ETH | 5x | Apalancamiento para las principales |
| Leverage resto | 3x | Apalancamiento conservador para alts |
| Take Profit | 1.5% | Objetivo de ganancia |
| Trailing stop | Basado en ATR | Se adapta a volatilidad |
| Ganancia mínima | 0.5% neto | Nunca cierra en pérdida |

**Monedas activas en Futures (12 monedas):**
BTC, ETH, SOL, XRP, DOGE, AVAX, LINK, ARB, SUI, ADA, XAU (Oro), SP500 (S&P 500).

---

## 4. Motor de Superinteligencia — 19 Módulos

### 4.1 Análisis Multi-Timeframe (MTA)

El MTA analiza cada moneda en tres timeframes simultáneos: 5 minutos, 15 minutos y 1 hora. Si los tres timeframes coinciden en la misma dirección, la señal es mucho más confiable.

Cuando los 3 timeframes dicen "comprar", el bot aplica un boost de 1.8x al tamaño de la posición. Cuando solo 2 coinciden, el boost es 1.3x. Si los 3 están en conflicto, reduce el tamaño a 0.5x o directamente no opera.

| Alineación | Timeframes de acuerdo | Boost | Acción |
|---|---|---|---|
| Strong | 3 de 3 | 1.8x | Operar agresivamente |
| Partial | 2 de 3 | 1.3x | Operar con cautela |
| Conflicting | 0-1 de 3 | 0.5x | Reducir o no operar |

### 4.2 Correlación BTC-Alts

Bitcoin lidera el mercado de criptomonedas aproximadamente el 90% del tiempo. Cuando BTC cae fuerte, todas las altcoins caen también. Este módulo rastrea el estado de BTC en tiempo real y filtra las operaciones en altcoins según la tendencia de Bitcoin.

El módulo mantiene un historial de los últimos 20 precios de BTC y calcula la tendencia. Si BTC está cayendo más de 0.5%, bloquea compras de altcoins. Si BTC está subiendo más de 0.5%, permite compras agresivas con un boost de 1.3x.

| Estado BTC | Cambio % | Acción en Alts |
|---|---|---|
| Subiendo fuerte | > +0.5% | Comprar agresivo (boost 1.3x) |
| Estable | -0.5% a +0.5% | Operar normal |
| Cayendo fuerte | < -0.5% | BLOQUEAR compras de alts |

### 4.3 Detección de Spikes de Volumen

Cuando el volumen de trading de una moneda sube repentinamente (2-3x del promedio), algo significativo está ocurriendo. Este módulo detecta estos "spikes" comparando el volumen actual con el promedio de las últimas 20 velas.

Un spike de volumen con precio subiendo indica presión compradora fuerte (señal de LONG). Un spike con precio bajando indica presión vendedora (señal de SHORT o evitar compras).

### 4.4 Order Book Imbalance

Este módulo lee el order book de Bybit en tiempo real, analizando la proporción entre órdenes de compra (bids) y órdenes de venta (asks). Si hay significativamente más compradores que vendedores, el precio probablemente va a subir.

El bot calcula un ratio bid/ask. Si el ratio es mayor a 1.5 (50% más compradores), genera una señal de compra. Si es menor a 0.67 (50% más vendedores), genera una señal de venta.

### 4.5 Funding Rate para Futures

En los contratos perpetuos, el funding rate es un pago periódico entre posiciones LONG y SHORT. Cuando el funding rate es muy negativo, los shorts están pagando a los longs, lo que indica que hay demasiados shorts y el precio probablemente va a subir (los shorts se van a cerrar, generando presión compradora).

| Funding Rate | Significado | Señal |
|---|---|---|
| Muy negativo (< -0.01%) | Shorts pagando a longs | LONG (precio va a subir) |
| Normal (-0.01% a +0.01%) | Equilibrio | Neutral |
| Muy positivo (> +0.01%) | Longs pagando a shorts | SHORT (precio va a bajar) |

### 4.6 Detección de Liquidaciones (Squeezes)

Cuando hay liquidaciones masivas de posiciones short, el precio sube violentamente porque los shorts se ven forzados a comprar para cerrar sus posiciones (short squeeze). Lo mismo ocurre al revés con long squeezes.

El módulo detecta estos eventos analizando cambios bruscos de precio combinados con volumen extremo. Cuando detecta un squeeze, genera una señal fuerte en la dirección del movimiento.

### 4.7 Mean Reversion

Cuando una moneda cae 3-5% en pocos minutos sin una razón fundamental clara, estadísticamente tiende a recuperar el 60-70% del movimiento. Este módulo detecta estas caídas rápidas y genera señales de compra para capturar el rebote.

El módulo analiza el cambio porcentual en las últimas velas. Si detecta una caída de más del 2% en un período corto con RSI sobrevendido (< 30), genera una señal de compra con alta confianza.

### 4.8 Breakout Trading

Cuando el precio rompe un rango de consolidación (un período donde el precio se mueve lateralmente) con volumen alto, generalmente continúa en la dirección de la ruptura. Este módulo detecta estos breakouts analizando los máximos y mínimos recientes.

Si el precio actual supera el máximo de las últimas 20 velas con volumen 1.5x superior al promedio, genera una señal de compra (breakout alcista). Si rompe el mínimo, genera una señal de venta (breakout bajista).

### 4.9 Arbitraje Scanner

Este módulo monitorea los precios de las mismas monedas en Bybit y KuCoin simultáneamente. Cuando detecta una diferencia de precio significativa (> 0.3% después de comisiones), genera una alerta de arbitraje.

Por ejemplo, si BTC está a $78,000 en Bybit y $78,300 en KuCoin, el bot podría comprar en Bybit y vender en KuCoin para capturar la diferencia.

### 4.10 Grid Dinámico Adaptativo

En lugar de usar un spread fijo, este módulo recalcula los parámetros del grid en cada ciclo basándose en la volatilidad real del mercado (ATR). En mercados volátiles, el spread se amplía para evitar ser "barrido" por movimientos bruscos. En mercados tranquilos, el spread se reduce para generar más ciclos de ganancia.

### 4.11 Compound Interest (Interés Compuesto)

Las ganancias del día se reinvierten automáticamente. Si el bot empieza el día con $8,000 y gana $160 (2%), al día siguiente opera con $8,160. Esto genera un efecto de bola de nieve donde las ganancias se acumulan exponencialmente.

Con un 2% diario compuesto, $8,000 se convierten en:

| Período | Capital | Ganancia Acumulada |
|---|---|---|
| 1 semana | $8,943 | +$943 |
| 1 mes | $14,568 | +$6,568 |
| 3 meses | $45,135 | +$37,135 |
| 6 meses | $254,515 | +$246,515 |

### 4.12 Distribución Inteligente de Capital

Este módulo analiza el rendimiento histórico de cada estrategia (Grid, Scalping, Futures) y asigna más capital a la que mejor está funcionando. Si Grid está generando el 70% de las ganancias, recibe el 70% del capital disponible.

### 4.13 Kelly Criterion

El Kelly Criterion es una fórmula matemática que calcula el tamaño óptimo de cada operación basándose en el win rate y el ratio ganancia/pérdida del bot. La fórmula es:

> **f* = (p × b - q) / b**

Donde **p** es la probabilidad de ganar, **q** es la probabilidad de perder (1-p), y **b** es el ratio ganancia/pérdida promedio. El bot usa un "half-Kelly" (la mitad del resultado) para ser más conservador.

### 4.14 Detección de Sesiones de Mercado

El mercado de criptomonedas tiene diferentes niveles de actividad según la hora del día. Este módulo detecta la sesión actual y ajusta la agresividad del bot:

| Sesión | Horario (UTC) | Características | Multiplicador |
|---|---|---|---|
| Asia | 00:00 - 08:00 | Volátil en alts, movimientos rápidos | 1.0x |
| Europa | 08:00 - 14:00 | Movimientos medianos, tendencias claras | 1.1x |
| USA | 14:00 - 21:00 | Movimientos grandes, alta liquidez | 1.2x |
| Off-hours | 21:00 - 00:00 | Baja liquidez, spreads amplios | 0.8x |

### 4.15 Momentum Intraday

Las primeras 2 horas de la sesión USA (14:30-16:30 UTC) tienen históricamente los movimientos más grandes del día. Este módulo aplica un boost adicional durante esas horas para capturar movimientos más grandes.

### 4.16 Drawdown Diario Máximo

Si el bot pierde más de 1% del capital en un día, reduce automáticamente el tamaño de todas las posiciones a la mitad. Si pierde más de 2%, pausa las operaciones nuevas durante 1 hora. Esto protege el capital en días malos.

| Drawdown | Acción | Multiplicador |
|---|---|---|
| < 1% | Normal | 1.0x |
| 1% - 2% | Reducir posiciones | 0.5x |
| > 2% | Pausar operaciones nuevas | 0.0x (solo cierra existentes) |

### 4.17 Diversificación Forzada

El bot nunca pone más del 20% del capital total en una sola moneda. Si BTC ya tiene el 20% del capital asignado, el bot busca oportunidades en otras monedas. Esto reduce el riesgo de concentración.

### 4.18 Anti-Manipulación

Las "ballenas" (traders con mucho capital) a veces manipulan el precio creando "wicks falsos" — el precio baja bruscamente y sube inmediatamente en la misma vela. Este módulo detecta estos patrones analizando la relación entre el cuerpo de la vela y sus sombras (wicks).

Si la sombra inferior es más de 3 veces el tamaño del cuerpo de la vela, el módulo marca la señal como "manipulada" y bloquea la operación.

### 4.19 Master Signal — El Agregador Final

El Master Signal es el cerebro que combina TODOS los módulos anteriores en una sola decisión. Toma el score base del análisis técnico (smartAnalysis) y lo ajusta según cada módulo:

1. Empieza con el score base (0-100) del análisis de 11 indicadores.
2. Aplica el filtro de correlación BTC (bloquea o boost).
3. Verifica spikes de volumen (boost si detecta).
4. Lee el order book imbalance (ajusta dirección).
5. Analiza funding rate (ajusta para futures).
6. Detecta squeezes (boost fuerte si detecta).
7. Verifica mean reversion (señal alternativa).
8. Verifica breakout (señal alternativa).
9. Aplica filtro anti-manipulación (bloquea si detecta).
10. Aplica multiplicador de sesión de mercado.
11. Aplica multiplicador de momentum intraday.
12. Aplica multiplicador de drawdown.
13. Verifica diversificación (bloquea si excede 20%).
14. Calcula tamaño óptimo con Kelly Criterion.

El resultado final es un **score de confianza ajustado** (0-100), una **dirección** (buy/sell/neutral), un **multiplicador de tamaño** de posición, y una lista de **razones** que explican la decisión.

---

## 5. Reglas de Hierro

Estas reglas son inviolables y se aplican a TODAS las estrategias sin excepción:

### 5.1 NUNCA Vender a Pérdida

El bot nunca ejecuta una venta si el resultado neto (después de comisiones) es negativo. Si una posición está en pérdida, la mantiene (HOLD) indefinidamente hasta que el precio recupere y genere ganancia. Esta regla se aplica a Grid, Scalping, Futures y Auto-Convert.

### 5.2 Ganancia Mínima 0.5% Neta

Cada venta debe generar al menos un 0.5% de ganancia neta después de descontar todas las comisiones del exchange. Esto asegura que cada operación contribuye positivamente al capital.

La fórmula de verificación es:

> **ganancia_neta = (precio_venta × qty) - (precio_compra × qty) - (comisión_compra + comisión_venta)**
>
> **ganancia_neta >= tradeAmount × 0.005** (0.5% del monto invertido)

### 5.3 Meta Diaria Inteligente

El bot tiene un sistema de 3 modos basado en la ganancia del día:

| Modo | Ganancia Diaria | Comportamiento |
|---|---|---|
| **Normal** | < 2% | Opera con todas las estrategias normalmente |
| **Cautious** | 2% - 5% | Solo opera con señales excepcionales (score >= 75) |
| **Stopped** | > 5% | Frena completamente, protege ganancias del día |

Las posiciones abiertas siempre se cierran normalmente (las ventas y trailing stops no se bloquean). Solo se bloquean NUEVAS compras/entradas.

### 5.4 Todo Queda en USDT

La filosofía "USDT-First" asegura que el capital siempre esté en USDT (stablecoin). El Grid opera en contratos LINEAR (USDT-settled, no compra monedas reales). Los Futures también son LINEAR. El Auto-Convert vende cualquier moneda acumulada de vuelta a USDT cada 2.5 minutos.

---

## 6. Ciclo de Operación

### 6.1 Ciclo Principal (cada 15 segundos)

Cada 15 segundos, el motor ejecuta el siguiente ciclo:

1. **Verificar estado**: ¿El bot está activo? ¿Hay API keys válidas?
2. **Actualizar BTC tracking**: Registrar el precio actual de BTC para correlación.
3. **Detectar sesión de mercado**: Asia, Europa, USA, o Off-hours.
4. **Verificar drawdown**: ¿Se perdió más de 1% hoy? Ajustar multiplicador.
5. **Calcular ganancia diaria**: ¿Se alcanzó la meta del 2% o 5%?
6. **Escanear arbitraje**: ¿Hay diferencias de precio entre Bybit y KuCoin?
7. **Para cada estrategia activa**:
   - Obtener precio actual del WebSocket.
   - Obtener klines (velas) de 15 minutos.
   - Calcular todos los indicadores técnicos.
   - Generar Master Signal.
   - Ejecutar la estrategia (Grid/Scalping/Futures) con los datos del Master Signal.
8. **Auto-Convert** (cada 8 ciclos / ~2.5 min): Vender monedas acumuladas a USDT.
9. **Guardar estado**: Persistir posiciones abiertas en la base de datos.

### 6.2 Scanner de Oportunidades (cada 1 minuto)

Cada minuto, el scanner analiza 10 monedas principales buscando oportunidades de trading. Para cada moneda, calcula el Master Signal completo y guarda las oportunidades con confianza alta en la base de datos. Si detecta una oportunidad con score > 60, envía una notificación por Telegram.

### 6.3 Resumen Diario (cada 24 horas)

A medianoche UTC, el bot envía un resumen completo del día por Telegram que incluye: balances de Bybit y KuCoin, PnL del día, ganancia real acumulada, posiciones abiertas, número de operaciones, win rate, y desglose por estrategia (Grid, Scalping, Futures).

### 6.4 Feed de Precios en Tiempo Real

El bot mantiene conexiones WebSocket permanentes con Bybit y KuCoin para recibir precios en tiempo real. Bybit tiene dos conexiones: una para Spot (32 monedas) y otra para Linear (contratos perpetuos incluyendo XAU, SPX, SP500). KuCoin tiene una conexión para las 32 monedas principales.

Adicionalmente, el precio del S&P 500 se obtiene de Yahoo Finance cada 60 segundos como referencia.

---

## 7. Indicadores Técnicos (Smart Analysis)

El módulo de Smart Analysis calcula 11 indicadores técnicos para cada moneda en cada ciclo:

### 7.1 RSI (Relative Strength Index)

Mide si una moneda está sobrecomprada (RSI > 70) o sobrevendida (RSI < 30). Período: 14 velas.

### 7.2 MACD (Moving Average Convergence Divergence)

Detecta cambios de tendencia comparando dos medias móviles exponenciales (EMA 12 y EMA 26). Cuando la línea MACD cruza por encima de la señal, es señal de compra.

### 7.3 Bollinger Bands

Mide la volatilidad creando bandas alrededor de una media móvil. Cuando el precio toca la banda inferior, puede ser señal de compra. Cuando toca la superior, señal de venta.

### 7.4 ATR (Average True Range)

Mide la volatilidad real del mercado. Se usa para calcular trailing stops dinámicos y ajustar el spread del grid.

### 7.5 ADX (Average Directional Index)

Mide la fuerza de la tendencia (0-100). ADX > 25 indica tendencia fuerte, ADX < 20 indica mercado lateral.

### 7.6 Stochastic RSI

Versión más sensible del RSI que detecta condiciones de sobrecompra/sobreventa más rápidamente.

### 7.7 OBV (On-Balance Volume)

Relaciona el volumen con los cambios de precio. Si el OBV sube mientras el precio baja, puede indicar acumulación (señal de compra futura).

### 7.8 VWAP (Volume Weighted Average Price)

Precio promedio ponderado por volumen. Si el precio actual está por debajo del VWAP, puede ser una buena oportunidad de compra.

### 7.9 Williams %R

Similar al Stochastic, mide dónde está el precio actual respecto al rango de las últimas 14 velas.

### 7.10 Divergencia RSI

Cuando el precio hace nuevos mínimos pero el RSI no, es una "divergencia alcista" — señal fuerte de que el precio va a subir.

### 7.11 Divergencia MACD

Similar a la divergencia RSI pero usando el histograma MACD. Las divergencias MACD son señales muy confiables de cambio de tendencia.

### 7.12 Score de Confianza

Todos los indicadores se combinan en un score de 0 a 100:

| Rango | Significado | Acción |
|---|---|---|
| 0-20 | Señal muy débil | No operar |
| 20-35 | Señal débil | Grid puede operar |
| 35-50 | Señal moderada | Scalping y Futures pueden operar |
| 50-70 | Señal fuerte | Operar con boost de tamaño |
| 70-100 | Señal muy fuerte | Operar agresivamente (boost 1.5-2x) |

---

## 8. Gestión de Riesgo

### 8.1 Trailing Stop Dinámico

En lugar de un stop fijo, el bot usa un trailing stop que se adapta a la volatilidad. El trailing distance se calcula como un múltiplo del ATR:

- **Grid**: trailing = ATR × 1.5 (mínimo 0.3%, máximo 3%)
- **Futures LONG**: trailing = ATR × 2.0
- **Futures SHORT**: trailing = ATR × 2.0

El trailing stop sigue el precio mientras sube (para LONG) o baja (para SHORT), y se activa cuando el precio retrocede la distancia del trailing.

### 8.2 DCA (Dollar Cost Averaging)

Cuando una posición de Grid está en pérdida y el precio sigue bajando, el bot puede hacer DCA — comprar más a un precio más bajo para reducir el precio promedio. Esto acelera la recuperación cuando el precio rebota.

### 8.3 Comisiones

El bot tiene en cuenta las comisiones exactas de cada exchange:

| Exchange | Spot | Linear (Futures) |
|---|---|---|
| Bybit | 0.1% | 0.055% |
| KuCoin | 0.1% | 0.06% |

La ganancia mínima de 0.5% se calcula DESPUÉS de descontar estas comisiones.

---

## 9. Exchanges Soportados

### 9.1 Bybit

Exchange principal. Soporta todas las estrategias: Grid (LINEAR), Scalping, Futures. Incluye activos TradFi: Oro (XAUUSDT), Plata (XAGUSD), S&P 500 (SP500USDT).

### 9.2 KuCoin

Exchange secundario. Soporta Grid y Scalping en Spot para criptomonedas. No soporta TradFi (XAU, SP500 siempre van a Bybit).

### 9.3 Modo "Ambos"

Cuando se selecciona "Ambos", el bot opera en los dos exchanges simultáneamente. Las criptomonedas se operan en ambos, mientras que los activos TradFi siempre van a Bybit automáticamente.

---

## 10. Activos Operados

| Activo | Símbolo | Estrategias | Exchange |
|---|---|---|---|
| Bitcoin | BTCUSDT | Grid, Scalping, Futures | Bybit + KuCoin |
| Ethereum | ETHUSDT | Grid, Scalping, Futures | Bybit + KuCoin |
| Solana | SOLUSDT | Grid, Scalping, Futures | Bybit + KuCoin |
| XRP | XRPUSDT | Grid, Futures | Bybit + KuCoin |
| Dogecoin | DOGEUSDT | Grid, Scalping, Futures | Bybit + KuCoin |
| Cardano | ADAUSDT | Grid, Scalping, Futures | Bybit + KuCoin |
| Avalanche | AVAXUSDT | Grid, Futures | Bybit + KuCoin |
| Chainlink | LINKUSDT | Grid, Scalping, Futures | Bybit + KuCoin |
| Arbitrum | ARBUSDT | Grid, Futures | Bybit + KuCoin |
| Sui | SUIUSDT | Grid, Futures | Bybit + KuCoin |
| Oro | XAUUSDT | Scalping, Futures | Solo Bybit |
| S&P 500 | SP500USDT | Futures | Solo Bybit |

---

## 11. Notificaciones Telegram

El bot envía notificaciones en tiempo real por Telegram para los siguientes eventos:

| Evento | Ejemplo |
|---|---|
| Grid Profit | "Grid Profit: BTCUSDT — Compra: $77,800 → Venta: $78,200 — Ganancia: $4.12 (0.53%)" |
| Scalping Profit | "Scalping Profit: ETHUSDT — Compra: $2,300 → Venta: $2,315 — Ganancia: $1.50 (0.65%)" |
| Futures Open | "Futures LONG: BTCUSDT — Entry: $78,000 — Leverage: 5x — Score: 72 — Régimen: trending" |
| Futures Close | "Futures Close: BTCUSDT LONG — Entry: $78,000 → Exit: $78,500 — PnL: +$32.05" |
| Meta Diaria | "Meta diaria alcanzada: +2.3% — Modo CAUTIOUS activado" |
| Resumen Diario | Resumen completo con balances, PnL, operaciones, win rate |
| Oportunidad | "Oportunidad: SOLUSDT — Score: 82 — Dirección: BUY — Régimen: trending" |
| Orden Fallida | "Orden Fallida: ETHUSDT Sell — Razón: insufficient balance" |

### 11.1 Comandos Telegram

El bot responde a comandos enviados por Telegram:

| Comando | Función |
|---|---|
| `/start` | Mensaje de bienvenida |
| `/status` | Estado actual: balances, PnL, posiciones abiertas, win rate |
| `/stop` | Detener el bot |

---

## 12. Auto-Convert a USDT

El módulo de Auto-Convert se ejecuta cada 2.5 minutos y realiza lo siguiente:

1. Obtiene todos los balances de monedas en Bybit y KuCoin.
2. Para cada moneda que NO sea USDT y tenga un balance > $1:
   - Verifica si tiene posiciones abiertas (Grid, Scalping, Futures). Si tiene, la salta.
   - Calcula el precio promedio de compra desde el historial de trades.
   - Calcula si vender al precio actual generaría al menos 0.5% de ganancia neta.
   - Si sí, ejecuta una orden de venta al mercado.
   - Si no, la mantiene (HOLD) hasta que el precio suba lo suficiente.

---

## 13. Dashboard Web

El bot incluye un dashboard web completo accesible desde el navegador, con las siguientes páginas:

### 13.1 Panel Principal

Muestra en tiempo real: precios de BTC, ETH, Oro y S&P 500, balance total, PnL del día, ganancia real acumulada, posiciones abiertas, win rate, y las últimas operaciones. Incluye botones para Iniciar, Detener y Parada de Emergencia del bot.

### 13.2 Estrategias

Lista todas las estrategias activas con su configuración, PnL individual, número de trades, y un gráfico de velas (candlestick) para cada moneda.

### 13.3 Historial de Trades

Tabla completa de todas las operaciones ejecutadas con filtros por moneda, estrategia y fecha. Incluye exportación a CSV.

### 13.4 Oportunidades

Señales detectadas por el scanner con score de confianza, indicadores y precio.

### 13.5 Analista IA

Análisis de mercado generado por LLM (inteligencia artificial) con overview del mercado, análisis de activos, evaluación de riesgos y oportunidades inteligentes.

### 13.6 Claves API

Formulario para guardar las claves API de Bybit y KuCoin de forma segura.

### 13.7 Ajustes

Configuración del bot: modo simulación, capital inicial, selección de exchange, configuración de Telegram.

---

## 14. Deployment en VPS

### 14.1 Requisitos

- VPS con Ubuntu 22.04+ (mínimo 2GB RAM, 2 CPU)
- Docker y Docker Compose instalados
- Claves API de Bybit y/o KuCoin

### 14.2 Pasos de Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/tibu2302/phantom.git
cd phantom

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con las credenciales

# 3. Build y deploy
docker compose build --no-cache
docker compose up -d

# 4. Verificar
docker compose logs -f phantom_app
```

### 14.3 Actualización

```bash
cd /root/phantom-bot
git pull origin main
docker compose build --no-cache
docker compose up -d
```

---

## 15. Seguridad

### 15.1 Claves API

Las claves API de los exchanges se almacenan en la base de datos. Se recomienda crear claves API con permisos limitados: solo "Trade" y "Read", sin permisos de retiro.

### 15.2 Autenticación

El dashboard web usa autenticación local con usuario y contraseña (hash bcrypt). En el entorno de Manus, usa OAuth integrado.

### 15.3 Modo Simulación

El bot puede operar en modo simulación donde todas las órdenes son simuladas (no se ejecutan en el exchange real). Esto permite probar estrategias sin riesgo.

---

## 16. Resumen de Versiones

| Versión | Fecha | Cambios Principales |
|---|---|---|
| v1.0 | Abril 2026 | Bot básico: Grid BTC/ETH, Dashboard |
| v2.0 | Abril 2026 | Multi-exchange (Bybit + KuCoin), Scalping XAU |
| v3.0 | Abril 2026 | Futures Long-Only, DCA, Telegram |
| v4.0 | Abril 2026 | Trailing Stop, Grid Dinámico, 10 monedas |
| v5.0 | Abril 2026 | VPS Deployment, Docker, Auth Local |
| v6.0 | Abril 2026 | Smart Analysis (11 indicadores), Score de Confianza |
| v6.1 | Abril 2026 | Sin Stop-Loss, 0.5% mínimo neto |
| v6.2 | Abril 2026 | Meta Diaria Inteligente (2-5%) |
| v6.3 | Abril 2026 | USDT-First, Futures Multi-Moneda |
| v6.4 | Abril 2026 | Notificaciones Futures, Optimización Agresiva |
| **v7.0** | **Abril 2026** | **Superintelligence Engine — 19 Módulos** |

---

## 17. Estadísticas Actuales

| Métrica | Valor |
|---|---|
| Capital Total | ~$8,379 (Bybit $7,164 + KuCoin $1,214) |
| Ganancia Real | +$69.29 (0.8%) |
| Win Rate | 62% (353 ventas) |
| Monedas Operadas | 12 (10 crypto + Oro + SP500) |
| Estrategias Activas | 3 (Grid + Scalping + Futures) |
| Tests Automatizados | 38 (todos pasando) |
| Líneas de Código | ~5,000+ (motor + inteligencia) |

---

## 18. Glosario

| Término | Definición |
|---|---|
| **Grid Trading** | Estrategia que coloca órdenes de compra y venta en niveles predefinidos |
| **Scalping** | Operaciones rápidas de corto plazo basadas en análisis técnico |
| **Futures** | Contratos derivados que permiten LONG (apuesta a subida) y SHORT (apuesta a bajada) con apalancamiento |
| **LINEAR** | Tipo de contrato perpetuo liquidado en USDT |
| **Trailing Stop** | Stop que sigue el precio mientras se mueve a favor y se activa cuando retrocede |
| **ATR** | Average True Range — medida de volatilidad |
| **RSI** | Relative Strength Index — indicador de sobrecompra/sobreventa |
| **MACD** | Moving Average Convergence Divergence — indicador de tendencia |
| **Funding Rate** | Pago periódico entre LONG y SHORT en contratos perpetuos |
| **DCA** | Dollar Cost Averaging — comprar más cuando el precio baja |
| **Kelly Criterion** | Fórmula matemática para calcular el tamaño óptimo de posición |
| **Drawdown** | Pérdida máxima desde el punto más alto |
| **USDT** | Tether — stablecoin atada al dólar estadounidense |
| **WebSocket** | Conexión en tiempo real para recibir precios instantáneamente |
| **tRPC** | Framework de API tipada end-to-end |

---

*Documento generado el 23 de Abril de 2026. PHANTOM Trading Bot v7.0 — Superintelligence Engine.*
