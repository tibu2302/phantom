import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import { lazy, Suspense, useState, useCallback } from "react";
import SplashScreen from "./components/SplashScreen";

const Home = lazy(() => import("./pages/Home"));
const ApiKeys = lazy(() => import("./pages/ApiKeys"));
const AiAnalyst = lazy(() => import("./pages/AiAnalyst"));
const Opportunities = lazy(() => import("./pages/Opportunities"));
const Trades = lazy(() => import("./pages/Trades"));
const Strategies = lazy(() => import("./pages/Strategies"));
const Settings = lazy(() => import("./pages/Settings"));
// Página de login local para despliegue en VPS propio (AUTH_MODE=local)
const LocalLogin = lazy(() => import("./pages/LocalLogin"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <img src="/manus-storage/phantom-logo_69adf5bb.png" alt="Loading" className="h-8 w-8 animate-pulse rounded-md" />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      {/* Ruta de login local — fuera del DashboardLayout para no requerir auth */}
      <Route path="/login">
        <Suspense fallback={<PageLoader />}>
          <LocalLogin />
        </Suspense>
      </Route>
      {/* Resto de rutas protegidas dentro del DashboardLayout */}
      <Route>
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
      </Route>
    </Switch>
  );
}

function App() {
  const [showSplash, setShowSplash] = useState(() => {
    // Only show splash once per session
    if (sessionStorage.getItem("phantom-splash-shown")) return false;
    return true;
  });

  const handleSplashFinish = useCallback(() => {
    sessionStorage.setItem("phantom-splash-shown", "1");
    setShowSplash(false);
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          {showSplash && <SplashScreen onFinish={handleSplashFinish} />}
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
