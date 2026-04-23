import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Brain, TrendingUp, TrendingDown, Activity, Gauge, Target,
  BarChart3, Shield, Zap, RefreshCw, AlertTriangle, CheckCircle,
  ArrowUpRight, ArrowDownRight, Minus
} from "lucide-react";
import { useState } from "react";

function FearGreedGauge({ score, label, trend }: { score: number; label: string; trend?: string }) {
  const getColor = (s: number) => {
    if (s <= 25) return "#ef4444"; // red — extreme fear
    if (s <= 45) return "#f97316"; // orange — fear
    if (s <= 55) return "#eab308"; // yellow — neutral
    if (s <= 75) return "#84cc16"; // lime — greed
    return "#22c55e"; // green — extreme greed
  };
  const color = getColor(score);
  const rotation = (score / 100) * 180 - 90; // -90 to 90 degrees

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-48 h-28 overflow-hidden">
        {/* Background arc */}
        <svg viewBox="0 0 200 110" className="w-full h-full">
          <defs>
            <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="25%" stopColor="#f97316" />
              <stop offset="50%" stopColor="#eab308" />
              <stop offset="75%" stopColor="#84cc16" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="hsl(var(--muted))" strokeWidth="12" strokeLinecap="round" />
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeGrad)" strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 251.2} 251.2`} />
          {/* Needle */}
          <line x1="100" y1="100" x2={100 + 60 * Math.cos((rotation * Math.PI) / 180)} y2={100 - 60 * Math.sin((rotation * Math.PI) / 180)}
            stroke={color} strokeWidth="3" strokeLinecap="round" />
          <circle cx="100" cy="100" r="5" fill={color} />
        </svg>
      </div>
      <div className="text-center">
        <div className="text-4xl font-bold" style={{ color }}>{score}</div>
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        {trend && (
          <div className="flex items-center justify-center gap-1 mt-1">
            {trend === "rising" ? <ArrowUpRight className="h-3 w-3 text-green-500" /> :
             trend === "falling" ? <ArrowDownRight className="h-3 w-3 text-red-500" /> :
             <Minus className="h-3 w-3 text-muted-foreground" />}
            <span className="text-xs text-muted-foreground capitalize">{trend}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, subtext, color }: {
  icon: any; label: string; value: string | number; subtext?: string; color?: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
      <div className={`p-2 rounded-lg ${color || "bg-primary/10"}`}>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold truncate">{value}</div>
        {subtext && <div className="text-xs text-muted-foreground">{subtext}</div>}
      </div>
    </div>
  );
}

export default function Intelligence() {
  const { data, isLoading, refetch } = trpc.intelligence.dashboard.useQuery(undefined, {
    refetchInterval: 30000, // Refresh every 30s
  });
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setTimeout(() => setRefreshing(false), 500);
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Brain className="h-6 w-6 text-primary" /> AI Intelligence</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const fg = data?.fearGreed;
  const learning = data?.learning;
  const optimizer = data?.optimizer;
  const perf = data?.performance;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" /> AI Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Motor de superinteligencia con 20 módulos de IA
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Fear & Greed + Signal */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" /> Fear & Greed Index
            </CardTitle>
          </CardHeader>
          <CardContent>
            {fg?.data ? (
              <FearGreedGauge score={fg.data.score} label={fg.data.label} trend={fg.data.trend} />
            ) : (
              <div className="text-center text-muted-foreground py-8">Sin datos disponibles</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> Señal de Mercado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {fg?.signal ? (
              <>
                <div className="flex items-center gap-3">
                  <Badge variant={fg.signal.direction === "buy" ? "default" : fg.signal.direction === "sell" ? "destructive" : "secondary"}
                    className="text-sm px-3 py-1">
                    {fg.signal.direction === "buy" ? <TrendingUp className="h-3 w-3 mr-1" /> :
                     fg.signal.direction === "sell" ? <TrendingDown className="h-3 w-3 mr-1" /> :
                     <Minus className="h-3 w-3 mr-1" />}
                    {fg.signal.direction.toUpperCase()}
                  </Badge>
                  <span className="text-sm font-medium">Fuerza: {fg.signal.strength}%</span>
                </div>
                <p className="text-sm text-muted-foreground">{fg.signal.reason}</p>
              </>
            ) : (
              <div className="text-center text-muted-foreground py-4">Calculando señal...</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Learning Insights */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Aprendizaje de IA (Reinforcement Learning)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {learning && learning.totalTrades > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={BarChart3} label="Trades Analizados" value={learning.totalTrades} />
              <StatCard icon={CheckCircle} label="Win Rate Global" value={`${(learning.overallWinRate * 100).toFixed(1)}%`} />
              <StatCard icon={TrendingUp} label="Mejor Estrategia" value={learning.bestStrategy} />
              <StatCard icon={Target} label="Mejor Moneda" value={learning.bestSymbol} />
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-6">
              <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>El bot está aprendiendo... Se necesitan al menos 10 trades para generar insights.</p>
            </div>
          )}
          {learning && learning.bestConditions.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-2">Mejores condiciones detectadas:</p>
              <div className="flex flex-wrap gap-1">
                {learning.bestConditions.map((c, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auto-Optimizer State */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Auto-Optimizer (Parámetros Actuales)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {optimizer ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <StatCard icon={BarChart3} label="Grid Spread" value={`${optimizer.gridSpreadMultiplier.toFixed(2)}x`}
                subtext={`Max ${optimizer.maxPositionsGrid} pos`} />
              <StatCard icon={Zap} label="Scalp Confianza" value={`${optimizer.scalpConfidenceMin}%`}
                subtext={`Max ${optimizer.maxPositionsScalp} pos`} />
              <StatCard icon={TrendingUp} label="Futures Confianza" value={`${optimizer.futuresConfidenceMin}%`}
                subtext={`Max ${optimizer.maxPositionsFutures} pos`} />
              <StatCard icon={Shield} label="Sizing Global" value={`${optimizer.globalSizingMultiplier.toFixed(2)}x`}
                subtext={`Ciclo: ${optimizer.cycleIntervalMs / 1000}s`} />
              <StatCard icon={Target} label="Grid Confianza" value={`${optimizer.gridConfidenceMin}%`} />
              <StatCard icon={Gauge} label="Futures Leverage" value={`${optimizer.futuresLeverageMax}x`} />
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-6">Cargando parámetros...</div>
          )}
        </CardContent>
      </Card>

      {/* Performance Report */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" /> Performance Report
          </CardTitle>
        </CardHeader>
        <CardContent>
          {perf ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon={BarChart3} label="Total Trades" value={perf.totalTrades} />
                <StatCard icon={CheckCircle} label="Win Rate" value={`${(perf.winRate * 100).toFixed(1)}%`} />
                <StatCard icon={TrendingUp} label="PnL Total" value={`$${perf.totalPnl.toFixed(2)}`}
                  color={perf.totalPnl >= 0 ? "bg-green-500/10" : "bg-red-500/10"} />
                <StatCard icon={Activity} label="Sharpe Ratio" value={perf.sharpeRatio.toFixed(2)} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCard icon={TrendingUp} label="Mejor Trade" value={`$${perf.bestTrade.toFixed(2)}`} color="bg-green-500/10" />
                <StatCard icon={TrendingDown} label="Peor Trade" value={`$${perf.worstTrade.toFixed(2)}`} color="bg-red-500/10" />
                <StatCard icon={AlertTriangle} label="Max Drawdown" value={`${perf.maxDrawdown.toFixed(2)}%`} color="bg-yellow-500/10" />
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-6">Sin datos de performance aún</div>
          )}
        </CardContent>
      </Card>

      {/* Module Status */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Módulos de IA Activos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {[
              "Multi-Timeframe Analysis", "Correlación BTC-Alts", "Volume Spikes",
              "Order Book Imbalance", "Funding Rate", "Liquidation Detection",
              "Mean Reversion", "Breakout Trading", "Arbitraje Scanner",
              "Sentiment Analysis", "Fear & Greed", "Pattern Recognition",
              "Reinforcement Learning", "Anomaly Detection", "DCA Inteligente",
              "Momentum Cascade", "Smart Exit", "Auto-Tuning",
              "Portfolio Optimization", "Adaptive Learning"
            ].map((mod, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/20 border border-border/30">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-medium truncate">{mod}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
