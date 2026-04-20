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
const ApiKeys = lazy(() => import("./pages/ApiKeys"));
const AiAnalyst = lazy(() => import("./pages/AiAnalyst"));
const Opportunities = lazy(() => import("./pages/Opportunities"));
const Trades = lazy(() => import("./pages/Trades"));
const Strategies = lazy(() => import("./pages/Strategies"));
const Settings = lazy(() => import("./pages/Settings"));

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
          <Route path="/strategies" component={Strategies} />
          <Route path="/ai-analyst" component={AiAnalyst} />
          <Route path="/opportunities" component={Opportunities} />
          <Route path="/trades" component={Trades} />
          <Route path="/api-keys" component={ApiKeys} />
          <Route path="/settings" component={Settings} />
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
