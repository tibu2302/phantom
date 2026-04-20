import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard, LogOut, PanelLeft, Zap, Brain, Sparkles,
  History, Key, Settings, Ghost, MoreHorizontal
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { trpc } from "@/lib/trpc";

// Bottom nav items (most used, max 5)
const bottomNavItems = [
  { icon: LayoutDashboard, label: "Panel", path: "/" },
  { icon: Zap, label: "Estrategias", path: "/strategies" },
  { icon: Sparkles, label: "Oportunidades", path: "/opportunities" },
  { icon: Brain, label: "Analista", path: "/ai-analyst" },
  { icon: MoreHorizontal, label: "Más", path: "__more__" },
];

const allMenuItems = [
  { icon: LayoutDashboard, label: "Panel", path: "/" },
  { icon: Zap, label: "Estrategias", path: "/strategies" },
  { icon: Brain, label: "Analista IA", path: "/ai-analyst" },
  { icon: Sparkles, label: "Oportunidades", path: "/opportunities" },
  { icon: History, label: "Historial", path: "/trades" },
  { icon: Key, label: "Claves API", path: "/api-keys" },
  { icon: Settings, label: "Ajustes", path: "/settings" },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-3">
              <Ghost className="h-10 w-10 text-primary" />
              <span className="text-3xl font-bold tracking-tight text-primary">PHANTOM</span>
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Trading Intelligence — Iniciá sesión para acceder a tu panel
            </p>
          </div>
          <Button
            onClick={() => {
              // En modo local (VPS), redirigir a la página de login propia
              // En modo Manus, redirigir al OAuth de Manus
              const isLocalMode = !import.meta.env.VITE_APP_ID;
              window.location.href = isLocalMode ? "/login" : getLoginUrl();
            }}
            size="lg"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg"
          >
            Iniciar sesión
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({ children, setSidebarWidth }: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = allMenuItems.find(item => item.path === location);
  const isMobile = useIsMobile();

  // Get unread notifications count for badge
  const statusQuery = trpc.bot.status.useQuery(undefined, {
    refetchInterval: 10000,
    retry: false,
  });
  const unread = statusQuery.data?.unreadNotifications ?? 0;

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const navigate = (path: string) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(10);
    }
    setLocation(path);
    setMoreOpen(false);
  };

  if (isMobile) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        {/* Mobile Top Header */}
        <header className="sticky top-0 z-50 flex items-center justify-between px-4 h-14 bg-background/95 backdrop-blur border-b border-border/50">
          <div className="flex items-center gap-2">
            <Ghost className="h-5 w-5 text-primary" />
            <span className="font-bold tracking-tight text-primary text-lg">PHANTOM</span>
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <span className="h-5 w-5 rounded-full bg-destructive text-[10px] font-bold flex items-center justify-center text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-accent/50 transition-colors focus:outline-none">
                  <Avatar className="h-7 w-7 border border-primary/20">
                    <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-3 py-2 border-b">
                  <p className="text-sm font-medium truncate">{user?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive mt-1">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Cerrar sesión</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto pb-20 px-3 py-4">
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t border-border/50 safe-area-bottom">
          <div className="flex items-stretch h-16">
            {bottomNavItems.map((item) => {
              if (item.path === "__more__") {
                return (
                  <DropdownMenu key="more" open={moreOpen} onOpenChange={setMoreOpen}>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors focus:outline-none relative"
                        onClick={() => {
                          if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
                        }}
                      >
                        <div className="relative">
                          <item.icon className={`h-5 w-5 text-muted-foreground`} />
                          {unread > 0 && (
                            <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-destructive text-[9px] font-bold flex items-center justify-center text-white">
                              {unread > 9 ? "9+" : unread}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground">Más</span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="top" className="w-52 mb-2">
                      {[
                        { icon: History, label: "Historial", path: "/trades" },
                        { icon: Key, label: "Claves API", path: "/api-keys" },
                        { icon: Settings, label: "Ajustes", path: "/settings" },
                      ].map((subItem) => (
                        <DropdownMenuItem
                          key={subItem.path}
                          onClick={() => navigate(subItem.path)}
                          className={`cursor-pointer gap-3 ${location === subItem.path ? "text-primary" : ""}`}
                        >
                          <subItem.icon className="h-4 w-4" />
                          {subItem.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              }

              const isActive = location === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors focus:outline-none"
                >
                  <item.icon className={`h-5 w-5 transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`text-[10px] transition-colors font-medium ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                    {item.label}
                  </span>
                  {isActive && (
                    <span className="absolute bottom-0 w-8 h-0.5 bg-primary rounded-t-full" />
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    );
  }

  // Desktop layout (unchanged)
  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed && (
                <div className="flex items-center gap-2 min-w-0">
                  <Ghost className="h-5 w-5 text-primary shrink-0" />
                  <span className="font-bold tracking-tight text-primary truncate">PHANTOM</span>
                </div>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {allMenuItems.map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className="h-10 transition-all font-normal"
                    >
                      <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none">
                  <Avatar className="h-9 w-9 border border-primary/20 shrink-0">
                    <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">{user?.name || "-"}</p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">{user?.email || "-"}</p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Cerrar sesión</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </>
  );
}
