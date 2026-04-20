import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, Activity, Download } from "lucide-react";
import { useIsMobile } from "@/hooks/useMobile";
import { useState } from "react";
import { toast } from "sonner";

const fmtPrice = (n: number) => {
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
};

export default function Trades() {
  const { data: trades, isLoading } = trpc.trades.list.useQuery({ limit: 100 });
  const isMobile = useIsMobile();
  const [exporting, setExporting] = useState(false);
  const exportCsv = trpc.trades.exportCsv.useQuery(undefined, { enabled: false });

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await exportCsv.refetch();
      if (result.data?.csv) {
        const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `phantom-trades-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exportado: ${result.data.count} operaciones`);
      }
    } catch { toast.error('Error al exportar'); }
    setExporting(false);
  };

  if (isLoading) return (
    <div className="space-y-3 animate-pulse">
      <div className="h-8 glass-card rounded-xl w-48" />
      {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 glass-card rounded-xl" />)}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Historial de Operaciones
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Todas las operaciones ejecutadas</p>
        </div>
        {trades && trades.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="gap-1.5 text-xs">
            <Download className="h-3.5 w-3.5" />
            {exporting ? 'Exportando...' : 'CSV'}
          </Button>
        )}
      </div>

      {!trades || trades.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Activity className="h-10 w-10 text-primary/30 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Sin operaciones aún. Iniciá el bot para comenzar a operar.</p>
        </div>
      ) : isMobile ? (
        // Mobile: Card list layout
        <div className="space-y-2.5">
          {trades.map((t: any) => {
            const pnl = parseFloat(String(t.pnl ?? "0"));
            const isBuy = t.side?.toLowerCase() === "buy";
            return (
              <div key={t.id} className="glass-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={isBuy ? "default" : "destructive"}
                      className="text-[10px] px-2"
                    >
                      {isBuy ? "COMPRA" : "VENTA"}
                    </Badge>
                    <span className="font-bold text-base">{t.symbol?.replace("USDT", "")}</span>
                    <Badge variant="outline" className="text-[9px]">
                      {t.strategy === "grid" ? "Grid" : t.strategy === "scalping" ? "Scalping" : t.strategy}
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
        // Desktop: Table layout
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-secondary/30">
                  <th className="text-left p-3 font-medium text-muted-foreground">Símbolo</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Lado</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Precio</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Cantidad</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">PnL</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Estrategia</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t: any) => {
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
                          {t.strategy === "grid" ? "Grid" : t.strategy === "scalping" ? "Scalping" : t.strategy}
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
