# PHANTOM Trading Bot v8.0 — Documentación Completa

## Superintelligence AI Engine

---

**Versión:** 8.0  
**Fecha:** 23 de Abril de 2026  
**Autor:** PHANTOM Development Team  
**Exchanges:** Bybit (primario) + KuCoin (secundario)  
**Estrategias:** Grid Trading + Scalping + Futures (LONG & SHORT)  
**Módulos de IA:** 39+ componentes de inteligencia artificial  
**Filosofía:** NUNCA vender en pérdida — mínimo 0.5% de ganancia neta por operación

---

## Tabla de Contenidos

1. Visión General
2. Arquitectura del Sistema
3. Estrategias de Trading
4. Smart Analysis Engine (v6.0)
5. Market Intelligence Engine (v7.0)
6. AI Engine — Machine Learning (v8.0)
7. Advanced Data Engine (v8.0)
8. Advanced Strategies Engine (v8.0)
9. Auto-Optimizer Engine (v8.0)
10. Sistema de Protección Anti-Pérdidas
11. Sistema de Objetivo Diario
12. Auto-Convert a USDT
13. Notificaciones por Telegram
14. Símbolos y Mercados Soportados
15. Dashboard Web — AI Intelligence
16. Despliegue en VPS con Docker
17. Variables de Entorno
18. Resumen de Módulos de IA

---

## 1. Visión General

PHANTOM es un bot de trading automatizado 24/7 que opera en los exchanges Bybit y KuCoin simultáneamente. Utiliza una combinación de 39+ módulos de inteligencia artificial para analizar mercados, detectar oportunidades y ejecutar operaciones con la máxima precisión posible.

El bot opera bajo una filosofía estricta de **cero pérdidas**: nunca cierra una posición en negativo. Cada venta requiere un mínimo de 0.5% de ganancia neta después de comisiones. Si el mercado se mueve en contra, el bot simplemente mantiene la posición hasta que se recupere.

Las tres estrategias principales son:

- **Grid Trading**: Compra y venta en niveles predefinidos que se ajustan dinámicamente según la volatilidad del mercado. Opera en contratos lineales (USDT-settled) en Bybit.
- **Scalping**: Operaciones rápidas aprovechando micro-movimientos de precio con análisis técnico avanzado de 11 indicadores.
- **Futures**: Posiciones LONG y SHORT en perpetuos lineales de Bybit con apalancamiento controlado (5x), take profit dinámico y trailing stops.

---

## 2. Arquitectura del Sistema

El sistema está construido con TypeScript y se ejecuta como una aplicación Node.js dentro de un contenedor Docker.

### Componentes Principales

| Componente | Archivo | Descripción |
|---|---|---|
| Motor de Trading | `tradingEngine.ts` | Orquestador principal — Grid, Scalping, Futures, Scanner |
| Smart Analysis | `smartAnalysis.ts` | 11 indicadores técnicos + scoring de confianza |
| Market Intelligence | `marketIntelligence.ts` | 19 módulos de inteligencia de mercado |
| AI Engine | `aiEngine.ts` | Sentiment Analysis, Fear & Greed, Pattern Recognition, RL |
| Advanced Data | `advancedData.ts` | On-Chain, Open Interest, Liquidations, Whales |
| Advanced Strategies | `advancedStrategies.ts` | DCA, Pairs Trading, Momentum, Smart Exit, News |
| Auto-Optimizer | `autoOptimizer.ts` | Auto-Tuning, Microstructure, Markowitz, Adaptive Learning |
| Auto-Convert | `autoConvert.ts` | Conversión automática de monedas a USDT |
| API Router | `routers.ts` | Endpoints tRPC para dashboard web |
| Base de Datos | `db.ts` | Helpers de consulta con Drizzle ORM |

### Ciclos de Ejecución

| Ciclo | Intervalo | Función |
|---|---|---|
| Main Loop | 15 segundos | Ejecuta Grid + Scalping + Futures |
| Scanner | 1 minuto | Escanea 30+ monedas buscando oportunidades |
| Auto-Convert | 2.5 minutos | Convierte monedas acumuladas a USDT |
| Reporte Telegram | 4 horas | Envía resumen de PnL y posiciones |

### Flujo de Datos

```
Precio en Tiempo Real (WebSocket Bybit + KuCoin)
        ↓
Smart Analysis (11 indicadores → score 0-100)
        ↓
Market Intelligence (19 módulos → Master Signal)
        ↓
AI Engine (Sentiment + Fear/Greed + Patterns + RL)
        ↓
Advanced Data (On-Chain + OI + Liquidations + Whales)
        ↓
Auto-Optimizer (ajusta parámetros en tiempo real)
        ↓
Advanced Strategies (DCA + Pairs + Momentum + Smart Exit)
        ↓
Motor de Trading (ejecuta orden en Bybit/KuCoin)
        ↓
Feedback Loop (resultado → RL + Adaptive Learning)
```

---

## 3. Estrategias de Trading

### 3.1 Grid Trading

El Grid Trading crea una "rejilla" de órdenes de compra y venta a diferentes niveles de precio. Cuando el precio sube, vende en los niveles superiores. Cuando baja, compra en los niveles inferiores. Cada ciclo completo (compra + venta) genera una ganancia.

**Configuración:**
- Modo: LINEAR (contratos USDT-settled en Bybit)
- Máximo de posiciones: 5
- Spread dinámico: ajustado por volatilidad (ATR)
- Trailing stop: sigue el precio mientras sube
- Max hold: 4 horas (luego intenta cerrar en ganancia)
- Confianza mínima: 20 (score del Smart Analysis)
- Reinversión automática: las ganancias aumentan el tamaño de las órdenes

**Protecciones:**
- Detección de tendencia EMA 20/50: no compra en mercado bajista
- Verificación de spread > comisiones antes de cada orden
- Regeneración automática del grid cuando el precio se aleja del centro
- Anti-manipulación: detecta volumen anómalo y suspende operaciones

### 3.2 Scalping

El Scalping busca ganancias rápidas en micro-movimientos de precio. Utiliza los 11 indicadores del Smart Analysis más el Master Signal del Market Intelligence para identificar puntos de entrada precisos.

**Configuración:**
- Máximo de posiciones: 3
- Confianza mínima: 30 (score del Smart Analysis)
- Trailing stop dinámico basado en ATR
- Multi-timeframe: analiza 5m, 15m y 1h antes de entrar
- Boost de sizing: 1.5-2x en señales fuertes

**Pares de Scalping:**
- BTC/USDT, ETH/USDT, SOL/USDT (spot + linear)
- XAUUSDT (Oro — siempre en Bybit)

### 3.3 Futures (LONG + SHORT)

La estrategia de Futures opera contratos perpetuos lineales en Bybit con posiciones tanto LONG como SHORT. Esto permite ganar tanto en mercados alcistas como bajistas.

**Configuración:**
- Apalancamiento: 5x
- Máximo de posiciones: 5
- Confianza mínima: 35 (score del Smart Analysis)
- Take Profit dinámico: basado en ATR y régimen de mercado
- Trailing stop: protege ganancias mientras el precio se mueve a favor
- Boost de sizing: 1.5-2x en señales con score > 70

**Símbolos de Futures:**
BTC, ETH, SOL, XRP, AVAX, DOGE, LINK, ARB, SUI, ADA, XAU, SP500

---

## 4. Smart Analysis Engine (v6.0)

El Smart Analysis Engine es el cerebro analítico base del bot. Calcula un **score de confianza de 0 a 100** para cada par de trading usando 11 indicadores técnicos.

### 4.1 Indicadores Técnicos

| # | Indicador | Descripción | Peso |
|---|---|---|---|
| 1 | RSI (14) | Relative Strength Index — sobrecompra/sobreventa | Alto |
| 2 | MACD | Moving Average Convergence Divergence — momentum | Alto |
| 3 | Bollinger Bands | Bandas de volatilidad — mean reversion | Medio |
| 4 | ATR (14) | Average True Range — volatilidad absoluta | Medio |
| 5 | ADX (14) | Average Directional Index — fuerza de tendencia | Medio |
| 6 | Stochastic RSI | RSI del RSI — timing preciso | Medio |
| 7 | OBV | On-Balance Volume — presión de volumen | Bajo |
| 8 | VWAP | Volume-Weighted Average Price — precio justo | Bajo |
| 9 | Williams %R | Oscilador de momentum — extremos | Bajo |
| 10 | RSI Divergence | Divergencia entre precio y RSI | Alto |
| 11 | MACD Divergence | Divergencia entre precio y MACD | Alto |

### 4.2 Detección de Régimen de Mercado

El sistema clasifica el mercado en uno de cuatro regímenes:

| Régimen | Condición | Acción del Bot |
|---|---|---|
| **Trending Up** | ADX > 25 + precio > EMA50 | Compras agresivas, trailing stops amplios |
| **Trending Down** | ADX > 25 + precio < EMA50 | Solo shorts en futures, grid pausa compras |
| **Ranging** | ADX < 20 | Grid con spreads ajustados, scalping activo |
| **Volatile** | ATR > 2x promedio | Reduce tamaño de posición, spreads amplios |

### 4.3 Score de Confianza

El score final (0-100) se calcula como un promedio ponderado de todos los indicadores. Cada indicador contribuye una señal de -1 (venta fuerte) a +1 (compra fuerte), que se normaliza a un rango de 0-100.

- **0-20**: Señal de venta fuerte
- **20-40**: Señal de venta moderada
- **40-60**: Neutral
- **60-80**: Señal de compra moderada
- **80-100**: Señal de compra fuerte

---

## 5. Market Intelligence Engine (v7.0)

El Market Intelligence Engine agrega 19 módulos de inteligencia que van más allá del análisis técnico tradicional.

### 5.1 Multi-Timeframe Analysis (MTA)

Analiza tres timeframes simultáneamente (5m, 15m, 1h) y solo opera cuando los tres están alineados en la misma dirección. Esto filtra señales falsas y aumenta la probabilidad de éxito.

### 5.2 BTC-Alt Correlation

Monitorea la correlación entre Bitcoin y las altcoins. Cuando BTC sube fuerte, las alts tienden a seguir con delay. El bot detecta este patrón y entra en alts antes del movimiento.

### 5.3 Order Book Imbalance

Analiza la profundidad del libro de órdenes para detectar desequilibrios entre compradores y vendedores. Un ratio > 1.5 indica presión compradora; < 0.67 indica presión vendedora.

### 5.4 Funding Rate Analysis

En futuros perpetuos, el funding rate indica el sentimiento del mercado. Un funding rate muy positivo sugiere exceso de longs (posible corrección); muy negativo sugiere exceso de shorts (posible squeeze).

### 5.5 Liquidation Detection

Detecta zonas donde se acumulan liquidaciones masivas. Cuando el precio se acerca a estas zonas, puede haber movimientos violentos (cascadas de liquidación).

### 5.6 Mean Reversion

Identifica cuando el precio se ha alejado significativamente de su media (usando Bollinger Bands y Z-score). Apuesta a que el precio volverá a la media.

### 5.7 Breakout Detection

Detecta rupturas de rangos de consolidación con confirmación de volumen. Solo entra en breakouts con volumen > 1.5x del promedio.

### 5.8 Arbitrage Scanner

Compara precios entre Bybit y KuCoin en tiempo real. Cuando la diferencia supera las comisiones + slippage, ejecuta arbitraje.

### 5.9 Kelly Criterion

Calcula el tamaño óptimo de posición usando la fórmula de Kelly basada en el win rate y el ratio ganancia/pérdida histórico.

### 5.10 Compound Interest

Reinvierte las ganancias automáticamente para aprovechar el interés compuesto. El capital crece exponencialmente con cada trade ganador.

### 5.11 Market Sessions

Ajusta la agresividad según la sesión de mercado activa:

| Sesión | Horario (UTC) | Comportamiento |
|---|---|---|
| Asia | 00:00 - 08:00 | Moderado, spreads normales |
| Europa | 08:00 - 16:00 | Activo, más oportunidades |
| América | 13:00 - 21:00 | Máxima volatilidad, sizing reducido |
| Overlap EU-US | 13:00 - 16:00 | Máximo volumen, mejores oportunidades |

### 5.12 Drawdown Protection

Monitorea el drawdown en tiempo real. Si las pérdidas no realizadas superan el 3% del capital, reduce el tamaño de nuevas posiciones. Si superan el 5%, pausa nuevas entradas.

### 5.13 Diversification

Limita la exposición a un solo activo al 30% del capital total. Distribuye el capital entre Grid, Scalping y Futures para reducir el riesgo.

### 5.14 Anti-Manipulation Detection

Detecta patrones de manipulación como:
- Spoofing: órdenes grandes que aparecen y desaparecen
- Wash trading: volumen artificial sin cambio de precio
- Pump & dump: subida rápida seguida de caída

### 5.15 Master Signal

El Master Signal es el agregador final que combina todas las señales de los 19 módulos en una sola recomendación. Cada módulo vota con un peso específico, y el resultado final es un score de -100 (venta extrema) a +100 (compra extrema).

### Módulos Adicionales (5.16-5.19)

| # | Módulo | Función |
|---|---|---|
| 16 | Volume Spikes | Detecta picos de volumen anómalos |
| 17 | Intraday Momentum | Momentum intradía para timing |
| 18 | Capital Distribution | Distribución óptima entre estrategias |
| 19 | Adaptive Grid | Grid que se adapta al régimen de mercado |

---

## 6. AI Engine — Machine Learning (v8.0)

El AI Engine introduce capacidades de machine learning real al bot.

### 6.1 Sentiment Analysis con LLM

Analiza noticias y tweets sobre criptomonedas en tiempo real usando un modelo de lenguaje (LLM). Clasifica el sentimiento como bullish, bearish o neutral, y asigna un score de impacto.

**Fuentes de datos:**
- Noticias crypto (CoinDesk, CoinTelegraph, etc.)
- Twitter/X (cuentas influyentes)
- Reddit (r/cryptocurrency, r/bitcoin)
- Telegram (canales de señales)

**Output:** Score de sentimiento de -100 (extremadamente bearish) a +100 (extremadamente bullish).

### 6.2 Fear & Greed Index

Integra el índice de miedo y codicia del mercado crypto. Este índice combina:
- Volatilidad del mercado (25%)
- Momentum y volumen (25%)
- Redes sociales (15%)
- Dominancia de Bitcoin (10%)
- Google Trends (10%)
- Encuestas (15%)

**Interpretación:**

| Rango | Estado | Acción del Bot |
|---|---|---|
| 0-25 | Miedo Extremo | Oportunidad de compra (contrarian) |
| 25-45 | Miedo | Cautela, posiciones pequeñas |
| 45-55 | Neutral | Operación normal |
| 55-75 | Codicia | Tomar ganancias parciales |
| 75-100 | Codicia Extrema | Reducir exposición, preparar shorts |

### 6.3 Pattern Recognition

Detecta automáticamente patrones de velas japonesas en múltiples timeframes:

- **Bullish:** Hammer, Morning Star, Bullish Engulfing, Three White Soldiers, Dragonfly Doji
- **Bearish:** Shooting Star, Evening Star, Bearish Engulfing, Three Black Crows, Gravestone Doji
- **Continuación:** Rising Three Methods, Falling Three Methods
- **Reversión:** Head & Shoulders, Double Top/Bottom, Cup & Handle

Cada patrón detectado ajusta el score de confianza del Smart Analysis.

### 6.4 Anomaly Detection

Detecta anomalías en el mercado que podrían indicar manipulación o eventos extraordinarios:

- **Flash Crashes:** Caídas de > 5% en menos de 1 minuto
- **Pump & Dump:** Subida de > 10% seguida de caída de > 7%
- **Volume Anomalies:** Volumen > 5x del promedio sin movimiento de precio
- **Price Gaps:** Diferencias de precio entre exchanges > 2%

Cuando se detecta una anomalía, el bot pausa nuevas entradas y alerta por Telegram.

### 6.5 Reinforcement Learning

El bot aprende de sus propios trades usando un sistema de reinforcement learning simplificado:

- **Estado:** Indicadores técnicos + régimen de mercado + posiciones abiertas
- **Acción:** Comprar, vender, mantener, ajustar tamaño
- **Recompensa:** PnL realizado del trade

El sistema mantiene un historial de trades con sus contextos y resultados. Cuando encuentra una situación similar a una pasada, ajusta su comportamiento basándose en si el trade anterior fue ganador o perdedor.

**Feedback Loop:** Después de cada venta, el resultado se envía al módulo de RL que actualiza los pesos de decisión para situaciones similares futuras.

---

## 7. Advanced Data Engine (v8.0)

El Advanced Data Engine recopila y analiza datos que van más allá de los precios y volúmenes tradicionales.

### 7.1 On-Chain Analytics

Monitorea la blockchain para detectar movimientos significativos:

- **Whale Movements:** Transferencias de > $1M entre wallets
- **Exchange Inflows:** Depósitos grandes a exchanges (señal de venta)
- **Exchange Outflows:** Retiros grandes de exchanges (señal de acumulación)
- **Active Addresses:** Cambios en el número de direcciones activas
- **Hash Rate:** Cambios en el poder de minería (para BTC)

### 7.2 Open Interest Analysis

Analiza el Open Interest (OI) de futuros para predecir movimientos:

| Escenario | OI | Precio | Interpretación |
|---|---|---|---|
| Nuevos longs | ↑ | ↑ | Tendencia alcista fuerte |
| Short squeeze | ↓ | ↑ | Shorts cerrando — rally temporal |
| Nuevos shorts | ↑ | ↓ | Tendencia bajista fuerte |
| Long liquidation | ↓ | ↓ | Longs cerrando — caída temporal |

### 7.3 Liquidation Heatmap

Mapea las zonas de precio donde se acumulan liquidaciones masivas. Estas zonas actúan como "imanes" para el precio, ya que los market makers buscan activar estas liquidaciones.

El bot usa esta información para:
- Evitar entrar cerca de zonas de liquidación masiva
- Anticipar movimientos violentos cuando el precio se acerca a estas zonas
- Posicionarse para beneficiarse de cascadas de liquidación

### 7.4 Whale Alert

Monitorea transacciones grandes en tiempo real:
- Transferencias de > $10M entre wallets
- Depósitos/retiros grandes de exchanges
- Movimientos de wallets conocidas (fondos, instituciones)

Cuando se detecta un movimiento de ballena, el bot ajusta su posicionamiento:
- Whale deposit a exchange → Preparar para posible venta
- Whale withdrawal de exchange → Señal de acumulación

### 7.5 Cross-Exchange Intelligence

Compara datos entre múltiples exchanges en tiempo real:

| Exchange | Datos Monitoreados |
|---|---|
| Bybit | Precios, OI, funding rate, liquidaciones |
| KuCoin | Precios, volumen, order book |
| Binance | Precios de referencia, OI, volumen |
| OKX | Precios, funding rate |
| Coinbase | Precios spot (referencia institucional) |

Detecta divergencias de precio entre exchanges que pueden indicar oportunidades de arbitraje o movimientos inminentes.

---

## 8. Advanced Strategies Engine (v8.0)

### 8.1 DCA Inteligente

Dollar Cost Averaging con timing de IA. En lugar de comprar todo de una vez, divide la entrada en 3-5 partes:

1. **Primera entrada (30%):** Cuando el score > umbral mínimo
2. **Segunda entrada (25%):** Si el precio baja 1-2% (mejor precio promedio)
3. **Tercera entrada (25%):** Si el precio baja otro 1-2%
4. **Cuarta entrada (15%):** Si hay señal de reversión
5. **Quinta entrada (5%):** Reserva para oportunidades extremas

El timing de cada entrada se optimiza usando el AI Engine y el Market Intelligence.

### 8.2 Pairs Trading

Identifica pares de criptomonedas altamente correlacionadas (ej: BTC/ETH, SOL/AVAX) y apuesta a que la correlación se mantendrá:

- Cuando el spread entre el par se amplía → Compra el rezagado, vende el líder
- Cuando el spread se normaliza → Cierra ambas posiciones con ganancia

**Pares monitoreados:** BTC/ETH, SOL/AVAX, LINK/ARB, DOGE/SUI, ADA/XRP

### 8.3 Momentum Cascade

Detecta "cascadas de momentum" donde una moneda líder sube y las demás siguen con delay:

1. BTC sube 3% → Espera 5-15 minutos
2. ETH empieza a subir → Confirma la cascada
3. Entra en SOL, AVAX, LINK (que aún no subieron)
4. Sale cuando el momentum se agota

### 8.4 Smart Exit con IA

Predice el punto óptimo de salida usando múltiples señales:

- **Resistencias técnicas:** Niveles donde el precio históricamente se detiene
- **Fibonacci Extensions:** Proyecciones de precio basadas en retrocesos
- **Volume Profile:** Zonas de alto volumen (soporte/resistencia)
- **AI Prediction:** El modelo de RL predice la probabilidad de que el precio siga subiendo

El Smart Exit ajusta el take profit dinámicamente: si la IA predice que el precio seguirá subiendo, amplía el TP. Si predice reversión, cierra antes.

### 8.5 News Trading Automático

Procesa noticias en tiempo real y ejecuta trades antes de que el mercado reaccione completamente:

- **Noticias positivas:** Listados en exchanges, partnerships, actualizaciones de protocolo → Compra rápida
- **Noticias negativas:** Hacks, regulaciones adversas, delistings → Cierra posiciones o abre shorts
- **Noticias macro:** Decisiones de la Fed, datos de inflación, geopolítica → Ajusta exposición general

El procesamiento se realiza con LLM que clasifica la noticia, estima el impacto y genera una señal de trading en < 5 segundos.

---

## 9. Auto-Optimizer Engine (v8.0)

### 9.1 Auto-Tuning de Parámetros

El bot ajusta automáticamente sus parámetros basándose en el rendimiento reciente:

| Parámetro | Rango | Ajuste |
|---|---|---|
| Grid Spread Multiplier | 0.5x - 2.0x | ↑ si muchas pérdidas, ↓ si muchas ganancias |
| Scalping Confidence Min | 20 - 60 | ↑ si win rate bajo, ↓ si win rate alto |
| Futures Confidence Min | 25 - 70 | ↑ si drawdown alto, ↓ si performance buena |
| Grid Confidence Min | 15 - 50 | Ajuste basado en completions del grid |
| Max Positions Grid | 2 - 8 | ↑ en mercado favorable, ↓ en adverso |
| Max Positions Futures | 1 - 6 | Basado en volatilidad y drawdown |
| Trailing Stop Multiplier | 0.5x - 2.0x | ↑ en trending, ↓ en ranging |
| Position Size Multiplier | 0.5x - 2.0x | Basado en Kelly Criterion + drawdown |

El ajuste ocurre cada 100 trades o cada 4 horas, lo que ocurra primero.

### 9.2 Market Microstructure

Analiza el flujo de órdenes tick-by-tick para micro-timing:

- **Trade Flow Imbalance:** Ratio de volumen de compra vs venta en los últimos N ticks
- **Order Book Pressure:** Profundidad del bid vs ask en los primeros 5 niveles
- **Spread Analysis:** Spread bid-ask como indicador de liquidez
- **Trade Size Distribution:** Detecta si dominan trades grandes (institucionales) o pequeños (retail)

### 9.3 Portfolio Optimization (Markowitz)

Implementa la teoría de portfolio de Markowitz para encontrar la combinación óptima de activos:

- Calcula la matriz de covarianza entre todos los activos
- Encuentra la frontera eficiente (máximo retorno para cada nivel de riesgo)
- Asigna capital según el portfolio de mínima varianza o máximo Sharpe ratio

**Restricciones:**
- Máximo 30% en un solo activo
- Mínimo 10% en stablecoins (USDT) como reserva
- Rebalanceo cada 24 horas o cuando la desviación > 10%

### 9.4 Adaptive Learning Rate

La "agresividad" del bot se ajusta dinámicamente basándose en rachas de rendimiento:

| Racha | Agresividad | Efecto |
|---|---|---|
| 5+ wins seguidos | Alta (1.5x) | Más posiciones, sizing mayor |
| 3+ losses seguidos | Baja (0.5x) | Menos posiciones, sizing menor |
| Win rate > 70% (últimos 50) | Alta | Confianza en las señales |
| Win rate < 40% (últimos 50) | Mínima | Solo trades de alta confianza |
| Drawdown > 3% | Reducida | Protección de capital |

---

## 10. Sistema de Protección Anti-Pérdidas

El principio fundamental de PHANTOM es **NUNCA vender en pérdida**. Este principio se aplica en todos los niveles:

### 10.1 Regla del 0.5% Mínimo

Cada venta debe generar al menos 0.5% de ganancia neta después de comisiones. El cálculo incluye:

```
Ganancia Neta = (Precio Venta × Cantidad) - (Precio Compra × Cantidad) - Comisiones
Comisiones = (Precio Compra × Cantidad × Fee%) + (Precio Venta × Cantidad × Fee%)
Ganancia % = Ganancia Neta / (Precio Compra × Cantidad) × 100

Si Ganancia % < 0.5% → NO VENDER → MANTENER
```

### 10.2 Sin Stop-Loss

El bot no tiene stop-loss. Si el precio baja después de comprar:
- **Grid:** Mantiene la posición y espera a que el precio vuelva al nivel de venta
- **Scalping:** Mantiene y espera recuperación
- **Futures:** Mantiene la posición (apalancamiento bajo de 5x permite aguantar caídas significativas)

### 10.3 Auto-Convert Seguro

El módulo de auto-convert que convierte monedas a USDT también respeta la regla:
- Si tiene historial de compra → Solo vende si precio actual > precio promedio de compra + 0.5%
- Si no tiene historial → Vende para liberar capital (asume que fue un residuo)

### 10.4 Cooldown por Pérdida

Si algún trade se cierra con ganancia menor al esperado, el bot activa un cooldown de 5 minutos para ese par, evitando re-entrar inmediatamente en condiciones desfavorables.

---

## 11. Sistema de Objetivo Diario

El bot tiene un sistema de objetivo diario que controla la agresividad:

| Ganancia Diaria | Modo | Comportamiento |
|---|---|---|
| < 2% | **Normal** | Opera con todos los parámetros estándar |
| 2% - 5% | **Cautious** | Solo opera si score ≥ 75 (alta confianza) |
| > 5% | **Stopped** | No abre nuevas posiciones (las existentes siguen) |

El objetivo es mantener ganancias consistentes de 2-5% diario sin arriesgar el capital con operaciones innecesarias después de alcanzar el target.

---

## 12. Auto-Convert a USDT

El módulo de auto-convert se ejecuta cada 2.5 minutos y:

1. Escanea el balance de todas las monedas en Bybit y KuCoin
2. Para cada moneda con balance > $1:
   - Busca el precio promedio de compra en el historial de trades
   - Si precio actual > precio promedio + 0.5% → Vende a USDT
   - Si precio actual < precio promedio → Mantiene (NUNCA vende en pérdida)
   - Si no hay historial → Vende para liberar capital
3. Reporta por Telegram cada conversión exitosa

**Filosofía USDT-First:** El bot nunca mantiene monedas innecesariamente. Todo el capital debe estar en USDT cuando no hay posiciones abiertas.

---

## 13. Notificaciones por Telegram

El bot envía notificaciones por Telegram para los siguientes eventos:

| Evento | Contenido |
|---|---|
| Trade ejecutado | Símbolo, tipo (compra/venta), precio, cantidad, PnL |
| Futures abierto | Símbolo, dirección (LONG/SHORT), score, régimen, razones |
| Futures cerrado | Símbolo, PnL realizado, duración |
| Oportunidad detectada | Símbolo, score, indicadores clave |
| Objetivo diario alcanzado | PnL del día, modo activado (cautious/stopped) |
| Anomalía detectada | Tipo de anomalía, símbolo, detalles |
| Reporte periódico (4h) | Resumen de PnL, posiciones abiertas, balance |
| Auto-convert | Moneda convertida, cantidad, PnL de la conversión |

---

## 14. Símbolos y Mercados Soportados

### Grid Trading (Spot/Linear)

| Símbolo | Bybit | KuCoin |
|---|---|---|
| BTC/USDT | Linear | Spot |
| ETH/USDT | Linear | Spot |
| SOL/USDT | Linear | Spot |
| XRP/USDT | Linear | Spot |
| DOGE/USDT | Linear | Spot |
| ADA/USDT | Linear | Spot |
| AVAX/USDT | Linear | Spot |
| LINK/USDT | Linear | Spot |
| ARB/USDT | Linear | Spot |
| SUI/USDT | Linear | Spot |

### Scalping

| Símbolo | Exchange | Tipo |
|---|---|---|
| BTC/USDT | Bybit + KuCoin | Spot/Linear |
| ETH/USDT | Bybit + KuCoin | Spot/Linear |
| SOL/USDT | Bybit + KuCoin | Spot/Linear |
| XAUUSDT | Bybit | Linear (Oro) |

### Futures (LONG + SHORT)

| Símbolo | Exchange | Apalancamiento |
|---|---|---|
| BTCUSDT | Bybit Linear | 5x |
| ETHUSDT | Bybit Linear | 5x |
| SOLUSDT | Bybit Linear | 5x |
| XRPUSDT | Bybit Linear | 5x |
| AVAXUSDT | Bybit Linear | 5x |
| DOGEUSDT | Bybit Linear | 5x |
| LINKUSDT | Bybit Linear | 5x |
| ARBUSDT | Bybit Linear | 5x |
| SUIUSDT | Bybit Linear | 5x |
| ADAUSDT | Bybit Linear | 5x |
| XAUUSDT | Bybit Linear | 5x |
| SP500USDT | Bybit Linear | 5x |

---

## 15. Dashboard Web — AI Intelligence

La aplicación web proporciona un dashboard completo para monitorear el bot en tiempo real.

### Páginas del Dashboard

| Página | Descripción |
|---|---|
| **Panel** | Balance total, PnL diario, precios en vivo, últimas operaciones |
| **Estrategias** | Configuración de cada estrategia con gráficos de velas |
| **Analista IA** | Análisis de mercado generado por LLM |
| **AI Intelligence** | Fear & Greed, Learning Insights, Auto-Optimizer, Performance |
| **Oportunidades** | Scanner de 30+ monedas con scores de confianza |
| **Historial** | Tabla de todas las operaciones con exportación a CSV |
| **Claves API** | Configuración de API keys para Bybit y KuCoin |
| **Ajustes** | Modo simulación, capital invertido, configuración general |

### Página AI Intelligence (v8.0)

La nueva página de AI Intelligence muestra en tiempo real:

1. **Fear & Greed Gauge:** Indicador visual con aguja del índice de miedo/codicia (0-100)
2. **Learning Insights:** Estado del Reinforcement Learning — trades analizados, win rate, confianza del modelo, última actualización
3. **Auto-Optimizer:** Parámetros actuales del auto-tuning — grid spread, confianza mínima por estrategia, sizing, trailing stop
4. **Performance Report:** Métricas avanzadas — total trades, win rate, PnL total, Sharpe ratio, profit factor, max drawdown, rendimiento por estrategia

---

## 16. Despliegue en VPS con Docker

### Requisitos

- VPS con Ubuntu 22.04+ (mínimo 2GB RAM, 2 vCPU)
- Docker y Docker Compose instalados
- API Keys de Bybit y/o KuCoin
- Token de bot de Telegram (opcional)

### Comandos de Despliegue

```bash
# Primera vez:
git clone https://github.com/tibu2302/phantom.git /root/phantom-bot
cd /root/phantom-bot
cp .env.example .env
# Editar .env con tus API keys
docker compose build --no-cache
docker compose up -d

# Actualizar a nueva versión:
cd /root/phantom-bot
git pull origin main
docker compose build --no-cache
docker compose up -d

# Ver logs:
docker compose logs -f --tail 100

# Reiniciar:
docker compose restart

# Detener:
docker compose down
```

### Docker Compose

El `docker-compose.yml` incluye:
- **App:** Contenedor Node.js con el bot + dashboard web
- **MySQL:** Base de datos para trades, estrategias, estado del bot

---

## 17. Variables de Entorno

| Variable | Descripción | Requerida |
|---|---|---|
| `DATABASE_URL` | URL de conexión a MySQL | Sí |
| `AUTH_MODE` | `local` para VPS, `manus` para Manus | Sí |
| `LOCAL_USERNAME` | Usuario para login local | Solo VPS |
| `LOCAL_PASSWORD` | Contraseña para login local | Solo VPS |
| `BYBIT_API_KEY` | API Key de Bybit | Sí |
| `BYBIT_API_SECRET` | API Secret de Bybit | Sí |
| `KUCOIN_API_KEY` | API Key de KuCoin | Opcional |
| `KUCOIN_API_SECRET` | API Secret de KuCoin | Opcional |
| `KUCOIN_PASSPHRASE` | Passphrase de KuCoin | Opcional |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram | Opcional |
| `TELEGRAM_CHAT_ID` | Chat ID para notificaciones | Opcional |
| `JWT_SECRET` | Secret para tokens JWT | Sí |

---

## 18. Resumen de Módulos de IA (39+)

### Smart Analysis Engine (v6.0) — 11 módulos

| # | Módulo | Tipo |
|---|---|---|
| 1 | RSI (14) | Indicador técnico |
| 2 | MACD | Indicador técnico |
| 3 | Bollinger Bands | Indicador técnico |
| 4 | ATR (14) | Volatilidad |
| 5 | ADX (14) | Fuerza de tendencia |
| 6 | Stochastic RSI | Oscilador |
| 7 | OBV | Volumen |
| 8 | VWAP | Precio ponderado |
| 9 | Williams %R | Oscilador |
| 10 | RSI Divergence | Divergencia |
| 11 | MACD Divergence | Divergencia |

### Market Intelligence Engine (v7.0) — 19 módulos

| # | Módulo | Tipo |
|---|---|---|
| 12 | Multi-Timeframe Analysis | Análisis |
| 13 | BTC-Alt Correlation | Correlación |
| 14 | Order Book Imbalance | Microestructura |
| 15 | Funding Rate | Sentimiento |
| 16 | Liquidation Detection | Riesgo |
| 17 | Mean Reversion | Estrategia |
| 18 | Breakout Detection | Estrategia |
| 19 | Arbitrage Scanner | Oportunidad |
| 20 | Kelly Criterion | Sizing |
| 21 | Compound Interest | Capital |
| 22 | Market Sessions | Timing |
| 23 | Drawdown Protection | Riesgo |
| 24 | Diversification | Portfolio |
| 25 | Anti-Manipulation | Seguridad |
| 26 | Volume Spikes | Volumen |
| 27 | Intraday Momentum | Momentum |
| 28 | Capital Distribution | Portfolio |
| 29 | Adaptive Grid | Estrategia |
| 30 | Master Signal | Agregador |

### AI Engine (v8.0) — 5 módulos

| # | Módulo | Tipo |
|---|---|---|
| 31 | Sentiment Analysis (LLM) | Machine Learning |
| 32 | Fear & Greed Index | Sentimiento |
| 33 | Pattern Recognition | Machine Learning |
| 34 | Anomaly Detection | Machine Learning |
| 35 | Reinforcement Learning | Machine Learning |

### Advanced Data (v8.0) — 5 módulos

| # | Módulo | Tipo |
|---|---|---|
| 36 | On-Chain Analytics | Blockchain |
| 37 | Open Interest Analysis | Derivados |
| 38 | Liquidation Heatmap | Derivados |
| 39 | Whale Alert | Blockchain |
| 40 | Cross-Exchange Intelligence | Multi-exchange |

### Advanced Strategies (v8.0) — 5 módulos

| # | Módulo | Tipo |
|---|---|---|
| 41 | DCA Inteligente | Estrategia |
| 42 | Pairs Trading | Estrategia |
| 43 | Momentum Cascade | Estrategia |
| 44 | Smart Exit con IA | Machine Learning |
| 45 | News Trading Automático | Machine Learning |

### Auto-Optimizer (v8.0) — 4 módulos

| # | Módulo | Tipo |
|---|---|---|
| 46 | Auto-Tuning de Parámetros | Optimización |
| 47 | Market Microstructure | Microestructura |
| 48 | Portfolio Optimization (Markowitz) | Portfolio |
| 49 | Adaptive Learning Rate | Machine Learning |

---

**Total: 49 módulos de inteligencia artificial operando 24/7**

El bot PHANTOM v8.0 representa la culminación de múltiples iteraciones de desarrollo, cada una agregando capas de inteligencia sobre las anteriores. Desde los 11 indicadores técnicos básicos del v6.0 hasta los 49 módulos de IA del v8.0, el sistema ha evolucionado para cubrir prácticamente todos los aspectos del análisis de mercado: técnico, fundamental, on-chain, sentimiento, microestructura, y machine learning.

La filosofía central permanece inmutable: **NUNCA vender en pérdida, siempre buscar al menos 0.5% de ganancia neta, y mantener todo el capital en USDT cuando no hay oportunidades claras.**

---

*PHANTOM Trading Bot v8.0 — Superintelligence AI Engine*  
*Documentación generada el 23 de Abril de 2026*
