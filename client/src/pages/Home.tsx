import { trpc } from "@/lib/trpc";
import {
  Bell, Play, Square, AlertTriangle, TrendingUp, TrendingDown,
  Wallet, Target, Trophy, Activity, BarChart3, Shield, Wifi, WifiOff,
  Clock, Zap, ArrowUpRight, ArrowDownRight, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/useMobile";

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
  const isMobile = useIsMobile();
  const { data, isLoading, refetch: refetchStatus } = trpc.bot.status.useQuery(undefined, { refetchInterval: 5000, retry: false });
  const publicPrices = trpc.prices.live.useQuery(undefined, { refetchInterval: 8000 });
  const strategiesQuery = trpc.strategies.list.useQuery(undefined, { retry: false });
  const tradesQuery = trpc.trades.list.useQuery({ limit: 50 }, { retry: false });
  const pnlHistory = trpc.pnl.history.useQuery({ days: 14 }, { retry: false, staleTime: 60_000 });
  const utils = trpc.useUtils();

  const startBot = trpc.bot.start.useMutation({
    onSuccess: (res: any) => {
      utils.bot.status.invalidate();
      if (res.success) toast.success("Motor PHANTOM iniciado");
      else toast.error(res.error || "Error al iniciar");
    },
    onError: () => toast.error("Error al iniciar el motor"),
  });
  const stopBot = trpc.bot.stop.useMutation({
    onSuccess: () => { utils.bot.status.invalidate(); toast.success("Motor detenido"); }
  });
  const emergencyStop = trpc.bot.emergencyStop.useMutation({
    onSuccess: () => { utils.bot.status.invalidate(); toast.error("PARADA DE EMERGENCIA ejecutada"); }
  });
  const markRead = trpc.bot.markNotificationsRead.useMutation({
    onSuccess: () => utils.bot.status.invalidate()
  });

  const [bellOpen, setBellOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleRefresh = useCallback(async () => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(30);
    setIsRefreshing(true);
    await Promise.all([
      utils.bot.status.invalidate(),
      utils.prices.live.invalidate(),
    ]);
    setTimeout(() => setIsRefreshing(false), 800);
  }, [utils]);

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
  const selectedExchange = (state as any)?.selectedExchange ?? "bybit";

  const updateSettings = trpc.bot.updateSettings.useMutation({
    onSuccess: () => { utils.bot.status.invalidate(); },
  });
  const handleExchangeChange = (exchange: string) => {
    if (isRunning) { toast.error("Detené el bot antes de cambiar de exchange"); return; }
    updateSettings.mutate({ selectedExchange: exchange });
    toast.success(`Exchange cambiado a ${exchange === "kucoin" ? "KuCoin" : "Bybit"}`);
  };

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

  const strategies = strategiesQuery.data ?? [];
  const barData = strategies.length > 0
    ? strategies.map((s: any) => ({
        pair: s.symbol.replace("USDT", ""),
        pnl: parseFloat(String(s.pnl ?? "0")),
      }))
    : [{ pair: "BTC", pnl: 0 }, { pair: "ETH", pnl: 0 }, { pair: "XAU", pnl: 0 }];

  const tickerPairs = [
    { symbol: "BTCUSDT", label: "BTC/USDT", icon: "₿", shortLabel: "BTC" },
    { symbol: "ETHUSDT", label: "ETH/USDT", icon: "Ξ", shortLabel: "ETH" },
    { symbol: "XAUUSDT", label: "Oro/USDT", icon: "🥇", shortLabel: "Oro" },
    { symbol: "SP500", label: "S&P 500", icon: "📈", shortLabel: "S&P" },
  ];

  if (isLoading && publicPrices.isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-12 glass-card rounded-xl" />
        <div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 glass-card rounded-xl" />)}</div>
        <div className="h-32 glass-card rounded-xl" />
        <div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 glass-card rounded-xl" />)}</div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="space-y-4">
        {/* Mobile Exchange Selector */}
        <div className="flex gap-2">
          {["bybit", "kucoin"].map(ex => (
            <button
              key={ex}
              onClick={() => handleExchangeChange(ex)}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all border ${
                selectedExchange === ex
                  ? "bg-primary/10 border-primary/50 text-primary"
                  : "bg-secondary/30 border-border text-muted-foreground"
              }`}
            >
              {ex === "bybit" ? "Bybit" : "KuCoin"}
            </button>
          ))}
        </div>

        {/* Mobile Status Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant={isRunning ? "default" : "secondary"}
              className={`text-xs px-2 py-1 ${isRunning ? "bg-primary/20 text-primary border-primary/30" : ""}`}
            >
              {isRunning
                ? <><span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live mr-1.5 inline-block" />EN VIVO</>
                : <><WifiOff className="h-3 w-3 mr-1" />DESCONECTADO</>
              }
            </Badge>
            {state?.simulationMode && (
              <Badge variant="outline" className="text-xs border-[oklch(0.8_0.15_85)] text-[oklch(0.8_0.15_85)]">
                SIMULACIÓN
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleRefresh}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent/50 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            <Popover open={bellOpen} onOpenChange={(open) => { setBellOpen(open); if (open && unread > 0) markRead.mutate(); }}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-8 w-8">
                  <Bell className="h-4 w-4" />
                  {unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold flex items-center justify-center text-white">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="end">
                <div className="p-3 border-b"><h4 className="font-semibold text-sm">Notificaciones</h4></div>
                <div className="max-h-64 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-4 text-center">Sin notificaciones aún.</p>
                  ) : notifications.map((n: any) => (
                    <div key={n.id} className="p-3 border-b last:border-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{n.symbol}</span>
                        <Badge variant={String(n.signal).includes("BUY") ? "default" : "destructive"} className="text-[10px]">
                          {String(n.signal).includes("BUY") ? "COMPRA" : "VENTA"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Confianza: {n.confidence}%</p>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Mobile Bot Controls */}
        <div className="grid grid-cols-2 gap-2">
          {!isRunning ? (
            <Button
              onClick={() => startBot.mutate()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 h-12 text-sm font-semibold col-span-2"
              disabled={startBot.isPending}
            >
              <Play className="h-4 w-4" />
              {startBot.isPending ? "Iniciando..." : "Iniciar Bot"}
            </Button>
          ) : (
            <>
              <Button
                onClick={() => stopBot.mutate()}
                variant="secondary"
                className="gap-2 h-12 text-sm font-semibold"
                disabled={stopBot.isPending}
              >
                <Square className="h-4 w-4" />
                Detener
              </Button>
              <Button
                onClick={() => emergencyStop.mutate()}
                variant="destructive"
                className="gap-2 h-12 text-sm font-semibold"
                disabled={emergencyStop.isPending}
              >
                <AlertTriangle className="h-4 w-4" />
                Emergencia
              </Button>
            </>
          )}
        </div>

        {/* Mobile Price Ticker - Horizontal Scroll */}
        <div className="overflow-x-auto -mx-3 px-3">
          <div className="flex gap-2.5 pb-1" style={{ width: "max-content" }}>
            {tickerPairs.map(({ symbol, label, icon, shortLabel }) => {
              const p = (livePrices as any)[symbol];
              const price = p?.lastPrice ?? 0;
              const change = p?.price24hPcnt ? p.price24hPcnt * 100 : 0;
              const isUp = change >= 0;
              return (
                <div key={symbol} className="glass-card p-3 flex flex-col gap-1" style={{ minWidth: "130px" }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{icon}</span>
                      <span className="text-xs font-semibold text-muted-foreground">{shortLabel}</span>
                    </div>
                    {price > 0 && (
                      <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${isUp ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
                        {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {fmtPct(change)}
                      </span>
                    )}
                  </div>
                  <p className="text-base font-bold tabular-nums">
                    {price > 0 ? "$" + fmtPrice(price) : <span className="text-muted-foreground text-sm">—</span>}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mobile PnL Card */}
        <div className={`glass-card ${pnlGlow} p-5 text-center`}>
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase mb-1">Resultado Total</p>
          <p className={`text-4xl font-bold tracking-tight ${pnlColor} tabular-nums`}>{fmt(totalPnl)}</p>
          <p className={`text-base mt-0.5 ${pnlColor}`}>{fmtPct(pnlPct)}</p>
        </div>

        {/* Mobile Stats Grid 2x2 */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { icon: Wallet, label: "SALDO", value: fmtUsd(balance) },
            { icon: Target, label: "INICIAL", value: fmtUsd(initial) },
            { icon: todayPnl >= 0 ? TrendingUp : TrendingDown, label: "HOY", value: fmt(todayPnl), color: todayPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]" },
            { icon: Trophy, label: "WIN RATE", value: winRate.toFixed(1) + "%" },
          ].map((s) => (
            <div key={s.label} className="glass-card p-4 text-center">
              <s.icon className="h-4 w-4 mx-auto text-muted-foreground mb-1.5" />
              <p className="text-[9px] font-semibold tracking-[0.15em] text-muted-foreground">{s.label}</p>
              <p className={`text-base font-bold mt-1 tabular-nums ${s.color ?? ""}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Mobile Stats Row */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="glass-card p-4 text-center">
            <Activity className="h-4 w-4 mx-auto text-muted-foreground mb-1.5" />
            <p className="text-[9px] font-semibold tracking-[0.15em] text-muted-foreground">OPERACIONES</p>
            <p className="text-base font-bold mt-1 tabular-nums">{totalTrades}</p>
          </div>
          <div className="glass-card p-4 text-center">
            <Clock className="h-4 w-4 mx-auto text-muted-foreground mb-1.5" />
            <p className="text-[9px] font-semibold tracking-[0.15em] text-muted-foreground">ACTIVO</p>
            <p className="text-base font-bold mt-1 tabular-nums">{isRunning ? uptime : "—"}</p>
          </div>
        </div>

        {/* Mobile Recent Trades */}
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Últimas Operaciones</h3>
          </div>
          <div className="space-y-2">
            {(!tradesQuery.data || tradesQuery.data.length === 0) ? (
              <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
                <Activity className="h-5 w-5 opacity-20 mr-2" /> Sin operaciones aún
              </div>
            ) : (
              tradesQuery.data.slice(0, 5).map((t: any) => {
                const pnl = parseFloat(String(t.pnl ?? "0"));
                return (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={t.side === "buy" ? "default" : "destructive"} className="text-[9px] w-12 justify-center shrink-0">
                        {t.side === "buy" ? "COMPRA" : "VENTA"}
                      </Badge>
                      <span className="text-sm font-medium">{t.symbol?.replace("USDT", "")}</span>
                    </div>
                    <div className="flex items-center gap-2">
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

        {/* Mobile PnL History Chart */}
        {pnlHistory.data && pnlHistory.data.length > 0 && (
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Historial PnL (14 días)</h3>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={[...pnlHistory.data].reverse()} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} tickFormatter={(v) => v?.slice(5)} />
                <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} />
                <Tooltip
                  contentStyle={{ background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any) => [fmt(parseFloat(v)), 'PnL']}
                />
                <Area type="monotone" dataKey="pnl" stroke="oklch(0.72 0.19 160)" fill="url(#pnlGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Mobile Risk Management */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[oklch(0.8_0.15_85)]" />
              <h3 className="font-semibold text-sm">Gestión de Riesgo</h3>
            </div>
            <Badge variant="outline" className={`text-[10px] ${dailyLoss > 200 ? "border-destructive/50 text-destructive" : "border-primary/30 text-primary"}`}>
              {dailyLoss > 200 ? "⚠ ALTO" : "SEGURO"}
            </Badge>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Drawdown Máx.</span>
                <span className="tabular-nums">{(maxDrawdown * 100).toFixed(2)}% / 10%</span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${Math.min((maxDrawdown * 100) / 10 * 100, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Pérdida Diaria</span>
                <span className="tabular-nums">{fmtUsd(Math.abs(dailyLoss))} / $250</span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-[oklch(0.8_0.15_85)] rounded-full transition-all duration-500" style={{ width: `${Math.min((Math.abs(dailyLoss) / 250) * 100, 100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Footer */}
        <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground py-2">
          <span className="flex items-center gap-1">{isRunning ? <Wifi className="h-3 w-3 text-primary" /> : <WifiOff className="h-3 w-3" />} {isRunning ? "Conectado" : "Desconectado"}</span>
          <span>Ciclos: {data?.cycles ?? 0}</span>
          <span>{currentTime.toLocaleTimeString()}</span>
        </div>
      </div>
    );
  }

  // ─── Desktop Layout ───
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold tracking-tight">Panel</h1>
            {/* Exchange Selector */}
            <div className="flex gap-1 bg-secondary/30 rounded-lg p-0.5">
              {["bybit", "kucoin"].map(ex => (
                <button
                  key={ex}
                  onClick={() => handleExchangeChange(ex)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    selectedExchange === ex
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {ex === "bybit" ? "Bybit" : "KuCoin"}
                </button>
              ))}
            </div>
          </div>
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

      {/* Desktop Price Ticker */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tickerPairs.map(({ symbol, label, icon }) => {
          const p = (livePrices as any)[symbol];
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
              {price === 0 && <span className="text-xs text-muted-foreground">—</span>}
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
