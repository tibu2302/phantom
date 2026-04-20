import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, TrendingUp, TrendingDown, Minus, BarChart3, Shield, Sparkles, Ghost } from "lucide-react";
import { useState } from "react";
import { Streamdown } from "streamdown";

export default function AiAnalystPage() {
  const { data: analyses, isLoading } = trpc.ai.analyses.useQuery({ limit: 20 }, { refetchInterval: 30000 });
  const analyze = trpc.ai.analyze.useMutation();
  const [activeAnalysis, setActiveAnalysis] = useState<{ content: string; sentiment: string; title: string } | null>(null);

  const analysisTypes = [
    { type: "market_overview" as const, label: "Market Overview", icon: BarChart3, desc: "Overall market sentiment and trends", gradient: "from-blue-500/10 to-cyan-500/5" },
    { type: "coin_analysis" as const, label: "Asset Analysis", icon: TrendingUp, desc: "Deep analysis of BTC, ETH, SP500", gradient: "from-emerald-500/10 to-green-500/5" },
    { type: "risk_assessment" as const, label: "Risk Assessment", icon: Shield, desc: "Portfolio risk evaluation", gradient: "from-amber-500/10 to-orange-500/5" },
    { type: "opportunity" as const, label: "Smart Opportunities", icon: Sparkles, desc: "Top trading opportunities now", gradient: "from-purple-500/10 to-pink-500/5" },
  ];

  const handleAnalyze = async (type: "market_overview" | "coin_analysis" | "risk_assessment" | "opportunity") => {
    const result = await analyze.mutateAsync({ type });
    setActiveAnalysis(result);
  };

  const sentimentIcon = (s: string) => {
    if (s === "bullish") return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />;
    if (s === "bearish") return <TrendingDown className="h-3.5 w-3.5 text-red-400" />;
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  const sentimentColor = (s: string) => {
    if (s === "bullish") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    if (s === "bearish") return "bg-red-500/15 text-red-400 border-red-500/30";
    return "bg-secondary text-muted-foreground border-border/50";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" /> AI Market Analyst
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Powered by artificial intelligence. Get real-time market analysis and recommendations.</p>
      </div>

      {/* Analysis Type Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {analysisTypes.map((at) => (
          <button
            key={at.type}
            onClick={() => handleAnalyze(at.type)}
            disabled={analyze.isPending}
            className={`glass rounded-xl p-4 text-left hover:bg-white/[0.04] transition-all group relative overflow-hidden disabled:opacity-50`}
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${at.gradient} opacity-0 group-hover:opacity-100 transition-opacity`} />
            <div className="relative">
              <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/10 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                <at.icon className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-semibold mb-0.5">{at.label}</p>
              <p className="text-[11px] text-muted-foreground">{at.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Loading State */}
      {analyze.isPending && (
        <div className="glass rounded-xl p-12 text-center gradient-border">
          <div className="relative inline-block mb-4">
            <Brain className="h-10 w-10 text-primary animate-pulse" />
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
          </div>
          <p className="text-sm text-muted-foreground">PHANTOM AI is analyzing the market...</p>
          <div className="flex justify-center gap-1 mt-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      )}

      {/* Active Analysis Result */}
      {activeAnalysis && !analyze.isPending && (
        <div className="glass rounded-xl overflow-hidden gradient-border">
          <div className="p-4 border-b border-border/30 flex items-center justify-between">
            <h3 className="font-semibold text-sm">{activeAnalysis.title}</h3>
            <Badge variant="outline" className={`text-[10px] tracking-wider ${sentimentColor(activeAnalysis.sentiment)}`}>
              {sentimentIcon(activeAnalysis.sentiment)}
              <span className="ml-1 capitalize">{activeAnalysis.sentiment}</span>
            </Badge>
          </div>
          <div className="p-5 prose prose-invert prose-sm max-w-none">
            <Streamdown>{activeAnalysis.content}</Streamdown>
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Analysis History</h2>
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Ghost className="h-6 w-6 text-primary animate-pulse" />
          </div>
        ) : (!analyses || analyses.length === 0) ? (
          <div className="glass rounded-xl p-8 text-center">
            <Brain className="h-10 w-10 mx-auto mb-3 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">No analyses yet. Click a card above to start.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {analyses.map((a) => (
              <button
                key={a.id}
                className="w-full glass rounded-lg p-3.5 text-left hover:bg-white/[0.03] transition-all"
                onClick={() => setActiveAnalysis({ content: a.content, sentiment: a.sentiment || "neutral", title: a.title })}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {sentimentIcon(a.sentiment || "neutral")}
                    <div>
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="text-[11px] text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-[9px] tracking-wider ${sentimentColor(a.sentiment || "neutral")}`}>
                    {(a.sentiment || "neutral").toUpperCase()}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
