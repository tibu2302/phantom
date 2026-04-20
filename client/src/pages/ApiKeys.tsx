import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Key, Shield, Trash2, CheckCircle, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export default function ApiKeys() {
  const { data: existing, isLoading } = trpc.apiKeys.get.useQuery();
  const utils = trpc.useUtils();
  const saveMut = trpc.apiKeys.save.useMutation({
    onSuccess: () => { utils.apiKeys.get.invalidate(); toast.success("API Keys saved"); setApiKey(""); setApiSecret(""); },
    onError: () => toast.error("Failed to save"),
  });
  const deleteMut = trpc.apiKeys.delete.useMutation({
    onSuccess: () => { utils.apiKeys.get.invalidate(); toast.success("API Keys deleted"); },
  });

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [label, setLabel] = useState("Bybit Main");

  if (isLoading) return <div className="space-y-4 animate-pulse"><div className="h-64 glass-card rounded-xl" /></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Key className="h-6 w-6 text-primary" /> API Keys</h1>
        <p className="text-sm text-muted-foreground mt-1">Connect your Bybit account securely</p>
      </div>

      {existing ? (
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold">Connected</p>
                <p className="text-xs text-muted-foreground">API Key: {existing.apiKey}</p>
              </div>
            </div>
            <Badge className="bg-primary/20 text-primary border-primary/30">Active</Badge>
          </div>
          <Button variant="destructive" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending} className="gap-2">
            <Trash2 className="h-4 w-4" /> Remove Keys
          </Button>
        </div>
      ) : (
        <div className="glass-card p-6 space-y-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-secondary/50 rounded-lg">
            <Shield className="h-4 w-4 text-primary shrink-0" />
            Your keys are encrypted and stored securely.
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Label</Label>
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Bybit Main" className="bg-secondary/50 border-border" />
            </div>
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Enter your Bybit API Key" className="bg-secondary/50 border-border font-mono" />
            </div>
            <div className="space-y-2">
              <Label>API Secret</Label>
              <div className="relative">
                <Input type={showSecret ? "text" : "password"} value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder="Enter your Bybit API Secret" className="bg-secondary/50 border-border font-mono pr-10" />
                <button onClick={() => setShowSecret(!showSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <Button onClick={() => saveMut.mutate({ apiKey, apiSecret, label })} disabled={!apiKey || !apiSecret || saveMut.isPending} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
            {saveMut.isPending ? "Saving..." : "Save API Keys"}
          </Button>
        </div>
      )}

      <div className="glass-card p-5 space-y-3">
        <h3 className="font-semibold text-sm">How to get your API Keys</h3>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Log in to your Bybit account</li>
          <li>Go to Account &rarr; API Management</li>
          <li>Click "Create New Key"</li>
          <li>Enable: Spot, Futures, Wallet permissions</li>
          <li>Copy the API Key and Secret here</li>
        </ol>
      </div>
    </div>
  );
}
