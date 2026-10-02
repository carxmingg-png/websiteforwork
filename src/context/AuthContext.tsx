import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { setUnauthorizedHandler } from "@/lib/api-client";

type Role = "admin" | "user" | null;

const LS_TOKEN = "carx_token";
const LS_ROLE = "carx_role";

interface AuthState {
  role: Role;
  token: string | null;
  restoring: boolean;
  setAuth: (role: Role, token: string) => void;
  clearAuth: () => void;
}

const AuthContext = createContext<AuthState>({
  role: null,
  token: null,
  restoring: false,
  setAuth: () => {},
  clearAuth: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>(null);
  const [token, setToken] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearAuth = useCallback(() => {
    setRole(null);
    setToken(null);
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ROLE);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Register global 401 interceptor — fires on any API call returning 401
  useEffect(() => {
    setUnauthorizedHandler(() => {
      const storedRole = localStorage.getItem(LS_ROLE);
      if (storedRole === "user") {
        clearAuth();
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [clearAuth]);

  // Validate stored session on mount with strict timeout guarantee
  useEffect(() => {
    let isMounted = true;
    const storedToken = localStorage.getItem(LS_TOKEN);
    const storedRole = localStorage.getItem(LS_ROLE) as Role;

    if (!storedToken || !storedRole) {
      setRestoring(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      if (isMounted) setRestoring(false);
    }, 3000);

    fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: storedToken }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d: { role?: string; token?: string }) => {
        if (!isMounted) return;
        if (d.role && d.token) {
          setRole(d.role as Role);
          setToken(d.token);
        } else {
          localStorage.removeItem(LS_TOKEN);
          localStorage.removeItem(LS_ROLE);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        // On network failure or abort, keep stored session if offline, or safely reset
        if (storedRole && storedToken) {
          setRole(storedRole);
          setToken(storedToken);
        }
      })
      .finally(() => {
        clearTimeout(timer);
        if (isMounted) setRestoring(false);
      });

    return () => {
      isMounted = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  // Periodic session check every 60 seconds for user sessions
  useEffect(() => {
    if (role !== "user" || !token) return;

    const check = () => {
      fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
        .then((r) => {
          if (!r.ok) clearAuth();
          return r.json();
        })
        .then((d: { role?: string }) => {
          if (!d.role) clearAuth();
        })
        .catch(() => {
          // Network error — don't logout, could be temporary
        });
    };

    pollRef.current = setInterval(check, 60_000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [role, token, clearAuth]);

  const setAuth = (r: Role, t: string) => {
    setRole(r);
    setToken(t);
    localStorage.setItem(LS_TOKEN, t);
    localStorage.setItem(LS_ROLE, r ?? "");
  };

  return (
    <AuthContext.Provider value={{ role, token, restoring, setAuth, clearAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
