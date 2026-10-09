import { useQuery, useMutation } from "@tanstack/react-query";

async function fetchApi(url: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  try {
    const dt = localStorage.getItem("carx_device_token");
    if (dt && !headers["x-device-token"]) {
      headers["x-device-token"] = dt;
    }
  } catch {}

  // Try to extract auth token from request body (POST/PUT)
  if (options.body && typeof options.body === "string" && !headers["Authorization"]) {
    try {
      const parsed = JSON.parse(options.body);
      const token = parsed.userToken || parsed.adminToken || parsed.token || parsed.sessionToken;
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    } catch { /* ignore */ }
  }

  // Also try to extract auth token from URL query params (GET requests)
  if (!headers["Authorization"]) {
    try {
      const urlObj = new URL(url, window.location.origin);
      const token = urlObj.searchParams.get("adminToken") || urlObj.searchParams.get("userToken") || urlObj.searchParams.get("token");
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    } catch { /* ignore */ }
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw { response: { data } };
  }
  return data;
}

export const CurrencyInputPreset = {
  max: "max",
  safe: "safe",
  custom: "custom",
} as const;
export type CurrencyInputPreset = "max" | "safe" | "custom";

export const CarsInjectInputMode = {
  all: "all",
  missing: "missing",
  select: "select",
} as const;
export type CarsInjectInputMode = "all" | "missing" | "select";

export const GenerateKeyInputDuration = {
  "1h": "1h",
  "1d": "1d",
  "7d": "7d",
  "30d": "30d",
  unlimited: "unlimited",
} as const;
export type GenerateKeyInputDuration = "1h" | "1d" | "7d" | "30d" | "unlimited";

export function setUnauthorizedHandler(_fn: any) {}

export function getListKeysQueryKey() { return ["/api/admin/keys"]; }
export function getGetStringsQueryKey() { return ["/api/admin/strings"]; }
export function getGetCarsQueryKey() { return ["/api/cars"]; }

export function useVerifyKey(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: { key: string; deviceToken?: string; deviceId?: string } }) =>
      fetchApi("/api/auth/verify", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useCheckBan(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/check-ban", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useLoginCarX(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/login", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useRegisterCarX(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/register", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useDeleteCarX(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/delete", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useRebuildBannedAccount(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/rebuild-banned", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useGetSavedCredentials(options?: any) {
  return useQuery({
    queryKey: ["/api/carx/saved-credentials"],
    queryFn: () => fetchApi("/api/carx/saved-credentials"),
    ...(options?.query || {}),
  });
}

export function useSaveCredentials(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/saved-credentials", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useGetProfile(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/profile", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useInjectCurrency(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useUnlockMaps(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useUnlockMapsHouses(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useUnlockClubs(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useUnlockProfileStyle(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useInjectCars(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useUnlockStreetPass(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useInjectAll(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useSafeRepair(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useCleanRewriteAccount(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useUnlockNeon(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useUnlockTireWalls(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useUnlockNumberPlates(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useUnlockWheelRims(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/carx/inject", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useGetCars(params?: any, options?: any) {
  return useQuery({
    queryKey: getGetCarsQueryKey(),
    queryFn: () => fetchApi("/api/cars"),
    ...(options?.query || {}),
  });
}

export function useListKeys(params?: { adminToken?: string }, options?: any) {
  const token = params?.adminToken || "";
  return useQuery({
    queryKey: [...getListKeysQueryKey(), token],
    queryFn: async () => {
      const data = await fetchApi(`/api/admin/keys?adminToken=${encodeURIComponent(token)}`);
      // Server returns { success, keys: {}, ... } — convert keys object to array for the UI
      if (data && data.keys && typeof data.keys === "object" && !Array.isArray(data.keys)) {
        return Object.entries(data.keys).map(([key, val]: [string, any]) => ({ key, ...val }));
      }
      if (Array.isArray(data)) return data;
      return [];
    },
    ...(options?.query || {}),
  });
}

export function useGenerateKey(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/admin/generate-key", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useRevokeKey(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/admin/delete-key", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useUpdateKey(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/admin/update-key", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}

export function useGetStrings(params?: { adminToken?: string }, options?: any) {
  const token = params?.adminToken || "";
  return useQuery({
    queryKey: [...getGetStringsQueryKey(), token],
    queryFn: () => fetchApi(`/api/admin/strings?adminToken=${encodeURIComponent(token)}`),
    ...(options?.query || {}),
  });
}

export function useUpdateStrings(options?: any) {
  return useMutation({
    mutationFn: (vars: { data: any }) =>
      fetchApi("/api/admin/strings", { method: "POST", body: JSON.stringify(vars.data) }),
    ...(options?.mutation || {}),
  });
}
