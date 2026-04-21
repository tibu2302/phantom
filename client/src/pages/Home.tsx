import { trpc } from "@/lib/trpc";
import {
  Bell, Play, Square, AlertTriangle, TrendingUp, TrendingDown,
  Wallet, Target, Trophy, Activity, BarChart3, Shield, Wifi, WifiOff,
  Clock, Zap, ArrowUpRight, ArrowDownRight, RefreshCw, Eye, EyeOff,
  ChevronRight, Flame, DollarSign
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
const fmtCompact = (n: number) => {
  if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + n.toFixed(2);
};

export default function Home() {
  const isMobile = useIsMobile();
  const { data, isLoading, refetch: refetchStatus } = trpc.bot.status.useQuery(undefined, { refetchInterval: 5000, retry: false });
  const publicPrices = trpc.prices.live.useQuery(undefined, { refetchInterval: 8000 });
  const strategiesQuery = trpc.strategies.list.useQuery(undefined, { retry: false });
  const tradesQuery = trpc.trades.list.useQuery({ limit: 50 }, { retry: false });
  const pnlHistory = trpc.pnl.history.useQuery({ days: 14 }, { retry: false, staleTime: 60_000 });
  const exchangeBalances = trpc.bot.exchangeBalances.useQuery(undefined, { refetchInterval: 30_000, retry: false });
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
  const [hideBalances, setHideBalances] = useState(false);

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
  const unrealizedPnl = (data as any)?.totalUnrealizedPnl ?? 0;
  const openPositions = (data as any)?.openPositions ?? { grid: [], futures: [] };
  const totalOpenPositions = (openPositions.grid?.length ?? 0) + (openPositions.futures?.length ?? 0);

  const updateSettings = trpc.bot.updateSettings.useMutation({
    onSuccess: () => { utils.bot.status.invalidate(); },
  });
  const exchangeLabel = (ex: string) => ex === "kucoin" ? "KuCoin" : ex === "bybit" ? "Bybit" : "Ambos";
  const handleExchangeChange = (exchange: string) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(15);
    if (isRunning) { toast.error("Detené el bot antes de cambiar de exchange"); return; }
    updateSettings.mutate({ selectedExchange: exchange });
    toast.success(`Exchange: ${exchangeLabel(exchange)}`);
  };

  const livePrices = (data?.livePrices && Object.keys(data.livePrices).length > 0)
    ? data.livePrices
    : (publicPrices.data ?? {});

  const uptime = useMemo(() => {
    if (!state?.startedAt || !isRunning) return null;
    const diff = Date.now() - new Date(state.startedAt).getTime();
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }, [state?.startedAt, isRunning, currentTime]);

  const pnlColor = totalPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]";
  const todayColor = todayPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]";

  const strategies = strategiesQuery.data ?? [];
  const barData = strategies.length > 0
    ? strategies.map((s: any) => ({
        pair: s.symbol.replace("USDT", ""),
        pnl: parseFloat(String(s.pnl ?? "0")),
      }))
    : [{ pair: "BTC", pnl: 0 }, { pair: "ETH", pnl: 0 }, { pair: "XAU", pnl: 0 }];

  const tickerPairs = [
    { symbol: "BTCUSDT", label: "BTC", icon: "₿" },
    { symbol: "ETHUSDT", label: "ETH", icon: "Ξ" },
    { symbol: "XAUUSDT", label: "Oro", icon: "🥇" },
    { symbol: "SP500", label: "S&P", icon: "📈" },
  ];

  if (isLoading && publicPrices.isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-14 glass-card rounded-2xl" />
        <div className="h-40 glass-card rounded-2xl" />
        <div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 glass-card rounded-2xl" />)}</div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="space-y-3 pb-2">
        {/* ── Header: Exchange + Status + Actions ── */}
        <div className="flex items-center justify-between">
          {/* Exchange Pills */}
          <div className="flex gap-1.5 bg-[oklch(0.14_0.005_260)] rounded-xl p-1">
            {["bybit", "kucoin", "both"].map(ex => (
              <button
                key={ex}
                onClick={() => handleExchangeChange(ex)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-all duration-200 ${
                  selectedExchange === ex
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {exchangeLabel(ex)}
              </button>
            ))}
          </div>
          {/* Right Actions */}
          <div className="flex items-center gap-1">
            <button onClick={() => setHideBalances(!hideBalances)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent/50 transition-colors">
              {hideBalances ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
            </button>
            <button onClick={handleRefresh} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent/50 transition-colors">
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            <Popover open={bellOpen} onOpenChange={(open) => { setBellOpen(open); if (open && unread > 0) markRead.mutate(); }}>
              <PopoverTrigger asChild>
                <button className="relative h-8 w-8 flex items-center justify-center rounded-lg hover:bg-accent/50 transition-colors">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  {unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-[9px] font-bold flex items-center justify-center text-white">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="end">
                <div className="p-3 border-b"><h4 className="font-semibold text-sm">Notificaciones</h4></div>
                <div className="max-h-64 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-4 text-center">Sin notificaciones</p>
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

        {/* ── Status + Bot Controls ── */}
        <div className="flex items-center gap-2">
          <Badge
            variant={isRunning ? "default" : "secondary"}
            className={`text-[10px] px-2.5 py-1 ${isRunning ? "bg-primary/15 text-primary border-primary/25" : ""}`}
          >
            {isRunning
              ? <><span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live mr-1.5 inline-block" />EN VIVO</>
              : <><WifiOff className="h-3 w-3 mr-1" />OFFLINE</>
            }
          </Badge>
          {state?.simulationMode && (
            <Badge variant="outline" className="text-[10px] border-[oklch(0.8_0.15_85)]/50 text-[oklch(0.8_0.15_85)]">SIM</Badge>
          )}
          {uptime && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />{uptime}
            </span>
          )}
          <div className="flex-1" />
          {!isRunning ? (
            <Button
              onClick={() => startBot.mutate()}
              size="sm"
              className="h-8 px-4 text-xs font-bold gap-1.5 bg-primary hover:bg-primary/90"
              disabled={startBot.isPending}
            >
              <Play className="h-3.5 w-3.5" />
              {startBot.isPending ? "..." : "Iniciar"}
            </Button>
          ) : (
            <div className="flex gap-1.5">
              <Button onClick={() => stopBot.mutate()} variant="secondary" size="sm" className="h-8 px-3 text-xs font-semibold" disabled={stopBot.isPending}>
                <Square className="h-3 w-3" />
              </Button>
              <Button onClick={() => emergencyStop.mutate()} variant="destructive" size="sm" className="h-8 px-3 text-xs font-semibold" disabled={emergencyStop.isPending}>
                <AlertTriangle className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        {/* ── Price Ticker Strip ── */}
        <div className="overflow-x-auto -mx-3 px-3 scrollbar-none">
          <div className="flex gap-2" style={{ width: "max-content" }}>
            {tickerPairs.map(({ symbol, label, icon }) => {
              const p = (livePrices as any)[symbol];
              const price = p?.lastPrice ?? 0;
              const change = p?.price24hPcnt ? p.price24hPcnt * 100 : 0;
              const isUp = change >= 0;
              return (
                <div key={symbol} className="flex items-center gap-2 bg-[oklch(0.14_0.005_260)] rounded-xl px-3 py-2">
                  <span className="text-sm">{icon}</span>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
                    <span className="text-xs font-bold tabular-nums">{price > 0 ? "$" + fmtPrice(price) : "—"}</span>
                  </div>
                  {price > 0 && (
                    <span className={`text-[10px] font-bold ml-1 ${isUp ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
                      {isUp ? "↑" : "↓"}{Math.abs(change).toFixed(1)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Main PnL Hero Card ── */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[oklch(0.18_0.01_160)] to-[oklch(0.14_0.005_260)] border border-primary/10 p-5">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl -translate-y-8 translate-x-8" />
          <div className="relative">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground uppercase">Resultado Total</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pnlPct >= 0 ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>
                {fmtPct(pnlPct)}
              </span>
            </div>
            <p className={`text-4xl font-black tracking-tight tabular-nums ${pnlColor}`}>
              {hideBalances ? "••••••" : fmt(totalPnl)}
            </p>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${todayPnl >= 0 ? 'bg-[oklch(0.72_0.19_160)]' : 'bg-[oklch(0.63_0.24_25)]'}`} />
                <span className="text-[10px] text-muted-foreground">Hoy</span>
                <span className={`text-xs font-bold tabular-nums ${todayColor}`}>{hideBalances ? "••••" : fmt(todayPnl)}</span>
              </div>
              {totalOpenPositions > 0 && (
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${unrealizedPnl >= 0 ? 'bg-[oklch(0.75_0.14_200)]' : 'bg-[oklch(0.8_0.15_85)]'}`} />
                  <span className="text-[10px] text-muted-foreground">Abierto</span>
                  <span className={`text-xs font-bold tabular-nums ${unrealizedPnl >= 0 ? 'text-[oklch(0.75_0.14_200)]' : 'text-[oklch(0.8_0.15_85)]'}`}>
                    {hideBalances ? "••••" : fmt(unrealizedPnl)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Stats Grid: 2x3 ── */}
        <div className="grid grid-cols-2 gap-2">
          <div className="glass-card p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[oklch(0.8_0.18_80)]/10 flex items-center justify-center shrink-0">
              <DollarSign className="h-4 w-4 text-[oklch(0.8_0.18_80)]" />
            </div>
            <div>
              <p className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">Bybit</p>
              <p className="text-sm font-bold tabular-nums mt-0.5">{hideBalances ? "••••••" : exchangeBalances.data?.bybit ? fmtUsd(parseFloat(exchangeBalances.data.bybit.balance)) : "—"}</p>
            </div>
          </div>
          <div className="glass-card p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[oklch(0.75_0.14_170)]/10 flex items-center justify-center shrink-0">
              <DollarSign className="h-4 w-4 text-[oklch(0.75_0.14_170)]" />
            </div>
            <div>
              <p className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">KuCoin</p>
              <p className="text-sm font-bold tabular-nums mt-0.5">{hideBalances ? "••••••" : exchangeBalances.data?.kucoin ? fmtUsd(parseFloat(exchangeBalances.data.kucoin.balance)) : "—"}</p>
            </div>
          </div>
          <div className="glass-card p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[oklch(0.8_0.15_85)]/10 flex items-center justify-center shrink-0">
              <Trophy className="h-4 w-4 text-[oklch(0.8_0.15_85)]" />
            </div>
            <div>
              <p className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">Win Rate</p>
              <p className="text-sm font-bold tabular-nums mt-0.5">{winRate.toFixed(1)}%</p>
            </div>
          </div>
          <div className="glass-card p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[oklch(0.65_0.2_300)]/10 flex items-center justify-center shrink-0">
              <Activity className="h-4 w-4 text-[oklch(0.65_0.2_300)]" />
            </div>
            <div>
              <p className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">Trades</p>
              <p className="text-sm font-bold tabular-nums mt-0.5">{totalTrades}</p>
            </div>
          </div>
        </div>

        {/* ── Open Positions (if any) ── */}
        {totalOpenPositions > 0 && (
          <div className="glass-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-[oklch(0.8_0.15_85)]" />
                <span className="text-xs font-bold">Posiciones Abiertas</span>
              </div>
              <Badge variant="outline" className="text-[9px] font-bold">{totalOpenPositions}</Badge>
            </div>
            <div className="divide-y divide-border/20">
              {[...openPositions.grid, ...openPositions.futures].slice(0, 5).map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">{p.symbol?.replace('USDT', '')}</span>
                    <span className="text-[10px] text-muted-foreground">@ ${fmtPrice(p.buyPrice)}</span>
                  </div>
                  <span className={`text-xs font-bold tabular-nums ${p.unrealizedPnl >= 0 ? 'text-[oklch(0.72_0.19_160)]' : 'text-[oklch(0.63_0.24_25)]'}`}>
                    {hideBalances ? "••" : fmt(p.unrealizedPnl)}
                  </span>
                </div>
              ))}
              {totalOpenPositions > 5 && (
                <div className="px-4 py-2 text-center">
                  <span className="text-[10px] text-muted-foreground">+{totalOpenPositions - 5} más</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PnL Chart ── */}
        {pnlHistory.data && pnlHistory.data.length > 0 && (
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <h3 className="font-bold text-xs">Rendimiento 14d</h3>
              </div>
              <span className={`text-[10px] font-bold ${pnlColor}`}>{fmtPct(pnlPct)}</span>
            </div>
            <ResponsiveContainer width="100%" height={100}>
              <AreaChart data={[...pnlHistory.data].reverse()} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="pnlGradMobile" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.3)' }} tickFormatter={(v) => v?.slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.3)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 11, padding: '8px 12px' }}
                  formatter={(v: any) => [fmt(parseFloat(v)), 'PnL']}
                />
                <Area type="monotone" dataKey="pnl" stroke="oklch(0.72 0.19 160)" fill="url(#pnlGradMobile)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Recent Trades ── */}
        <div className="glass-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <h3 className="font-bold text-xs">Últimas Operaciones</h3>
            </div>
            {tradesQuery.data && tradesQuery.data.length > 0 && (
              <span className="text-[10px] text-muted-foreground">{tradesQuery.data.length} ops</span>
            )}
          </div>
          <div className="divide-y divide-border/20">
            {(!tradesQuery.data || tradesQuery.data.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Activity className="h-8 w-8 opacity-15 mb-2" />
                <span className="text-xs">Sin operaciones aún</span>
              </div>
            ) : (
              tradesQuery.data.slice(0, 8).map((t: any) => {
                const pnl = parseFloat(String(t.pnl ?? "0"));
                const date = t.createdAt ? new Date(t.createdAt) : null;
                return (
                  <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-1.5 h-7 rounded-full ${t.side === "buy" ? "bg-primary" : pnl >= 0 ? "bg-[oklch(0.72_0.19_160)]" : "bg-[oklch(0.63_0.24_25)]"}`} />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold">{t.symbol?.replace("USDT", "")}</span>
                          <Badge
                            variant={t.side === "buy" ? "default" : "destructive"}
                            className="text-[8px] px-1.5 py-0 h-4"
                          >
                            {t.side === "buy" ? "C" : "V"}
                          </Badge>
                          {t.strategyType && (
                            <span className="text-[8px] text-muted-foreground capitalize">{t.strategyType}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] text-muted-foreground tabular-nums">${fmtPrice(parseFloat(String(t.price ?? "0")))}</span>
                          {date && <span className="text-[9px] text-muted-foreground/60">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                        </div>
                      </div>
                    </div>
                    <span className={`text-xs font-bold tabular-nums ${pnl > 0 ? "text-[oklch(0.72_0.19_160)]" : pnl < 0 ? "text-[oklch(0.63_0.24_25)]" : "text-muted-foreground"}`}>
                      {hideBalances ? "••" : fmt(pnl)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Risk Management ── */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[oklch(0.8_0.15_85)]" />
              <h3 className="font-bold text-xs">Riesgo</h3>
            </div>
            <Badge variant="outline" className={`text-[9px] font-bold ${dailyLoss > 200 ? "border-destructive/50 text-destructive" : "border-primary/30 text-primary"}`}>
              {dailyLoss > 200 ? "ALTO" : "OK"}
            </Badge>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-[10px] mb-1.5">
                <span className="text-muted-foreground">Max Drawdown</span>
                <span className="tabular-nums font-semibold">{hideBalances ? "••" : `${(maxDrawdown * 100).toFixed(2)}%`} / 10%</span>
              </div>
              <div className="h-1.5 bg-[oklch(0.14_0.005_260)] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-[oklch(0.75_0.14_200)] rounded-full transition-all duration-700" style={{ width: `${Math.min((maxDrawdown * 100) / 10 * 100, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] mb-1.5">
                <span className="text-muted-foreground">Pérdida Diaria</span>
                <span className="tabular-nums font-semibold">{hideBalances ? "••" : fmtUsd(Math.abs(dailyLoss))} / $250</span>
              </div>
              <div className="h-1.5 bg-[oklch(0.14_0.005_260)] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[oklch(0.8_0.15_85)] to-destructive rounded-full transition-all duration-700" style={{ width: `${Math.min((Math.abs(dailyLoss) / 250) * 100, 100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-center gap-3 text-[9px] text-muted-foreground/50 py-1">
          <span className="flex items-center gap-1">
            {isRunning ? <Wifi className="h-2.5 w-2.5 text-primary" /> : <WifiOff className="h-2.5 w-2.5" />}
            {isRunning ? "Live" : "Off"}
          </span>
          <span className="w-0.5 h-0.5 rounded-full bg-muted-foreground/30" />
          <span>Ciclos: {data?.cycles ?? 0}</span>
          <span className="w-0.5 h-0.5 rounded-full bg-muted-foreground/30" />
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
            <div className="flex gap-1 bg-secondary/30 rounded-lg p-0.5">
              {["bybit", "kucoin", "both"].map(ex => (
                <button
                  key={ex}
                  onClick={() => handleExchangeChange(ex)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    selectedExchange === ex
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {exchangeLabel(ex)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <Badge variant={isRunning ? "default" : "secondary"} className={isRunning ? "bg-primary/20 text-primary border-primary/30" : ""}>
              {isRunning ? <><span className="w-1.5 h-1.5 rounded-full bg-primary pulse-live mr-1.5 inline-block" /> EN VIVO</> : <><WifiOff className="h-3 w-3 mr-1" /> DESCONECTADO</>}
            </Badge>
            {state?.simulationMode && <Badge variant="outline" className="border-[oklch(0.8_0.15_85)] text-[oklch(0.8_0.15_85)]">SIMULACIÓN</Badge>}
            {uptime && <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{uptime}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setHideBalances(!hideBalances)} className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent/50 transition-colors">
            {hideBalances ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
          </button>
          <Popover open={bellOpen} onOpenChange={(open) => { setBellOpen(open); if (open && unread > 0) markRead.mutate(); }}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-destructive text-[10px] font-bold flex items-center justify-center text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="p-3 border-b"><h4 className="font-semibold text-sm">Notificaciones</h4></div>
              <div className="max-h-64 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4 text-center">Sin notificaciones</p>
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
          {!isRunning ? (
            <Button onClick={() => startBot.mutate()} className="gap-2 font-semibold" disabled={startBot.isPending}>
              <Play className="h-4 w-4" /> Iniciar
            </Button>
          ) : (
            <>
              <Button onClick={() => stopBot.mutate()} variant="secondary" className="gap-2" disabled={stopBot.isPending}>
                <Square className="h-4 w-4" /> Detener
              </Button>
              <Button onClick={() => emergencyStop.mutate()} variant="destructive" className="gap-2" disabled={emergencyStop.isPending}>
                <AlertTriangle className="h-4 w-4" /> Emergencia
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Desktop Price Ticker */}
      <div className="grid grid-cols-4 gap-3">
        {tickerPairs.map(({ symbol, label, icon }) => {
          const p = (livePrices as any)[symbol];
          const price = p?.lastPrice ?? 0;
          const change = p?.price24hPcnt ? p.price24hPcnt * 100 : 0;
          const isUp = change >= 0;
          return (
            <div key={symbol} className="glass-card p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{icon}</span>
                <div>
                  <p className="text-xs text-muted-foreground">{label}/USDT</p>
                  <p className="text-lg font-bold tabular-nums">{price > 0 ? "$" + fmtPrice(price) : "—"}</p>
                </div>
              </div>
              {price > 0 && (
                <span className={`text-sm font-bold flex items-center gap-0.5 ${isUp ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
                  {isUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                  {fmtPct(change)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop Main Content */}
      <div className="grid grid-cols-3 gap-4">
        {/* PnL Card */}
        <div className="col-span-2 relative overflow-hidden rounded-2xl bg-gradient-to-br from-[oklch(0.18_0.01_160)] to-[oklch(0.14_0.005_260)] border border-primary/10 p-6">
          <div className="absolute top-0 right-0 w-48 h-48 bg-primary/5 rounded-full blur-3xl -translate-y-12 translate-x-12" />
          <div className="relative">
            <p className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground uppercase mb-2">Resultado Unificado</p>
            <p className={`text-5xl font-black tracking-tight tabular-nums ${pnlColor}`}>{hideBalances ? "••••••••" : fmt(totalPnl)}</p>
            <p className={`text-lg mt-1 font-semibold ${pnlColor}`}>{fmtPct(pnlPct)}</p>
            <div className="flex items-center gap-6 mt-4">
              <div>
                <span className="text-[10px] text-muted-foreground block">Hoy</span>
                <span className={`text-sm font-bold tabular-nums ${todayColor}`}>{hideBalances ? "••••" : fmt(todayPnl)}</span>
              </div>
              {totalOpenPositions > 0 && (
                <div>
                  <span className="text-[10px] text-muted-foreground block">No Realizado ({totalOpenPositions})</span>
                  <span className={`text-sm font-bold tabular-nums ${unrealizedPnl >= 0 ? 'text-[oklch(0.75_0.14_200)]' : 'text-[oklch(0.8_0.15_85)]'}`}>
                    {hideBalances ? "••••" : fmt(unrealizedPnl)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats Column */}
        <div className="space-y-3">
          {[
            { icon: DollarSign, label: "Bybit", value: hideBalances ? "••••••" : exchangeBalances.data?.bybit ? fmtUsd(parseFloat(exchangeBalances.data.bybit.balance)) : "—", color: "text-[oklch(0.8_0.18_80)]", bg: "bg-[oklch(0.8_0.18_80)]/10" },
            { icon: DollarSign, label: "KuCoin", value: hideBalances ? "••••••" : exchangeBalances.data?.kucoin ? fmtUsd(parseFloat(exchangeBalances.data.kucoin.balance)) : "—", color: "text-[oklch(0.75_0.14_170)]", bg: "bg-[oklch(0.75_0.14_170)]/10" },
            { icon: Trophy, label: "Win Rate", value: winRate.toFixed(1) + "%", color: "text-[oklch(0.8_0.15_85)]", bg: "bg-[oklch(0.8_0.15_85)]/10" },
            { icon: Activity, label: "Trades", value: String(totalTrades), color: "text-[oklch(0.65_0.2_300)]", bg: "bg-[oklch(0.65_0.2_300)]/10" },
          ].map((s) => (
            <div key={s.label} className="glass-card p-3 flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center shrink-0`}>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
              <div className="flex items-center justify-between flex-1">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <span className="text-sm font-bold tabular-nums">{s.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Desktop Charts Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* PnL by Pair */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">PnL por Par</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="pair" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)' }} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)' }} axisLine={false} />
              <Tooltip
                contentStyle={{ background: 'rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 12 }}
                formatter={(v: any) => [fmt(parseFloat(v)), 'PnL']}
              />
              <Bar dataKey="pnl" radius={[4, 4, 0, 0]} fill="oklch(0.72 0.19 160)" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Trades */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Últimas Operaciones</h3>
          </div>
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {(!tradesQuery.data || tradesQuery.data.length === 0) ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                <Activity className="h-5 w-5 opacity-20 mr-2" /> Sin operaciones
              </div>
            ) : (
              tradesQuery.data.slice(0, 8).map((t: any) => {
                const pnl = parseFloat(String(t.pnl ?? "0"));
                return (
                  <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={t.side === "buy" ? "default" : "destructive"} className="text-[9px] w-10 justify-center shrink-0">
                        {t.side === "buy" ? "C" : "V"}
                      </Badge>
                      <span className="text-sm font-medium">{t.symbol?.replace("USDT", "")}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums">${fmtPrice(parseFloat(String(t.price ?? "0")))}</span>
                      <span className={`text-xs font-bold tabular-nums min-w-16 text-right ${pnl > 0 ? "text-[oklch(0.72_0.19_160)]" : pnl < 0 ? "text-[oklch(0.63_0.24_25)]" : "text-muted-foreground"}`}>
                        {hideBalances ? "••" : fmt(pnl)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Desktop Risk + PnL History */}
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[oklch(0.8_0.15_85)]" />
              <h3 className="font-semibold text-sm">Gestión de Riesgo</h3>
            </div>
            <Badge variant="outline" className={`text-[10px] ${dailyLoss > 200 ? "border-destructive/50 text-destructive" : "border-primary/30 text-primary"}`}>
              {dailyLoss > 200 ? "ALTO" : "OK"}
            </Badge>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground">Max Drawdown</span>
                <span className="tabular-nums font-semibold">{hideBalances ? "••" : `${(maxDrawdown * 100).toFixed(2)}%`} / 10%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-[oklch(0.75_0.14_200)] rounded-full transition-all duration-700" style={{ width: `${Math.min((maxDrawdown * 100) / 10 * 100, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground">Pérdida Diaria</span>
                <span className="tabular-nums font-semibold">{hideBalances ? "••" : fmtUsd(Math.abs(dailyLoss))} / $250</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[oklch(0.8_0.15_85)] to-destructive rounded-full transition-all duration-700" style={{ width: `${Math.min((Math.abs(dailyLoss) / 250) * 100, 100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {pnlHistory.data && pnlHistory.data.length > 0 && (
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Historial PnL (14 días)</h3>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={[...pnlHistory.data].reverse()} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="pnlGradDesktop" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="oklch(0.72 0.19 160)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} tickFormatter={(v) => v?.slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 12 }}
                  formatter={(v: any) => [fmt(parseFloat(v)), 'PnL']}
                />
                <Area type="monotone" dataKey="pnl" stroke="oklch(0.72 0.19 160)" fill="url(#pnlGradDesktop)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Desktop Footer */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground py-2">
        <span className="flex items-center gap-1">{isRunning ? <Wifi className="h-3 w-3 text-primary" /> : <WifiOff className="h-3 w-3" />} {isRunning ? "Conectado" : "Desconectado"}</span>
        <span>Ciclos: {data?.cycles ?? 0}</span>
        <span>{currentTime.toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
