import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import { lazy, Suspense } from "react";
import { Ghost } from "lucide-react";

const Home = lazy(() => import("./pages/Home"));
const ApiKeysPage = lazy(() => import("./pages/ApiKeys"));
const AiAnalystPage = lazy(() => import("./pages/AiAnalyst"));
const OpportunitiesPage = lazy(() => import("./pages/Opportunities"));
const TradesPage = lazy(() => import("./pages/Trades"));
const StrategiesPage = lazy(() => import("./pages/Strategies"));
const SettingsPage = lazy(() => import("./pages/Settings"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Ghost className="h-8 w-8 text-primary animate-pulse" />
    </div>
  );
}

function Router() {
  return (
    <DashboardLayout>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/api-keys" component={ApiKeysPage} />
          <Route path="/ai-analyst" component={AiAnalystPage} />
          <Route path="/opportunities" component={OpportunitiesPage} />
          <Route path="/trades" component={TradesPage} />
          <Route path="/strategies" component={StrategiesPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/404" component={NotFound} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
