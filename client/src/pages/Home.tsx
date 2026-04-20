import { trpc } from "@/lib/trpc";
import { Bell, Play, Square, AlertTriangle, TrendingUp, TrendingDown, Wallet, Target, Trophy, Activity, BarChart3, Shield, Wifi, WifiOff, Clock, Zap, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { useState, useMemo, useEffect } from "react";

const fmt = (n: number) => {
  const abs = Math.abs(n);
  return (n < 0 ? "-" : "+") + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtUsd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
const fmtPrice = (n: number) => {
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
};

export default function Home() {
  const { data, isLoading } = trpc.bot.status.useQuery(undefined, { refetchInterval: 5000, retry: false });
  const publicPrices = trpc.prices.live.useQuery(undefined, { refetchInterval: 8000 });
  const strategiesQuery = trpc.strategies.list.useQuery(undefined, { retry: false });
  const tradesQuery = trpc.trades.list.useQuery({ limit: 50 }, { retry: false });
  const utils = trpc.useUtils();
  const startBot = trpc.bot.start.useMutation({
    onSuccess: (res: any) => {
      utils.bot.status.invalidate();
      if (res.success) toast.success("Motor PHANTOM iniciado");
      else toast.error(res.error || "Error al iniciar");
    },
    onError: () => toast.error("Error al iniciar el motor"),
  });
  const stopBot = trpc.bot.stop.useMutation({ onSuccess: () => { utils.bot.status.invalidate(); toast.success("Motor detenido"); } });
  const emergencyStop = trpc.bot.emergencyStop.useMutation({ onSuccess: () => { utils.bot.status.invalidate(); toast.error("PARADA DE EMERGENCIA ejecutada"); } });
  const markRead = trpc.bot.markNotificationsRead.useMutation({ onSuccess: () => utils.bot.status.invalidate() });
  const [bellOpen, setBellOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const state = data?.state;
  const totalPnl = parseFloat(String(state?.totalPnl ?? "0"));
  const todayPnl = parseFloat(String(state?.todayPnl ?? "0"));
  const balance = parseFloat(String(state?.currentBalance ?? "5000"));
  const initial = parseFloat(String(state?.initialBalance ?? "5000"));
  const totalTrades = state?.totalTrades ?? 0;
  const winningTrades = state?.winningTrades ?? 0;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const pnlPct = initial > 0 ? (totalPnl / initial) * 100 : 0;
  const isRunning = data?.engineRunning ?? false;
  const maxDrawdown = parseFloat(String(state?.maxDrawdown ?? "0"));
  const dailyLoss = parseFloat(String(state?.dailyLoss ?? "0"));
  const unread = data?.unreadNotifications ?? 0;
  const notifications = data?.recentOpportunities ?? [];
  // Use bot status prices first, fallback to public prices
  const livePrices = (data?.livePrices && Object.keys(data.livePrices).length > 0)
    ? data.livePrices
    : (publicPrices.data ?? {});

  const uptime = useMemo(() => {
    if (!state?.startedAt || !isRunning) return "0m";
    const diff = Date.now() - new Date(state.startedAt).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }, [state?.startedAt, isRunning]);

  const pnlColor = totalPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]";
  const pnlGlow = totalPnl >= 0 ? "glow-green" : "glow-red";

  // Build PnL by pair from strategies
  const strategies = strategiesQuery.data ?? [];
  const barData = strategies.length > 0
    ? strategies.map((s: any) => ({
        pair: s.symbol.replace("USDT", ""),
        pnl: parseFloat(String(s.pnl ?? "0")),
      }))
    : [
        { pair: "BTC", pnl: 0 },
        { pair: "ETH", pnl: 0 },
        { pair: "XAU", pnl: 0 },
      ];

  // Price ticker data
  const tickerPairs = [
    { symbol: "BTCUSDT", label: "BTC/USDT", icon: "₿" },
    { symbol: "ETHUSDT", label: "ETH/USDT", icon: "Ξ" },
    { symbol: "XAUUSDT", label: "Oro/USDT", icon: "🥇" },
    { symbol: "SP500", label: "S&P 500", icon: "📈" },
  ];

  if (isLoading && publicPrices.isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-48 glass-card rounded-xl" />
        <div className="grid grid-cols-5 gap-4">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 glass-card rounded-xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Panel</h1>
          <div className="flex items-center gap-3 mt-1">
            <Badge variant={isRunning ? "default" : "secondary"} className={isRunning ? "bg-primary/20 text-primary border-primary/30" : ""}>
              {isRunning ? <><span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live mr-1.5 inline-block" /> EN VIVO</> : <><WifiOff className="h-3 w-3 mr-1" /> DESCONECTADO</>}
            </Badge>
            {state?.simulationMode && <Badge variant="outline" className="border-[oklch(0.8_0.15_85)] text-[oklch(0.8_0.15_85)]">SIMULACIÓN</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={bellOpen} onOpenChange={(open) => { setBellOpen(open); if (open && unread > 0) markRead.mutate(); }}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                {unread > 0 && <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold flex items-center justify-center text-white">{unread}</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="p-3 border-b"><h4 className="font-semibold text-sm">Notificaciones</h4></div>
              <div className="max-h-64 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4 text-center">Sin notificaciones aún. Iniciá el bot para escanear oportunidades.</p>
                ) : notifications.map((n: any) => (
                  <div key={n.id} className="p-3 border-b last:border-0 hover:bg-accent/50">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{n.symbol}</span>
                      <Badge variant={String(n.signal).includes("BUY") ? "default" : "destructive"} className="text-[10px]">{String(n.signal).includes("BUY") ? "COMPRA" : "VENTA"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Confianza: {n.confidence}% — ${fmtPrice(parseFloat(String(n.price ?? "0")))}</p>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {!isRunning ? (
            <Button onClick={() => startBot.mutate()} className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2" disabled={startBot.isPending}>
              <Play className="h-4 w-4" /> {startBot.isPending ? "Iniciando..." : "Iniciar"}
            </Button>
          ) : (
            <Button onClick={() => stopBot.mutate()} variant="secondary" className="gap-2" disabled={stopBot.isPending}>
              <Square className="h-4 w-4" /> Detener
            </Button>
          )}
          <Button onClick={() => emergencyStop.mutate()} variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" disabled={emergencyStop.isPending} title="Parada de Emergencia">
            <AlertTriangle className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Live Price Ticker */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tickerPairs.map(({ symbol, label, icon }) => {
          const p = livePrices[symbol];
          const price = p?.lastPrice ?? 0;
          const change = p?.price24hPcnt ? p.price24hPcnt * 100 : 0;
          const isUp = change >= 0;
          return (
            <div key={symbol} className="glass-card p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">{icon}</span>
                <div>
                  <p className="text-xs font-semibold tracking-wider text-muted-foreground">{label}</p>
                  <p className="text-lg font-bold tabular-nums">{price > 0 ? "$" + fmtPrice(price) : "—"}</p>
                </div>
              </div>
              {price > 0 && (
                <div className={`flex items-center gap-1 text-sm font-semibold ${isUp ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
                  {isUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  {fmtPct(change)}
                </div>
              )}
              {price === 0 && (
                <span className="text-xs text-muted-foreground">Esperando...</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Unified PnL */}
      <div className={`glass-card ${pnlGlow} p-8 text-center`}>
        <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase mb-2">Resultado Unificado</p>
        <p className={`text-5xl md:text-6xl font-bold tracking-tight ${pnlColor} tabular-nums`}>{fmt(totalPnl)}</p>
        <p className={`text-lg mt-1 ${pnlColor}`}>{fmtPct(pnlPct)}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { icon: Wallet, label: "SALDO", value: fmtUsd(balance) },
          { icon: Target, label: "INICIAL", value: fmtUsd(initial) },
          { icon: todayPnl >= 0 ? TrendingUp : TrendingDown, label: "HOY", value: fmt(todayPnl), color: todayPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]" },
          { icon: Trophy, label: "% GANANCIA", value: winRate.toFixed(1) + "%" },
          { icon: Activity, label: "OPERACIONES", value: String(totalTrades) },
        ].map((s) => (
          <div key={s.label} className="glass-card p-4 text-center">
            <s.icon className="h-4 w-4 mx-auto text-muted-foreground mb-2" />
            <p className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground">{s.label}</p>
            <p className={`text-lg font-bold mt-1 tabular-nums ${s.color ?? ""}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Charts + Recent Trades */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-4 w-4 text-[oklch(0.75_0.14_200)]" />
            <h3 className="font-semibold text-sm">PnL por Par</h3>
          </div>
          <ResponsiveContainer width="100%" height={192}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.008 260)" />
              <XAxis dataKey="pair" tick={{ fontSize: 11, fill: "oklch(0.6 0.01 260)" }} />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.6 0.01 260)" }} />
              <Tooltip contentStyle={{ background: "oklch(0.18 0.008 260)", border: "1px solid oklch(0.25 0.008 260)", borderRadius: 8, color: "oklch(0.9 0.01 260)" }} />
              <Bar dataKey="pnl" fill="oklch(0.72 0.19 160)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Últimas Operaciones</h3>
          </div>
          <div className="space-y-2 max-h-[192px] overflow-y-auto">
            {(!tradesQuery.data || tradesQuery.data.length === 0) ? (
              <div className="flex items-center justify-center h-[160px] text-muted-foreground text-sm">
                <Activity className="h-6 w-6 opacity-20 mr-2" /> Sin operaciones aún. Iniciá el bot.
              </div>
            ) : (
              tradesQuery.data.slice(0, 8).map((t: any) => {
                const pnl = parseFloat(String(t.pnl ?? "0"));
                return (
                  <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={t.side === "buy" ? "default" : "destructive"} className="text-[9px] w-10 justify-center">
                        {t.side === "buy" ? "COMPRA" : "VENTA"}
                      </Badge>
                      <span className="text-sm font-medium">{t.symbol?.replace("USDT", "")}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums">${fmtPrice(parseFloat(String(t.price ?? "0")))}</span>
                      <span className={`text-xs font-semibold tabular-nums ${pnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
                        {fmt(pnl)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Risk Management */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[oklch(0.8_0.15_85)]" />
            <h3 className="font-semibold text-sm">Gestión de Riesgo</h3>
          </div>
          <Badge variant="outline" className={`text-xs ${dailyLoss > 200 ? "border-destructive/50 text-destructive" : "border-primary/30 text-primary"}`}>
            {dailyLoss > 200 ? "⚠ RIESGO ALTO" : "SEGURO"}
          </Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Drawdown Máximo</span>
              <span className="tabular-nums">{(maxDrawdown * 100).toFixed(2)}% / 10%</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${Math.min((maxDrawdown * 100) / 10 * 100, 100)}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Límite Pérdida Diaria</span>
              <span className="tabular-nums">{fmtUsd(Math.abs(dailyLoss))} / $250</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-[oklch(0.8_0.15_85)] rounded-full transition-all duration-500" style={{ width: `${Math.min((Math.abs(dailyLoss) / 250) * 100, 100)}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground py-2">
        <span className="flex items-center gap-1.5">{isRunning ? <Wifi className="h-3 w-3 text-primary" /> : <WifiOff className="h-3 w-3" />} {isRunning ? "Conectado a Bybit" : "Desconectado"}</span>
        <span className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> Activo: {uptime}</span>
        <span>Ciclos: {data?.cycles ?? 0}</span>
        <span>{currentTime.toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
