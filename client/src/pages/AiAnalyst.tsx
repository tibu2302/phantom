import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, BarChart3, Shield, Sparkles, Globe } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Streamdown } from "streamdown";

const analysisTypes = [
  { type: "market_overview" as const, label: "Market Overview", icon: Globe, desc: "Overall market sentiment and key events" },
  { type: "asset_analysis" as const, label: "Asset Analysis", icon: BarChart3, desc: "Deep analysis of BTC, ETH, SP500" },
  { type: "risk_assessment" as const, label: "Risk Assessment", icon: Shield, desc: "Portfolio risk evaluation" },
  { type: "smart_opportunities" as const, label: "Smart Opportunities", icon: Sparkles, desc: "Top trading opportunities right now" },
];

export default function AiAnalyst() {
  const { data: history } = trpc.ai.history.useQuery();
  const analyzeMut = trpc.ai.analyze.useMutation({ onError: () => toast.error("Analysis failed") });
  const [activeResult, setActiveResult] = useState<{ content: string; sentiment: string; title: string } | null>(null);

  const handleAnalyze = async (type: "market_overview" | "asset_analysis" | "risk_assessment" | "smart_opportunities") => {
    const result = await analyzeMut.mutateAsync({ type });
    setActiveResult(result);
  };

  const sentimentColor = (s: string | null | undefined) => {
    if (s === "bullish") return "text-[oklch(0.72_0.19_160)] border-[oklch(0.72_0.19_160)]/30";
    if (s === "bearish") return "text-[oklch(0.63_0.24_25)] border-[oklch(0.63_0.24_25)]/30";
    return "text-[oklch(0.8_0.15_85)] border-[oklch(0.8_0.15_85)]/30";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Brain className="h-6 w-6 text-primary" /> AI Market Analyst</h1>
        <p className="text-sm text-muted-foreground mt-1">Powered by artificial intelligence</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {analysisTypes.map((a) => (
          <button key={a.type} onClick={() => handleAnalyze(a.type)} disabled={analyzeMut.isPending}
            className="glass-card p-5 text-left hover:border-primary/30 transition-all group disabled:opacity-50">
            <a.icon className="h-5 w-5 text-primary mb-3 group-hover:scale-110 transition-transform" />
            <p className="font-semibold text-sm">{a.label}</p>
            <p className="text-xs text-muted-foreground mt-1">{a.desc}</p>
          </button>
        ))}
      </div>

      {analyzeMut.isPending && (
        <div className="glass-card p-8 text-center">
          <Brain className="h-8 w-8 text-primary mx-auto animate-pulse mb-3" />
          <p className="text-sm text-muted-foreground">PHANTOM AI is analyzing the market...</p>
        </div>
      )}

      {activeResult && !analyzeMut.isPending && (
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{activeResult.title}</h3>
            <Badge variant="outline" className={sentimentColor(activeResult.sentiment)}>{(activeResult.sentiment ?? "neutral").toUpperCase()}</Badge>
          </div>
          <div className="prose prose-invert prose-sm max-w-none">
            <Streamdown>{activeResult.content}</Streamdown>
          </div>
        </div>
      )}

      {history && history.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-muted-foreground">Recent Analyses</h3>
          {history.map((h: any) => (
            <div key={h.id} className="glass-card p-4 cursor-pointer hover:border-primary/20 transition-all" onClick={() => setActiveResult({ content: h.content, sentiment: h.sentiment, title: h.title })}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{h.title}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`text-[10px] ${sentimentColor(h.sentiment)}`}>{(h.sentiment ?? "neutral").toUpperCase()}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
