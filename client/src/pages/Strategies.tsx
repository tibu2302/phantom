import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Zap, Grid3X3, LineChart, Settings2, ChevronDown, ChevronUp, TrendingUp } from "lucide-react";
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
        textColor: "rgba(255,255,255,0.5)",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)" },
        horzLines: { color: "rgba(255,255,255,0.05)" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
      timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true },
      width: containerRef.current.clientWidth,
      height: 200,
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
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        {intervals.map(iv => (
          <button
            key={iv.value}
            onClick={() => setInterval2(iv.value)}
            className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
              interval === iv.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
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

  return (
    <div className="border-t border-white/10 pt-4 space-y-4">
      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Asignación de capital</span>
            <span className="font-bold text-primary">{allocation}%</span>
          </div>
          <Slider
            value={[allocation]}
            onValueChange={([v]) => setAllocation(v)}
            min={5} max={80} step={5}
            className="w-full"
          />
        </div>
        {isGrid ? (
          <>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Niveles del grid</span>
                <span className="font-bold text-primary">{gridLevels}</span>
              </div>
              <Slider
                value={[gridLevels]}
                onValueChange={([v]) => setGridLevels(v)}
                min={4} max={30} step={2}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Spread del grid</span>
                <span className="font-bold text-primary">{gridSpread}%</span>
              </div>
              <Slider
                value={[gridSpread]}
                onValueChange={([v]) => setGridSpread(v)}
                min={0.1} max={5} step={0.1}
                className="w-full"
              />
            </div>
          </>
        ) : isFutures ? (
          <>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Apalancamiento</span>
                <span className="font-bold text-primary">{leverage}x</span>
              </div>
              <Slider
                value={[leverage]}
                onValueChange={([v]) => setLeverage(v)}
                min={1} max={5} step={1}
                className="w-full"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Bajo apalancamiento = menor riesgo de liquidaci\u00f3n</p>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Take Profit</span>
                <span className="font-bold text-primary">{takeProfit}%</span>
              </div>
              <Slider
                value={[takeProfit]}
                onValueChange={([v]) => setTakeProfit(v)}
                min={0.3} max={5} step={0.1}
                className="w-full"
              />
            </div>
          </>
        ) : (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Umbral de scalping</span>
              <span className="font-bold text-primary">{scalpThreshold}%</span>
            </div>
            <Slider
              value={[scalpThreshold]}
              onValueChange={([v]) => setScalpThreshold(v)}
              min={0.1} max={3} step={0.1}
              className="w-full"
            />
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 h-8 text-xs"
          onClick={() => updateConfig.mutate({
            id: strategy.id,
            config: {
              gridLevels: isGrid ? gridLevels : undefined,
              gridSpreadPct: isGrid ? gridSpread : undefined,
              scalpingThresholdPct: (!isGrid && !isFutures) ? scalpThreshold : undefined,
              leverage: isFutures ? leverage : undefined,
              takeProfitPct: isFutures ? takeProfit : undefined,
              allocationPct: allocation,
            },
          })}
          disabled={updateConfig.isPending}
        >
          {updateConfig.isPending ? "Guardando..." : "Guardar"}
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page ───
export default function Strategies() {
  const { data: strategies, isLoading } = trpc.strategies.list.useQuery();
  const utils = trpc.useUtils();
  const toggleMut = trpc.strategies.toggle.useMutation({
    onSuccess: () => { utils.strategies.list.invalidate(); toast.success("Estrategia actualizada"); },
  });

  const [expandedChart, setExpandedChart] = useState<number | null>(null);
  const [expandedConfig, setExpandedConfig] = useState<number | null>(null);

  if (isLoading) return (
    <div className="space-y-3 animate-pulse">
      <div className="h-8 glass-card rounded-xl w-40" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-48 glass-card rounded-xl" />)}
      </div>
    </div>
  );

  const marketLabel = (m: string | null) => m === "tradfi" ? "TradFi" : "Crypto";
  const stratIcon = (s: string | null) => s === "grid" ? Grid3X3 : s === "futures" ? TrendingUp : LineChart;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" /> Estrategias
        </h1>
        <p className="text-xs text-muted-foreground mt-1">Gestioná tus estrategias de trading activas</p>
      </div>

      {!strategies || strategies.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Zap className="h-10 w-10 text-primary/30 mx-auto mb-3" />
          <p className="text-muted-foreground">Sin estrategias configuradas. Guardá tus Claves API primero para crear las estrategias por defecto.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {strategies.map((s: any) => {
            const Icon = stratIcon(s.strategyType);
            const pnl = parseFloat(String(s.pnl ?? "0"));
            const trades = s.totalTrades ?? 0;
            const wins = s.winningTrades ?? 0;
            const wr = trades > 0 ? (wins / trades * 100).toFixed(1) : "0.0";
            const isChartOpen = expandedChart === s.id;
            const isConfigOpen = expandedConfig === s.id;

            return (
              <div key={s.id} className="glass-card p-5 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-bold">{s.symbol}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px]">{(s.strategyType ?? "grid").toUpperCase()}</Badge>
                        <Badge variant="outline" className="text-[10px]">{marketLabel(s.market)}</Badge>
                      </div>
                    </div>
                  </div>
                  <Switch checked={s.enabled} onCheckedChange={(checked) => toggleMut.mutate({ id: s.id, enabled: checked })} />
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-semibold tracking-wider">PNL</p>
                    <p className={`text-sm font-bold tabular-nums ${pnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-semibold tracking-wider">OPERACIONES</p>
                    <p className="text-sm font-bold tabular-nums">{trades}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-semibold tracking-wider">% GANANCIA</p>
                    <p className="text-sm font-bold tabular-nums">{wr}%</p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setExpandedChart(isChartOpen ? null : s.id); setExpandedConfig(null); }}
                    className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
                  >
                    <LineChart className="h-3.5 w-3.5" />
                    Gráfico
                    {isChartOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => { setExpandedConfig(isConfigOpen ? null : s.id); setExpandedChart(null); }}
                    className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    Config
                    {isConfigOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                </div>

                {/* Candlestick chart */}
                {isChartOpen && (
                  <div className="border-t border-white/10 pt-4">
                    <CandleChart symbol={s.symbol} category={s.category ?? "spot"} />
                  </div>
                )}

                {/* Config panel */}
                {isConfigOpen && (
                  <StrategyConfig strategy={s} onClose={() => setExpandedConfig(null)} />
                )}

                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Asignación: {s.allocationPct ?? 0}%</span>
                  <span>{s.enabled ? "Activa" : "Pausada"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
