import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useIsMobile } from "@/hooks/useMobile";
import {
  Zap, Grid3X3, LineChart, Settings2, ChevronDown, ChevronUp,
  TrendingUp, Shield, Target, Clock, Layers, DollarSign, Activity
} from "lucide-react";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CandlestickSeries } from "lightweight-charts";

// ─── Candlestick Chart Component ───
function CandleChart({ symbol, category }: { symbol: string; category: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const [interval, setInterval2] = useState("15");

  const { data: klines, isLoading } = trpc.strategies.klines.useQuery(
    { symbol, interval, limit: 80 },
    { refetchInterval: 60_000, staleTime: 30_000 }
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,0.4)",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.03)" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.06)", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: "rgba(255,255,255,0.06)", timeVisible: true },
      width: containerRef.current.clientWidth,
      height: 220,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "oklch(0.72 0.19 160)",
      downColor: "oklch(0.63 0.24 25)",
      borderVisible: false,
      wickUpColor: "oklch(0.72 0.19 160)",
      wickDownColor: "oklch(0.63 0.24 25)",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !klines || klines.length === 0) return;
    seriesRef.current.setData(klines);
    chartRef.current?.timeScale().fitContent();
  }, [klines]);

  const intervals = [
    { label: "5m", value: "5" },
    { label: "15m", value: "15" },
    { label: "1h", value: "60" },
    { label: "4h", value: "240" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        {intervals.map(iv => (
          <button
            key={iv.value}
            onClick={() => setInterval2(iv.value)}
            className={`text-[10px] px-2.5 py-1 rounded-md font-semibold transition-all ${
              interval === iv.value
                ? "bg-primary/15 text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            }`}
          >
            {iv.label}
          </button>
        ))}
        {isLoading && <span className="text-[10px] text-muted-foreground ml-2 animate-pulse">Cargando...</span>}
      </div>
      <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />
    </div>
  );
}

// ─── Strategy Config Panel ───
function StrategyConfig({ strategy, onClose }: { strategy: any; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [gridLevels, setGridLevels] = useState(strategy.config?.gridLevels ?? 10);
  const [gridSpread, setGridSpread] = useState(strategy.config?.gridSpreadPct ?? 0.3);
  const [scalpThreshold, setScalpThreshold] = useState(strategy.config?.scalpingThresholdPct ?? 0.5);
  const [allocation, setAllocation] = useState(strategy.allocationPct ?? 30);
  const [leverage, setLeverage] = useState(strategy.config?.leverage ?? 2);
  const [takeProfit, setTakeProfit] = useState(strategy.config?.takeProfitPct ?? 1.0);
  const [stopLoss, setStopLoss] = useState(strategy.config?.stopLossPct ?? (strategy.strategyType === 'futures' ? 3.0 : 5.0));
  const [trailingStop, setTrailingStop] = useState(strategy.config?.trailingStopPct ?? 0.8);
  const [trailingActivation, setTrailingActivation] = useState(strategy.config?.trailingActivationPct ?? 1.0);
  const [maxPositions, setMaxPositions] = useState(strategy.config?.maxOpenPositions ?? 5);
  const [maxHoldHours, setMaxHoldHours] = useState(strategy.config?.maxHoldHours ?? (strategy.strategyType === 'futures' ? 24 : 48));
  const [minProfitUsd, setMinProfitUsd] = useState(strategy.config?.minProfitUsd ?? 5);

  const updateConfig = trpc.strategies.updateConfig.useMutation({
    onSuccess: () => {
      utils.strategies.list.invalidate();
      toast.success("Configuración guardada");
      onClose();
    },
    onError: () => toast.error("Error al guardar"),
  });

  const isGrid = strategy.strategyType === "grid";
  const isFutures = strategy.strategyType === "futures";

  const ConfigSlider = ({ label, value, icon: Icon, color = "text-primary", ...sliderProps }: any) => (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-muted-foreground flex items-center gap-1.5">
          {Icon && <Icon className="h-3 w-3" />}
          {label}
        </span>
        <span className={`font-bold tabular-nums ${color}`}>{sliderProps.displayValue ?? value}</span>
      </div>
      <Slider {...sliderProps} value={[value]} className="w-full" />
    </div>
  );

  return (
    <div className="border-t border-white/8 pt-5 space-y-5 animate-in slide-in-from-top-2 duration-200">
      {/* Strategy-specific settings */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Settings2 className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] font-bold tracking-[0.15em] text-muted-foreground uppercase">Parámetros</span>
        </div>

        <ConfigSlider
          label="Asignación de capital" icon={DollarSign}
          value={allocation} onValueChange={([v]: number[]) => setAllocation(v)}
          min={5} max={80} step={5} displayValue={`${allocation}%`}
        />

        {isGrid ? (
          <>
            <ConfigSlider
              label="Niveles del grid" icon={Layers}
              value={gridLevels} onValueChange={([v]: number[]) => setGridLevels(v)}
              min={4} max={30} step={2}
            />
            <ConfigSlider
              label="Spread del grid" icon={Activity}
              value={gridSpread} onValueChange={([v]: number[]) => setGridSpread(v)}
              min={0.1} max={5} step={0.1} displayValue={`${gridSpread}%`}
            />
          </>
        ) : isFutures ? (
          <>
            <ConfigSlider
              label="Apalancamiento" icon={TrendingUp}
              value={leverage} onValueChange={([v]: number[]) => setLeverage(v)}
              min={1} max={5} step={1} displayValue={`${leverage}x`}
            />
            <ConfigSlider
              label="Take Profit" icon={Target}
              value={takeProfit} onValueChange={([v]: number[]) => setTakeProfit(v)}
              min={0.3} max={5} step={0.1} displayValue={`${takeProfit}%`}
            />
          </>
        ) : (
          <ConfigSlider
            label="Umbral de scalping" icon={Activity}
            value={scalpThreshold} onValueChange={([v]: number[]) => setScalpThreshold(v)}
            min={0.1} max={3} step={0.1} displayValue={`${scalpThreshold}%`}
          />
        )}
      </div>

      {/* Protection settings */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 pt-2 border-t border-white/8">
          <Shield className="h-3.5 w-3.5 text-[oklch(0.8_0.15_85)]" />
          <span className="text-[10px] font-bold tracking-[0.15em] text-muted-foreground uppercase">Protección</span>
        </div>

        <ConfigSlider
          label="Stop-Loss" icon={Shield}
          value={stopLoss} onValueChange={([v]: number[]) => setStopLoss(v)}
          min={1} max={15} step={0.5}
          displayValue={`${stopLoss}%`} color="text-[oklch(0.63_0.24_25)]"
        />

        {(isGrid || isFutures) && (
          <>
            <ConfigSlider
              label="Trailing Stop" icon={Target}
              value={trailingStop} onValueChange={([v]: number[]) => setTrailingStop(v)}
              min={0.1} max={3} step={0.1} displayValue={`${trailingStop}%`}
            />
            <ConfigSlider
              label="Activación trailing" icon={TrendingUp}
              value={trailingActivation} onValueChange={([v]: number[]) => setTrailingActivation(v)}
              min={0.1} max={5} step={0.1} displayValue={`${trailingActivation}%`}
            />
          </>
        )}

        <ConfigSlider
          label="Tiempo máximo" icon={Clock}
          value={maxHoldHours} onValueChange={([v]: number[]) => setMaxHoldHours(v)}
          min={1} max={96} step={1} displayValue={`${maxHoldHours}h`}
        />

        {isGrid && (
          <>
            <ConfigSlider
              label="Máx. posiciones abiertas" icon={Layers}
              value={maxPositions} onValueChange={([v]: number[]) => setMaxPositions(v)}
              min={1} max={20} step={1}
            />
            <ConfigSlider
              label="Ganancia mínima por venta" icon={DollarSign}
              value={minProfitUsd} onValueChange={([v]: number[]) => setMinProfitUsd(v)}
              min={0} max={50} step={1} displayValue={`$${minProfitUsd}`}
            />
          </>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="flex-1 h-9 text-xs font-semibold"
          onClick={() => updateConfig.mutate({
            id: strategy.id,
            config: {
              gridLevels: isGrid ? gridLevels : undefined,
              gridSpreadPct: isGrid ? gridSpread : undefined,
              scalpingThresholdPct: (!isGrid && !isFutures) ? scalpThreshold : undefined,
              leverage: isFutures ? leverage : undefined,
              takeProfitPct: isFutures ? takeProfit : undefined,
              allocationPct: allocation,
              stopLossPct: stopLoss,
              trailingStopPct: (isGrid || isFutures) ? trailingStop : undefined,
              trailingActivationPct: (isGrid || isFutures) ? trailingActivation : undefined,
              maxHoldHours: maxHoldHours,
              maxOpenPositions: isGrid ? maxPositions : undefined,
              minProfitUsd: isGrid ? minProfitUsd : undefined,
            },
          })}
          disabled={updateConfig.isPending}
        >
          {updateConfig.isPending ? "Guardando..." : "Guardar cambios"}
        </Button>
        <Button size="sm" variant="outline" className="h-9 text-xs bg-transparent" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ─── Strategy Card ───
function StrategyCard({ s, expandedChart, expandedConfig, setExpandedChart, setExpandedConfig, toggleMut }: any) {
  const stratIcon = (type: string | null) => type === "grid" ? Grid3X3 : type === "futures" ? TrendingUp : LineChart;
  const marketLabel = (m: string | null) => m === "tradfi" ? "TradFi" : "Crypto";
  const Icon = stratIcon(s.strategyType);
  const pnl = parseFloat(String(s.pnl ?? "0"));
  const trades = s.totalTrades ?? 0;
  const wins = s.winningTrades ?? 0;
  const wr = trades > 0 ? (wins / trades * 100).toFixed(1) : "0.0";
  const isChartOpen = expandedChart === s.id;
  const isConfigOpen = expandedConfig === s.id;
  const isPositive = pnl >= 0;

  return (
    <div className={`glass-card overflow-hidden transition-all duration-300 ${s.enabled ? "" : "opacity-60"}`}>
      {/* Top accent line */}
      <div
        className="h-0.5 w-full"
        style={{
          background: s.enabled
            ? `linear-gradient(90deg, oklch(0.72 0.19 160 / 0.6), oklch(0.72 0.19 160 / 0.1))`
            : `linear-gradient(90deg, oklch(0.4 0 0 / 0.3), transparent)`,
        }}
      />

      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="h-11 w-11 rounded-xl flex items-center justify-center"
              style={{
                background: s.strategyType === "grid"
                  ? "linear-gradient(135deg, oklch(0.72 0.19 160 / 0.15), oklch(0.72 0.19 160 / 0.05))"
                  : s.strategyType === "futures"
                  ? "linear-gradient(135deg, oklch(0.8 0.15 85 / 0.15), oklch(0.8 0.15 85 / 0.05))"
                  : "linear-gradient(135deg, oklch(0.75 0.14 200 / 0.15), oklch(0.75 0.14 200 / 0.05))",
                border: "1px solid oklch(1 0 0 / 0.06)",
              }}
            >
              <Icon
                className="h-5 w-5"
                style={{
                  color: s.strategyType === "grid"
                    ? "oklch(0.72 0.19 160)"
                    : s.strategyType === "futures"
                    ? "oklch(0.8 0.15 85)"
                    : "oklch(0.75 0.14 200)",
                }}
              />
            </div>
            <div>
              <p className="font-bold text-base">{s.symbol}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge
                  variant="outline"
                  className="text-[9px] px-1.5 py-0 h-4 font-bold border-white/10"
                >
                  {(s.strategyType ?? "grid").toUpperCase()}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-[9px] px-1.5 py-0 h-4 border-white/10"
                >
                  {marketLabel(s.market)}
                </Badge>
              </div>
            </div>
          </div>
          <Switch checked={s.enabled} onCheckedChange={(checked) => toggleMut.mutate({ id: s.id, enabled: checked })} />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="glass-card p-3 text-center">
            <p className="text-[9px] text-muted-foreground font-semibold tracking-wider uppercase mb-1">PnL</p>
            <p className={`text-sm font-bold tabular-nums ${isPositive ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
              {isPositive ? "+" : ""}{pnl.toFixed(2)}
            </p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-[9px] text-muted-foreground font-semibold tracking-wider uppercase mb-1">Trades</p>
            <p className="text-sm font-bold tabular-nums">{trades}</p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-[9px] text-muted-foreground font-semibold tracking-wider uppercase mb-1">Win Rate</p>
            <p className="text-sm font-bold tabular-nums">{wr}%</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => { setExpandedChart(isChartOpen ? null : s.id); setExpandedConfig(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold py-2 rounded-lg transition-all ${
              isChartOpen
                ? "bg-primary/15 text-primary border border-primary/20"
                : "bg-white/5 hover:bg-white/8 text-muted-foreground hover:text-foreground border border-transparent"
            }`}
          >
            <LineChart className="h-3.5 w-3.5" />
            Gráfico
            {isChartOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          <button
            onClick={() => { setExpandedConfig(isConfigOpen ? null : s.id); setExpandedChart(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold py-2 rounded-lg transition-all ${
              isConfigOpen
                ? "bg-primary/15 text-primary border border-primary/20"
                : "bg-white/5 hover:bg-white/8 text-muted-foreground hover:text-foreground border border-transparent"
            }`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Config
            {isConfigOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>

        {/* Candlestick chart */}
        {isChartOpen && (
          <div className="border-t border-white/8 pt-4 animate-in slide-in-from-top-2 duration-200">
            <CandleChart symbol={s.symbol} category={s.category ?? "spot"} />
          </div>
        )}

        {/* Config panel */}
        {isConfigOpen && (
          <StrategyConfig strategy={s} onClose={() => setExpandedConfig(null)} />
        )}

        {/* Footer info */}
        <div className="flex justify-between items-center text-[11px] text-muted-foreground/70 pt-1">
          <span className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            Asignación: {s.allocationPct ?? 0}%
          </span>
          <span className={`flex items-center gap-1 ${s.enabled ? "text-[oklch(0.72_0.19_160)]" : ""}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-[oklch(0.72_0.19_160)] pulse-live" : "bg-muted-foreground/40"}`} />
            {s.enabled ? "Activa" : "Pausada"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───
export default function Strategies() {
  const { data: strategies, isLoading } = trpc.strategies.list.useQuery();
  const utils = trpc.useUtils();
  const isMobile = useIsMobile();
  const toggleMut = trpc.strategies.toggle.useMutation({
    onSuccess: () => { utils.strategies.list.invalidate(); toast.success("Estrategia actualizada"); },
  });

  const [expandedChart, setExpandedChart] = useState<number | null>(null);
  const [expandedConfig, setExpandedConfig] = useState<number | null>(null);

  if (isLoading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-10 glass-card rounded-xl w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-card rounded-xl overflow-hidden">
            <div className="h-0.5 w-full bg-primary/20" />
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-white/5" />
                <div className="space-y-2">
                  <div className="h-4 w-20 bg-white/5 rounded" />
                  <div className="h-3 w-16 bg-white/5 rounded" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[1,2,3].map(j => <div key={j} className="h-14 bg-white/3 rounded-lg" />)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Summary stats
  const totalStrategies = strategies?.length ?? 0;
  const activeStrategies = strategies?.filter((s: any) => s.enabled).length ?? 0;
  const totalPnl = strategies?.reduce((sum: number, s: any) => sum + parseFloat(String(s.pnl ?? "0")), 0) ?? 0;
  const totalTrades = strategies?.reduce((sum: number, s: any) => sum + (s.totalTrades ?? 0), 0) ?? 0;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, oklch(0.72 0.19 160 / 0.15), oklch(0.72 0.19 160 / 0.05))" }}>
              <Zap className="h-4 w-4 text-primary" />
            </div>
            Estrategias
          </h1>
          <p className="text-xs text-muted-foreground mt-1 ml-10">Gestioná tus estrategias de trading activas</p>
        </div>
      </div>

      {/* Summary bar */}
      {totalStrategies > 0 && (
        <div className={`grid ${isMobile ? "grid-cols-2" : "grid-cols-4"} gap-3`}>
          <div className="glass-card p-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase">Activas</p>
              <p className="text-sm font-bold tabular-nums">{activeStrategies}/{totalStrategies}</p>
            </div>
          </div>
          <div className="glass-card p-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: totalPnl >= 0 ? "oklch(0.72 0.19 160 / 0.1)" : "oklch(0.63 0.24 25 / 0.1)" }}>
              <DollarSign className="h-4 w-4" style={{ color: totalPnl >= 0 ? "oklch(0.72 0.19 160)" : "oklch(0.63 0.24 25)" }} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase">PnL Total</p>
              <p className={`text-sm font-bold tabular-nums ${totalPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
                {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}
              </p>
            </div>
          </div>
          {!isMobile && (
            <>
              <div className="glass-card p-3 flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-[oklch(0.75_0.14_200/0.1)] flex items-center justify-center shrink-0">
                  <Activity className="h-4 w-4 text-[oklch(0.75_0.14_200)]" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase">Trades</p>
                  <p className="text-sm font-bold tabular-nums">{totalTrades}</p>
                </div>
              </div>
              <div className="glass-card p-3 flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-[oklch(0.8_0.15_85/0.1)] flex items-center justify-center shrink-0">
                  <Shield className="h-4 w-4 text-[oklch(0.8_0.15_85)]" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase">Protección</p>
                  <p className="text-sm font-bold text-[oklch(0.72_0.19_160)]">Activa</p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Strategy cards */}
      {!strategies || strategies.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Zap className="h-8 w-8 text-primary/40" />
          </div>
          <p className="text-muted-foreground">Sin estrategias configuradas.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Guardá tus Claves API primero para crear las estrategias por defecto.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {strategies.map((s: any) => (
            <StrategyCard
              key={s.id}
              s={s}
              expandedChart={expandedChart}
              expandedConfig={expandedConfig}
              setExpandedChart={setExpandedChart}
              setExpandedConfig={setExpandedConfig}
              toggleMut={toggleMut}
            />
          ))}
        </div>
      )}
    </div>
  );
}
