import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import LockScreen from "@/pages/lock-screen";
import AdminPanel from "@/pages/admin-panel";
import InjectSite from "@/pages/inject-site";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught application error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#05060a] text-zinc-100 flex items-center justify-center p-6 select-none">
          <div className="cyber-card rounded-3xl p-8 max-w-md w-full border border-amber-500/40 text-center shadow-2xl space-y-4">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-xl font-gaming font-bold text-amber-400">SYSTEM RECOVERY</h2>
            <p className="text-xs font-chakra text-zinc-400">
              An unexpected render glitch occurred. Click below to clear cache and restart the panel.
            </p>
            <button
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              className="w-full py-3.5 rounded-2xl bg-amber-500 text-black font-gaming font-bold text-xs uppercase tracking-wider hover:bg-amber-400 transition-all cursor-pointer shadow-[0_0_20px_rgba(245,158,11,0.4)]"
            >
              🔄 RESET & RESTART
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppRouter() {
  const { role, token, restoring } = useAuth();

  if (restoring) {
    return (
      <div className="min-h-screen bg-[#05060a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin shadow-[0_0_25px_rgba(245,158,11,0.5)]" />
          <p className="text-zinc-500 text-xs font-gaming tracking-widest uppercase animate-pulse">
            LOADING CARX STREET TOOL...
          </p>
        </div>
      </div>
    );
  }

  if (role === "admin") {
    return <AdminPanel />;
  }

  if (role === "user" || token) {
    return <InjectSite />;
  }

  return <LockScreen />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}