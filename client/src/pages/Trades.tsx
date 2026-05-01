import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, Activity, Download, Filter, TrendingUp, TrendingDown, ArrowUpDown } from "lucide-react";
import { useIsMobile } from "@/hooks/useMobile";
import { useState, useMemo } from "react";
import { toast } from "sonner";

const fmtPrice = (n: number) => {
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
};

type PeriodFilter = "all" | "today" | "7d" | "30d" | "year";
type ResultFilter = "all" | "wins" | "losses";
type StrategyFilter = "all" | "grid" | "scalping" | "futures" | "short_scalping" | "mean_reversion" | "bidirectional_grid";

export default function Trades() {
  const { data: trades, isLoading } = trpc.trades.list.useQuery({ limit: 5000 });
  const isMobile = useIsMobile();
  const [exporting, setExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [result, setResult] = useState<ResultFilter>("all");
  const [strategy, setStrategy] = useState<StrategyFilter>("all");
  const [symbolFilter, setSymbolFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"date" | "pnl">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const exportCsv = trpc.trades.exportCsv.useQuery(undefined, { enabled: false });

  // Get unique symbols
  const symbols = useMemo(() => {
    if (!trades) return [];
    const s = new Set(trades.map((t: any) => t.symbol));
    return Array.from(s).sort();
  }, [trades]);

  // Filter + sort trades
  const filteredTrades = useMemo(() => {
    if (!trades) return [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    const yearStart = new Date(now.getFullYear(), 0, 1);

    let filtered = trades.filter((t: any) => {
      const pnl = parseFloat(String(t.pnl ?? "0"));
      const date = new Date(t.createdAt);
      // Period filter
      if (period === "today" && date < todayStart) return false;
      if (period === "7d" && date < weekStart) return false;
      if (period === "30d" && date < monthStart) return false;
      if (period === "year" && date < yearStart) return false;
      // Result filter
      if (result === "wins" && pnl <= 0) return false;
      if (result === "losses" && pnl >= 0) return false;
      // Strategy filter
      if (strategy !== "all" && t.strategy !== strategy) return false;
      // Symbol filter
      if (symbolFilter !== "all" && t.symbol !== symbolFilter) return false;
      return true;
    });

    // Sort
    filtered.sort((a: any, b: any) => {
      if (sortBy === "pnl") {
        const pnlA = parseFloat(String(a.pnl ?? "0"));
        const pnlB = parseFloat(String(b.pnl ?? "0"));
        return sortDir === "desc" ? pnlB - pnlA : pnlA - pnlB;
      }
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return sortDir === "desc" ? dateB - dateA : dateA - dateB;
    });

    return filtered;
  }, [trades, period, result, strategy, symbolFilter, sortBy, sortDir]);

  // Summary stats for filtered trades
  const stats = useMemo(() => {
    const sells = filteredTrades.filter((t: any) => t.side?.toLowerCase() === "sell");
    const pnls = sells.map((t: any) => parseFloat(String(t.pnl ?? "0")));
    const totalPnl = pnls.reduce((s: number, p: number) => s + p, 0);
    const wins = pnls.filter((p: number) => p > 0);
    const losses = pnls.filter((p: number) => p < 0);
    const winRate = sells.length > 0 ? (wins.length / sells.length) * 100 : 0;
    const totalWins = wins.reduce((s: number, p: number) => s + p, 0);
    const totalLosses = Math.abs(losses.reduce((s: number, p: number) => s + p, 0));
    return { totalPnl, winRate, totalTrades: filteredTrades.length, sellTrades: sells.length, wins: wins.length, losses: losses.length, totalWins, totalLosses };
  }, [filteredTrades]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await exportCsv.refetch();
      if (result.data?.csv) {
        const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `phantom-trades-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exportado: ${result.data.count} operaciones`);
      }
    } catch { toast.error('Error al exportar'); }
    setExporting(false);
  };

  const toggleSort = (field: "date" | "pnl") => {
    if (sortBy === field) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(field); setSortDir("desc"); }
  };

  if (isLoading) return (
    <div className="space-y-3 animate-pulse">
      <div className="h-8 glass-card rounded-xl w-48" />
      {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 glass-card rounded-xl" />)}
    </div>
  );

  const FilterBar = () => (
    <div className="glass-card p-3 space-y-3">
      {/* Period buttons */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Período</p>
        <div className="flex gap-1.5 flex-wrap">
          {([["all", "Todo"], ["today", "Hoy"], ["7d", "7D"], ["30d", "30D"], ["year", "Año"]] as const).map(([key, label]) => (
            <Button key={key} size="sm" variant={period === key ? "default" : "outline"} onClick={() => setPeriod(key)}
              className={`text-[11px] h-7 px-2.5 ${period === key ? "bg-primary text-primary-foreground" : "bg-transparent"}`}>{label}</Button>
          ))}
        </div>
      </div>
      {/* Strategy + Result */}
      <div className="flex gap-4">
        <div className="flex-1">
          <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Estrategia</p>
          <div className="flex gap-1.5 flex-wrap">
            {([["all", "Todas"], ["grid", "Grid"], ["scalping", "Scalp"], ["short_scalping", "Short"], ["mean_reversion", "MeanRev"], ["bidirectional_grid", "BiGrid"], ["futures", "Futures"]] as const).map(([key, label]) => (
              <Button key={key} size="sm" variant={strategy === key ? "default" : "outline"} onClick={() => setStrategy(key as StrategyFilter)}
                className={`text-[11px] h-7 px-2.5 ${strategy === key ? "bg-primary text-primary-foreground" : "bg-transparent"}`}>{label}</Button>
            ))}
          </div>
        </div>
        <div className="flex-1">
          <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Resultado</p>
          <div className="flex gap-1.5 flex-wrap">
            {([["all", "Todo"], ["wins", "Ganancias"], ["losses", "Pérdidas"]] as const).map(([key, label]) => (
              <Button key={key} size="sm" variant={result === key ? "default" : "outline"} onClick={() => setResult(key)}
                className={`text-[11px] h-7 px-2.5 ${result === key ? "bg-primary text-primary-foreground" : "bg-transparent"}`}>{label}</Button>
            ))}
          </div>
        </div>
      </div>
      {/* Symbol filter */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Símbolo</p>
        <div className="flex gap-1.5 flex-wrap">
          <Button size="sm" variant={symbolFilter === "all" ? "default" : "outline"} onClick={() => setSymbolFilter("all")}
            className={`text-[11px] h-7 px-2.5 ${symbolFilter === "all" ? "bg-primary text-primary-foreground" : "bg-transparent"}`}>Todos</Button>
          {symbols.map((s: string) => (
            <Button key={s} size="sm" variant={symbolFilter === s ? "default" : "outline"} onClick={() => setSymbolFilter(s)}
              className={`text-[11px] h-7 px-2.5 ${symbolFilter === s ? "bg-primary text-primary-foreground" : "bg-transparent"}`}>{s.replace("USDT", "")}</Button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Historial de Operaciones
          </h1>
          <p className="text-xs text-muted-foreground mt-1">{filteredTrades.length} operaciones {period !== "all" ? `(${period === "today" ? "hoy" : period})` : ""}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className={`gap-1.5 text-xs ${showFilters ? "bg-primary text-primary-foreground" : ""}`}>
            <Filter className="h-3.5 w-3.5" /> Filtros
          </Button>
          {trades && trades.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" /> {exporting ? '...' : 'CSV'}
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      {showFilters && <FilterBar />}

      {/* Summary Stats */}
      {filteredTrades.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="glass-card p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase">PnL Neto</p>
            <p className={`text-lg font-bold tabular-nums ${stats.totalPnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
              {stats.totalPnl >= 0 ? "+" : ""}${stats.totalPnl.toFixed(2)}
            </p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase">Win Rate</p>
            <p className="text-lg font-bold tabular-nums">{stats.winRate.toFixed(0)}%</p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase flex items-center justify-center gap-1"><TrendingUp className="h-3 w-3 text-[oklch(0.72_0.19_160)]" /> Ganancias</p>
            <p className="text-lg font-bold tabular-nums text-[oklch(0.72_0.19_160)]">+${stats.totalWins.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground">{stats.wins} trades</p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase flex items-center justify-center gap-1"><TrendingDown className="h-3 w-3 text-[oklch(0.63_0.24_25)]" /> Pérdidas</p>
            <p className="text-lg font-bold tabular-nums text-[oklch(0.63_0.24_25)]">-${stats.totalLosses.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground">{stats.losses} trades</p>
          </div>
        </div>
      )}

      {/* Trade list */}
      {filteredTrades.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Activity className="h-10 w-10 text-primary/30 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {trades && trades.length > 0 ? "No hay operaciones con estos filtros." : "Sin operaciones aún. Iniciá el bot para comenzar a operar."}
          </p>
        </div>
      ) : isMobile ? (
        <div className="space-y-2.5">
          {filteredTrades.map((t: any) => {
            const pnl = parseFloat(String(t.pnl ?? "0"));
            const isBuy = t.side?.toLowerCase() === "buy";
            return (
              <div key={t.id} className="glass-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={isBuy ? "default" : "destructive"} className="text-[10px] px-2">{isBuy ? "COMPRA" : "VENTA"}</Badge>
                    <span className="font-bold text-base">{t.symbol?.replace("USDT", "")}</span>
                    <Badge variant="outline" className="text-[9px]">
                      {({ grid: "Grid", scalping: "Scalping", short_scalping: "Short", mean_reversion: "MeanRev", bidirectional_grid: "BiGrid", futures: "Futures" } as Record<string, string>)[t.strategy ?? ""] ?? t.strategy}
                    </Badge>
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${pnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
                    {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Precio: <span className="text-foreground font-mono">${fmtPrice(parseFloat(String(t.price)))}</span></span>
                  <span>Qty: <span className="text-foreground font-mono">{t.qty}</span></span>
                  <span>{new Date(t.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/30">
                  <th className="text-left p-3 font-medium text-muted-foreground">Símbolo</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Lado</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Precio</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Cantidad</th>
                  <th className="text-right p-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("pnl")}>
                    <span className="flex items-center justify-end gap-1">PnL <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Estrategia</th>
                  <th className="text-left p-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("date")}>
                    <span className="flex items-center gap-1">Fecha <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((t: any) => {
                  const pnl = parseFloat(String(t.pnl ?? "0"));
                  return (
                    <tr key={t.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                      <td className="p-3 font-medium">{t.symbol}</td>
                      <td className="p-3">
                        <Badge variant={t.side?.toLowerCase() === "buy" ? "default" : "destructive"} className="text-[10px]">
                          {t.side?.toLowerCase() === "buy" ? "COMPRA" : "VENTA"}
                        </Badge>
                      </td>
                      <td className="p-3 text-right font-mono">${fmtPrice(parseFloat(String(t.price)))}</td>
                      <td className="p-3 text-right font-mono">{t.qty}</td>
                      <td className={`p-3 text-right font-mono font-semibold ${pnl >= 0 ? "text-[oklch(0.72_0.19_160)]" : "text-[oklch(0.63_0.24_25)]"}`}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-[10px]">
                          {({ grid: "Grid", scalping: "Scalping", short_scalping: "Short", mean_reversion: "MeanRev", bidirectional_grid: "BiGrid", futures: "Futures" } as Record<string, string>)[t.strategy ?? ""] ?? t.strategy}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
