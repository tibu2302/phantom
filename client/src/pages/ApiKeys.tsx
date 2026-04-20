import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Key, Shield, Eye, EyeOff, Trash2, CheckCircle, Lock, Fingerprint, Ghost } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ApiKeysPage() {
  const utils = trpc.useUtils();
  const { data: existingKey, isLoading } = trpc.apiKeys.get.useQuery();
  const saveKey = trpc.apiKeys.save.useMutation({
    onSuccess: () => { utils.apiKeys.get.invalidate(); toast.success("API Keys saved securely"); setApiKey(""); setApiSecret(""); },
    onError: () => toast.error("Failed to save API Keys"),
  });
  const deleteKey = trpc.apiKeys.delete.useMutation({
    onSuccess: () => { utils.apiKeys.get.invalidate(); toast.success("API Keys removed"); },
  });

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [label, setLabel] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Ghost className="h-8 w-8 text-primary animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Key className="h-5 w-5 text-primary" /> API Keys
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Configure your Bybit API credentials to enable automated trading.</p>
      </div>

      {existingKey ? (
        <div className="glass rounded-xl p-5 border-emerald-500/10 glow-gain">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-400" />
              <span className="font-semibold">Connected</span>
            </div>
            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] tracking-wider" variant="outline">
              ACTIVE
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-4 p-4 rounded-lg bg-secondary/30 mb-4">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Exchange</p>
              <p className="text-sm font-semibold mt-0.5">{existingKey.exchange}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">API Key</p>
              <p className="text-sm font-mono mt-0.5">{existingKey.apiKey}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Secret</p>
              <p className="text-sm font-mono mt-0.5 text-muted-foreground">********</p>
            </div>
          </div>
          {existingKey.label && <p className="text-xs text-muted-foreground mb-3">Label: {existingKey.label}</p>}
          <Button variant="destructive" size="sm" onClick={() => deleteKey.mutate()} disabled={deleteKey.isPending} className="shadow-lg shadow-red-600/10">
            <Trash2 className="h-3 w-3 mr-1.5" /> Remove Keys
          </Button>
        </div>
      ) : (
        <div className="glass rounded-xl p-6 gradient-border">
          <div className="flex items-center gap-2 mb-1">
            <Fingerprint className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Add Bybit API Keys</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-5">Enter your Bybit API credentials. They are stored encrypted in the database.</p>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="label" className="text-xs">Label (optional)</Label>
              <Input id="label" placeholder="e.g. PHANTOM Bot" value={label} onChange={(e) => setLabel(e.target.value)} className="bg-secondary/50 border-border/50 h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apiKey" className="text-xs">API Key</Label>
              <Input id="apiKey" placeholder="Enter your Bybit API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="font-mono bg-secondary/50 border-border/50 h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apiSecret" className="text-xs">API Secret</Label>
              <div className="relative">
                <Input id="apiSecret" type={showSecret ? "text" : "password"} placeholder="Enter your Bybit API Secret" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} className="font-mono pr-10 bg-secondary/50 border-border/50 h-10" />
                <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button
              onClick={() => saveKey.mutate({ apiKey, apiSecret, label: label || undefined })}
              disabled={!apiKey || !apiSecret || saveKey.isPending}
              className="w-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 h-10"
            >
              <Lock className="h-3.5 w-3.5 mr-1.5" />
              {saveKey.isPending ? "Encrypting & Saving..." : "Save API Keys"}
            </Button>
          </div>
        </div>
      )}

      <div className="glass rounded-xl p-5">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <Shield className="h-4 w-4 text-primary" /> Security Best Practices
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { icon: "🔒", text: "Enable IP whitelist on Bybit" },
            { icon: "🛡️", text: "Grant minimum required permissions" },
            { icon: "🔄", text: "Regenerate keys periodically" },
            { icon: "🤫", text: "Never share your API Secret" },
          ].map((tip) => (
            <div key={tip.text} className="flex items-start gap-2.5 p-3 rounded-lg bg-secondary/30">
              <span className="text-sm">{tip.icon}</span>
              <span className="text-xs text-muted-foreground">{tip.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
