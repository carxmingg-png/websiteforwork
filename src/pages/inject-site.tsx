import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useLoginCarX,
  useRegisterCarX,
  useDeleteCarX,
  useRebuildBannedAccount,
  useGetSavedCredentials,
  useSaveCredentials,
  useGetProfile,
  useInjectCurrency,
  useUnlockMaps,
  useUnlockMapsHouses,
  useUnlockClubs,
  useInjectCars,
  useUnlockStreetPass,
  useUnlockProfileStyle,
  useUnlockNeon,
  useUnlockTireWalls,
  useUnlockNumberPlates,
  useUnlockWheelRims,
  useInjectAll,
  useSafeRepair,
  useCleanRewriteAccount,
  useGetCars,
  getGetCarsQueryKey,
  useCheckBan,
} from "@/lib/api-client";
import { CurrencyInputPreset, CarsInjectInputMode } from "@/lib/api-client";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  LogOut, DollarSign, Map, Car, Star, Zap, Trophy,
  User, UserPlus, Eye, EyeOff, RefreshCw, CheckCircle2, AlertCircle, Users,
  Trash2, ShieldAlert, ShieldCheck, Copy, Check, Bookmark, Wrench,
  Sparkles, Disc, Hash, Palette, Layers
} from "lucide-react";

interface CarXSession {
  token: string;
  carxId: string;
  email: string;
  password?: string;
  deviceId?: string;
  uniqueId?: string;
}

interface ProfileStats {
  silver: number;
  gold: number;
  xp: number;
  level: number;
  cars: number;
  clubs_count: number;
  real_estates_count: number;
  maps_count?: number;
  unlocked_maps?: string[];
  current_car: string;
  current_car_id?: string;
  streetPass: boolean;
  premium: boolean;
  isVerified: boolean;
  isBanned?: boolean;
  banReason?: string;
  name?: string;
  avatars_count?: number;
  frames_count?: number;
  banners_count?: number;
  neons_count?: number;
  neons_total?: number;
  neons_approved?: boolean;
  tire_walls_count?: number;
  tire_walls_total?: number;
  tire_walls_approved?: boolean;
  plates_count?: number;
  plates_total?: number;
  plates_approved?: boolean;
  rims_count?: number;
  rims_total?: number;
  rims_approved?: boolean;
  profile_styles_approved?: boolean;
  maps_approved?: boolean;
  houses_approved?: boolean;
  cars_list?: Array<{ id: string; descId: string; mileage?: number; rating?: number }>;
}

function StatBadge({ label, value, icon, accent, extraBtn }: { label: string; value: string | number; icon: string; accent?: string; extraBtn?: React.ReactNode }) {
  return (
    <div className={`cyber-card rounded-2xl p-3.5 flex flex-col justify-between transition-all hover:scale-[1.02] duration-200 border ${accent || "border-zinc-800"}`}>
      <div className="flex items-center justify-between">
        <span className="text-xl filter drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">{icon}</span>
        {extraBtn}
      </div>
      <div className="mt-2.5">
        <div className="text-base sm:text-lg font-mono font-black text-white truncate tracking-tight">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        <div className="text-[10px] font-chakra font-bold text-zinc-400 uppercase tracking-widest mt-0.5 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 animate-pulse" />
          {label}
        </div>
      </div>
    </div>
  );
}

function NumInput({
  label,
  value,
  onChange,
  min,
  max,
  placeholder,
  icon,
  accent,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  icon: string;
  accent: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className={`text-xs font-chakra font-bold ${accent} flex items-center gap-1.5 uppercase tracking-wider`}>
        <span>{icon}</span> {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        placeholder={placeholder}
        className="w-full bg-zinc-900/90 border border-zinc-700/80 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-400 focus:shadow-[0_0_15px_rgba(245,158,11,0.2)] transition-all font-mono"
      />
    </div>
  );
}

function Toggle({ label, checked, onChange, accent }: { label: string; checked: boolean; onChange: (v: boolean) => void; accent: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl border transition-all cursor-pointer font-chakra ${checked ? `${accent} border-opacity-50 shadow-[0_0_15px_rgba(255,255,255,0.05)]` : "bg-zinc-900/70 border-zinc-800 text-zinc-400 hover:border-zinc-700"}`}
    >
      <span className="text-xs font-bold text-white flex items-center gap-1.5">{label}</span>
      <div className={`w-9 h-5 rounded-full transition-all relative ${checked ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-zinc-700"}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? "left-4" : "left-0.5"}`} />
      </div>
    </button>
  );
}

function BatchField({ label, value, onChange, placeholder, icon, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; icon: string; type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-chakra font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
        <span>{icon}</span>{label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-900/90 border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/80 focus:shadow-[0_0_15px_rgba(16,185,129,0.2)] transition-all font-mono"
      />
    </div>
  );
}

function BatchForm({ userToken }: { userToken: string }) {
  const { toast } = useToast();
  const savedCredsQuery = useGetSavedCredentials();
  const [count, setCount] = useState("5");
  const [password, setPassword] = useState("CARXMING");

  useEffect(() => {
    if (savedCredsQuery.data?.credentials?.default_password) {
      setPassword(savedCredsQuery.data.credentials.default_password);
    }
  }, [savedCredsQuery.data]);

  const [silver, setSilver] = useState("1000");
  const [gold, setGold] = useState("1000");
  const [xp, setXp] = useState("100");
  const [carsMode, setCarsMode] = useState("all");
  const [carCount, setCarCount] = useState("50");
  const [includeMaps, setIncludeMaps] = useState(true);
  const [includeStreetPass, setIncludeStreetPass] = useState(true);
  const [includeClubs, setIncludeClubs] = useState(true);
  const [includeProfileStyle, setIncludeProfileStyle] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<{ email: string; password?: string; status: string; message?: string }[]>([]);

  const carsQuery = useGetCars({ userToken }, { query: { queryKey: getGetCarsQueryKey({ userToken }), enabled: true } });
  const totalCars = carsQuery.data?.total || 0;

  const CAR_MODES = [
    { v: "all", l: "All Fleet", sub: `${totalCars || "?"} cars` },
    { v: "first50", l: "First 50", sub: "50 cars" },
    { v: "random10", l: "Random 10", sub: "10 cars" },
    { v: "custom", l: "Custom", sub: "set count" },
  ];

  const handleBatch = async () => {
    const n = Math.min(Math.max(Number(count) || 1, 1), 30);
    setRunning(true);
    setResults([]);
    setLogs(["⚙️ [PROTOCOL]: Launching High-Speed Batch Generation..."]);
    setProgress(0);

    try {
      const body = {
        count: n,
        password: password || "CARXMING",
        cash: Number(silver) || 1000,
        gold: Number(gold) || 1000,
        exp: Number(xp) || 100,
        get_all_cars: carsMode === "all" || carsMode === "first50" || carsMode === "random10" || (carsMode === "custom" && Number(carCount) > 0),
        unlock_all: includeMaps,
        unlock_clubs: includeClubs,
        unlock_profile_style: includeProfileStyle,
        inject_bp: includeStreetPass,
        verify: false,
      };

      const res = await fetch("/api/carx/bulk-generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok || !data.jobId) {
        toast({ title: "Bulk Failed", description: data.message || "Failed to start bulk generation", variant: "destructive" });
        setLogs((l) => [...l, `❌ Error: ${data.message || "Request failed"}`]);
        setRunning(false);
        return;
      }

      const jobId = data.jobId;
      setLogs((l) => [...l, `✅ Batch Thread Initialized! Job #${jobId}`]);

      // Poll status every 1 second
      const interval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/carx/bulk-status/${jobId}`, {
            headers: { Authorization: `Bearer ${userToken}` },
          });
          const statusData = await statusRes.json();
          if (statusData.success && statusData.job) {
            const job = statusData.job;
            setProgress(job.progress || 0);
            if (job.logs) setLogs(job.logs);
            if (job.results) setResults(job.results);

            if (job.status === "completed" || job.status === "cancelled") {
              clearInterval(interval);
              setRunning(false);
              const okCount = (job.results || []).filter((r: any) => r.status === "success").length;
              toast({ title: "Batch Completed!", description: `${okCount}/${n} accounts generated successfully` });
            }
          }
        } catch {
          // ignore poll error
        }
      }, 1000);
    } catch (err: any) {
      toast({ title: "Bulk Failed", description: err.message || "Network error", variant: "destructive" });
      setRunning(false);
    }
  };

  return (
    <div className="cyber-card rounded-3xl p-6 space-y-4 border border-zinc-800">
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚡</span>
          <div>
            <h3 className="text-xs font-gaming font-bold text-white tracking-widest uppercase">
              BATCH DRIVER FACTORY
            </h3>
            <p className="text-[10px] font-chakra text-zinc-400">
              High-throughput parallel account generation & instant blueprint setup
            </p>
          </div>
        </div>
        <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
          PARALLEL ENGINE
        </span>
      </div>

      {/* Row 1: count + password */}
      <div className="grid grid-cols-2 gap-3">
        <BatchField label="Accounts Count (max 30)" value={count} onChange={setCount} placeholder="5" icon="👥" type="number" />
        <BatchField label="Default Password" value={password} onChange={setPassword} placeholder="CARXMING" icon="🔑" />
      </div>

      {/* Row 2: Currency */}
      <div>
        <p className="text-[10px] font-chakra font-bold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <span>💰</span> Starting Currency Engine
        </p>
        <div className="grid grid-cols-3 gap-2">
          <BatchField label="Silver Cash" value={silver} onChange={setSilver} placeholder="1000" icon="🪙" type="number" />
          <BatchField label="Gold Coins" value={gold} onChange={setGold} placeholder="1000" icon="💎" type="number" />
          <BatchField label="EXP Points" value={xp} onChange={setXp} placeholder="100" icon="⚡" type="number" />
        </div>
      </div>

      {/* Row 3: Cars mode */}
      <div>
        <p className="text-[10px] font-chakra font-bold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <span>🚗</span> Garage Vehicle Package
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          {CAR_MODES.map(({ v, l, sub }) => (
            <button
              key={v}
              onClick={() => setCarsMode(v)}
              className={`flex flex-col items-center py-2 px-1 rounded-xl text-center transition-all border cursor-pointer ${
                carsMode === v ? "bg-purple-600 border-purple-400 text-white shadow-[0_0_15px_rgba(168,85,247,0.3)] font-bold" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              <span className="text-xs font-chakra">{l}</span>
              <span className={`text-[9px] font-mono mt-0.5 ${carsMode === v ? "text-purple-200" : "text-zinc-500"}`}>{sub}</span>
            </button>
          ))}
        </div>
        <AnimatePresence>
          {carsMode === "custom" && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mt-2">
              <BatchField label="Exact Car Count" value={carCount} onChange={setCarCount} placeholder="50" icon="🔢" type="number" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Row 4: Toggles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Toggle label="🗺️ Unlock All 6 Maps" checked={includeMaps} onChange={setIncludeMaps} accent="bg-cyan-500/10 border-cyan-500 text-cyan-300" />
        <Toggle label="🏆 Unlock 52 Houses & 22 Clubs" checked={includeClubs} onChange={setIncludeClubs} accent="bg-purple-500/10 border-purple-500 text-purple-300" />
        <Toggle label="🎟️ Street Pass (⚠️ High Ban Risk)" checked={includeStreetPass} onChange={setIncludeStreetPass} accent="bg-yellow-500/10 border-yellow-500 text-yellow-300" />
        <Toggle label="🎨 20 Avatars, Frames & Banners" checked={includeProfileStyle} onChange={setIncludeProfileStyle} accent="bg-pink-500/10 border-pink-500 text-pink-300" />
      </div>

      <button
        onClick={handleBatch}
        disabled={running}
        className="w-full py-3.5 rounded-xl font-gaming font-bold text-xs tracking-widest uppercase bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-500 text-white hover:from-emerald-500 hover:to-teal-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_0_25px_rgba(16,185,129,0.3)] hover:shadow-[0_0_35px_rgba(16,185,129,0.5)] cursor-pointer"
      >
        {running ? (
          <span className="flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" />
            FABRICATING {count} DRIVERS ({progress}%)...
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <Users className="w-4 h-4" />
            INITIALIZE {count || "?"} BATCH ACCOUNTS
          </span>
        )}
      </button>

      {/* Live Console Logs */}
      {logs.length > 0 && (
        <div className="bg-black/90 border border-emerald-500/30 rounded-xl p-3 font-mono text-xs max-h-40 overflow-y-auto space-y-1 shadow-inner">
          <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            TELEMETRY BATCH STREAM
          </p>
          {logs.map((log, i) => (
            <div key={i} className="text-zinc-300 text-[11px] leading-relaxed">{log}</div>
          ))}
        </div>
      )}

      {/* Results List */}
      {results.length > 0 && (
        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
          <p className="text-[10px] font-chakra font-bold text-zinc-400 uppercase tracking-widest mb-1">
            Accounts Generated — {results.filter(r => r.status === "success").length}/{results.length} Ready
          </p>
          {results.map((r, i) => (
            <div key={i} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border ${r.status === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-red-500/10 border-red-500/30 text-red-300"}`}>
              {r.status === "success" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
              <span className="font-mono flex-1 truncate select-all">{r.email}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(r.email);
                  toast({ title: "Copied Email", description: r.email });
                }}
                className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Copy Email"
              >
                <Copy className="w-3 h-3" />
              </button>
              {r.password && <span className="font-mono text-zinc-400 text-[10px]">{r.password}</span>}
              {r.message && <span className="text-red-400 text-[10px]">{r.message}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LoginForm({ userToken, onSuccess }: { userToken: string; onSuccess: (s: CarXSession) => void }) {
  const [mode, setMode] = useState<"login" | "register" | "rebuild" | "delete" | "bulk">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [rebuildStatus, setRebuildStatus] = useState<string[]>([]);
  const { toast } = useToast();

  const savedCredsQuery = useGetSavedCredentials();
  const saveCredsMutation = useSaveCredentials();

  useEffect(() => {
    if (savedCredsQuery.data?.credentials?.default_password && !password) {
      setPassword(savedCredsQuery.data.credentials.default_password);
    }
  }, [savedCredsQuery.data]);

  const login = useLoginCarX({
    mutation: {
      onSuccess: (d) => {
        if (d.isBanned || d.profileStats?.isBanned) {
          toast({
            title: "🚨 Ban Detected on Account!",
            description: d.banReason || d.profileStats?.banReason || "CarX anti-cheat flagged this account as banned or restricted.",
            variant: "destructive"
          });
        }
        onSuccess({
          token: d.token || "",
          carxId: d.userId || d.user_id || "",
          email: d.email || email,
          password: password,
          deviceId: d.deviceId || "",
          uniqueId: d.uniqueId || "",
          profileStats: d.profileStats
        });
      },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.message || (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: "Login Failed", description: msg || "Invalid credentials", variant: "destructive" });
      },
    },
  });

  const register = useRegisterCarX({
    mutation: {
      onSuccess: (d) => {
        if (d.success === false || !d.token) {
          toast({ title: "Registration Failed", description: d.message || "Failed to create account.", variant: "destructive" });
          return;
        }
        if (d.isBanned || d.profileStats?.isBanned) {
          toast({
            title: "🚨 Ban Detected on Account!",
            description: d.banReason || d.profileStats?.banReason || "CarX anti-cheat flagged this account as banned.",
            variant: "destructive"
          });
        } else {
          toast({ title: "Driver Account Initialized! 🏎️", description: "Starter blueprint applied successfully." });
        }
        onSuccess({
          token: d.token || "",
          carxId: d.userId || d.user_id || "",
          email: d.email || email,
          password: password,
          deviceId: d.deviceId || "",
          uniqueId: d.uniqueId || "",
          profileStats: d.profileStats
        });
      },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: "Registration Failed", description: msg || "Try a different email", variant: "destructive" });
      },
    },
  });

  const deleteAcc = useDeleteCarX({
    mutation: {
      onSuccess: (d) => {
        if (d.success) {
          toast({ title: "Account Purged! 🗑️", description: d.message || "CarX account has been completely wiped from server." });
          setPassword("");
        } else {
          toast({ title: "Delete Failed", description: d.message || "Could not delete account. Check credentials.", variant: "destructive" });
        }
      },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.message || (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: "Delete Failed", description: msg || "Failed to delete account", variant: "destructive" });
      }
    }
  });

  const rebuildAcc = useRebuildBannedAccount({
    mutation: {
      onSuccess: (d) => {
        if (d.success) {
          toast({
            title: "Rebuild Completed! 🔄",
            description: d.message || "Account cloned and rebuilt fresh on CarX cluster!"
          });
          if (d.stepsCompleted) {
            setRebuildStatus(d.stepsCompleted);
          }
          if (d.token) {
            onSuccess({
              token: d.token,
              carxId: d.carxId || "",
              email: email,
              password: password,
            });
          }
        } else {
          toast({
            title: "Rebuild Notice",
            description: d.message || "Rebuild sequence encountered an issue. Profile backup preserved on server.",
            variant: "destructive"
          });
          if (d.stepsCompleted) {
            setRebuildStatus(d.stepsCompleted);
          }
        }
      },
      onError: (err) => {
        const msg = (err as any)?.response?.data?.message || (err as any)?.response?.data?.error || "Rebuild failed";
        toast({ title: "Rebuild Failed", description: msg, variant: "destructive" });
      }
    }
  });

  const handleDelete = () => {
    if (!email || !password) {
      toast({ title: "Missing Information", description: "Please enter account email and password to delete.", variant: "destructive" });
      return;
    }
    if (!window.confirm(`⚠️ Are you sure you want to permanently delete CarX account: ${email}?\nThis uses the bot's fast anonymous & token purge sequence. This cannot be undone!`)) {
      return;
    }
    deleteAcc.mutate({
      data: {
        email,
        password,
        userToken,
        token: userToken,
      }
    });
  };

  const handleRebuild = () => {
    if (!email || !password) {
      toast({ title: "Missing Information", description: "Please enter banned account email and password.", variant: "destructive" });
      return;
    }
    if (!window.confirm("⚠️ EXPERIMENTAL REBUILD NOTICE:\n\n• This feature is currently in progress and experimental — it may not work properly for every account.\n• Warning: Street Pass carries a very high ban detection rate if injected.\n\nDo you want to proceed with account rebuilding?")) {
      return;
    }
    setRebuildStatus([
      "Initiating rebuild sequence...",
      "Extracting full profile save JSON from banned account..."
    ]);
    rebuildAcc.mutate({
      data: {
        email,
        password,
        userToken,
        token: userToken,
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    if (mode === "delete") {
      handleDelete();
      return;
    }

    if (mode === "rebuild") {
      handleRebuild();
      return;
    }

    // Retrieve or generate persistent unique device identifiers
    let storedDeviceIds: { deviceId: string; uniqueId: string } | null = null;
    try {
      const savedIds = localStorage.getItem(`carx_device_ids_${email}`);
      if (savedIds) storedDeviceIds = JSON.parse(savedIds);
    } catch {}

    if (!storedDeviceIds) {
      const randHex = (len: number) => {
        const chars = "0123456789abcdef";
        let str = "";
        for (let i = 0; i < len; i++) {
          str += chars[Math.floor(Math.random() * 16)];
        }
        return str;
      };
      storedDeviceIds = {
        deviceId: randHex(32),
        uniqueId: randHex(64),
      };
      localStorage.setItem(`carx_device_ids_${email}`, JSON.stringify(storedDeviceIds));
    }

    let finalEmail = email.trim();
    if (mode === "register" && finalEmail && !finalEmail.includes("@")) {
      finalEmail = `${finalEmail}@carxming.com`;
    }
    const finalPassword = password.trim() || (mode === "register" ? "CARXMING" : "");

    const payload = {
      email: finalEmail,
      password: finalPassword,
      userToken,
      deviceId: storedDeviceIds.deviceId,
      uniqueId: storedDeviceIds.uniqueId,
    };

    if (mode === "login") {
      login.mutate({ data: payload });
    } else if (mode === "register") {
      register.mutate({ data: payload });
    }
  };

  const handleModeChange = (m: "login" | "register" | "rebuild" | "delete" | "bulk") => {
    setMode(m);
    if (m === "register") {
      if (!password) setPassword("CARXMING");
      if (!email) {
        const rand = Math.floor(100000 + Math.random() * 900000);
        setEmail(`driver${rand}@carxming.com`);
      }
    }
  };

  const isPending = login.isPending || register.isPending || deleteAcc.isPending || rebuildAcc.isPending;

  if (mode === "bulk") {
    return (
      <div>
        <div className="flex gap-1.5 p-1.5 bg-black/60 rounded-2xl mb-4 border border-zinc-800">
          {(["login", "register", "rebuild", "delete", "bulk"] as const).map((m) => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              className={`flex items-center gap-1.5 flex-1 justify-center py-2.5 rounded-xl text-xs font-gaming font-bold uppercase tracking-wider transition-all cursor-pointer ${
                mode === m
                  ? (m === "delete"
                      ? "bg-red-600 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]"
                      : m === "rebuild"
                      ? "bg-amber-500 text-black shadow-[0_0_15px_rgba(245,158,11,0.4)]"
                      : "bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)]")
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40"
              }`}
            >
              {m === "login" ? <User className="w-3.5 h-3.5" /> : m === "register" ? <UserPlus className="w-3.5 h-3.5" /> : m === "rebuild" ? <RefreshCw className="w-3.5 h-3.5" /> : m === "delete" ? <Trash2 className="w-3.5 h-3.5 text-red-400" /> : <Users className="w-3.5 h-3.5" />}
              {m === "login" ? "Login" : m === "register" ? "Register" : m === "rebuild" ? "Rebuild" : m === "delete" ? "Purge" : "Batch"}
            </button>
          ))}
        </div>
        <BatchForm userToken={userToken} />
      </div>
    );
  }

  return (
    <div className="cyber-card rounded-3xl p-6 sm:p-7 border border-zinc-800 space-y-5">
      {/* Mode Navigation Tabs */}
      <div className="flex gap-1.5 p-1.5 bg-black/70 rounded-2xl border border-zinc-800/80">
        {(["login", "register", "rebuild", "delete", "bulk"] as const).map((m) => (
          <button
            key={m}
            onClick={() => handleModeChange(m)}
            className={`flex items-center gap-1.5 flex-1 justify-center py-2.5 rounded-xl text-xs font-gaming font-bold uppercase tracking-wider transition-all cursor-pointer ${
              mode === m
                ? (m === "delete"
                    ? "bg-red-600 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)] border border-red-400/50"
                    : m === "rebuild"
                    ? "bg-gradient-to-r from-amber-500 to-yellow-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.5)] font-extrabold"
                    : m === "register"
                    ? "bg-gradient-to-r from-cyan-500 to-teal-400 text-black shadow-[0_0_20px_rgba(6,182,212,0.4)] font-extrabold"
                    : "bg-gradient-to-r from-amber-500 to-yellow-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.4)] font-extrabold")
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50"
            }`}
          >
            {m === "login" ? <User className="w-3.5 h-3.5" /> : m === "register" ? <UserPlus className="w-3.5 h-3.5" /> : m === "rebuild" ? <RefreshCw className="w-3.5 h-3.5" /> : m === "delete" ? <Trash2 className="w-3.5 h-3.5 text-red-400" /> : <Users className="w-3.5 h-3.5" />}
            {m === "login" ? "Login" : m === "register" ? "Register" : m === "rebuild" ? "Rebuild" : m === "delete" ? "Purge" : "Batch"}
          </button>
        ))}
      </div>

      {mode === "delete" && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3.5 bg-red-950/40 border border-red-500/40 rounded-2xl text-xs text-red-300 font-chakra flex items-center gap-2.5"
        >
          <span className="text-base">⚠️</span>
          <div>
            <span className="font-bold">FAST ACCOUNT PURGE:</span> Immediate unbind and token purge protocol to erase account from CarX servers.
          </div>
        </motion.div>
      )}

      {mode === "rebuild" && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3.5 bg-amber-950/40 border border-amber-500/50 rounded-2xl text-xs font-chakra space-y-2 text-amber-200"
        >
          <div className="flex items-center gap-2 text-amber-400 font-gaming font-bold uppercase tracking-wider text-[11px]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>EXPERIMENTAL BAN REBUILD (WORK IN PROCESS)</span>
          </div>
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            This routine extracts the banned account's complete save JSON, saves a server backup, purges the account, re-registers fresh with identical credentials, and restores the save.
          </p>
          <div className="text-[10px] font-mono text-zinc-400 bg-black/60 p-2 rounded-xl border border-zinc-800 space-y-1">
            <div className="text-red-300 font-bold">⚠️ Notice: In active development — may not work for all accounts due to server UID validation.</div>
            <div className="text-yellow-300">⚠️ Street Pass warning: Street Pass has a high ban detection rate if present.</div>
          </div>
        </motion.div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-[11px] font-chakra font-bold text-zinc-400 mb-1.5 flex items-center justify-between uppercase tracking-wider">
            <span>DRIVER IDENTIFIER // EMAIL</span>
            {mode === "register" && (
              <button
                type="button"
                onClick={() => {
                  const rand = Math.floor(100000 + Math.random() * 900000);
                  setEmail(`driver${rand}@carxming.com`);
                }}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 cursor-pointer font-mono font-bold"
              >
                + Auto-Generate
              </button>
            )}
          </label>
          <div className="relative">
            <input
              data-testid="input-carx-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={mode === "register" ? "driver@carxming.com" : "your@email.com"}
              className="w-full bg-zinc-900/90 border border-zinc-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-400 focus:shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all font-mono"
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-chakra font-bold text-zinc-400 mb-1.5 flex items-center justify-between uppercase tracking-wider">
            <span>SECURITY KEY // PASSWORD</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!password) {
                    toast({ title: "No Password", description: "Type a password to save.", variant: "destructive" });
                    return;
                  }
                  saveCredsMutation.mutate({
                    data: { default_password: password }
                  }, {
                    onSuccess: () => {
                      toast({ title: "Password Saved! 🔑", description: "Saved to saved_credentials.json. Persists across updates." });
                    },
                    onError: () => {
                      toast({ title: "Saved to Browser 🔑", description: "Saved to local browser storage." });
                    }
                  });
                  localStorage.setItem("carx_default_password", password);
                }}
                title="Save as permanent default password"
                className="text-[10px] text-emerald-400 hover:text-emerald-300 cursor-pointer font-mono font-bold flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30"
              >
                <Bookmark className="w-3 h-3" />
                <span>Save Password</span>
              </button>
              {mode === "register" && (
                <button
                  type="button"
                  onClick={() => setPassword("CARXMING")}
                  className="text-[10px] text-amber-400 hover:text-amber-300 cursor-pointer font-mono font-bold"
                >
                  + Default CARXMING
                </button>
              )}
            </div>
          </label>
          <div className="relative">
            <input
              data-testid="input-carx-password"
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-zinc-900/90 border border-zinc-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-400 focus:shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all font-mono pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
            >
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {rebuildStatus.length > 0 && mode === "rebuild" && (
          <div className="p-3 rounded-xl bg-black/60 border border-amber-500/30 space-y-1.5 font-mono text-[11px]">
            <div className="text-amber-400 font-bold uppercase text-[10px] flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />
              <span>Rebuild Execution Steps:</span>
            </div>
            {rebuildStatus.map((step, idx) => (
              <div key={idx} className="flex items-center gap-1.5 text-zinc-300">
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>{step}</span>
              </div>
            ))}
          </div>
        )}

        {mode === "delete" ? (
          <button
            data-testid="button-carx-delete"
            type="submit"
            disabled={isPending || !email || !password}
            className="w-full py-3.5 rounded-xl font-gaming font-bold text-xs tracking-widest uppercase bg-gradient-to-r from-red-600 via-rose-600 to-red-600 text-white hover:from-red-500 hover:to-rose-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_0_25px_rgba(220,38,38,0.4)] flex items-center justify-center gap-2 cursor-pointer"
          >
            {deleteAcc.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                PURGING ACCOUNT RECORD...
              </span>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                PERMANENTLY PURGE ACCOUNT
              </>
            )}
          </button>
        ) : mode === "rebuild" ? (
          <button
            data-testid="button-carx-rebuild"
            type="submit"
            disabled={isPending || !email || !password}
            className="w-full py-3.5 rounded-xl font-gaming font-bold text-xs tracking-widest uppercase bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-black hover:from-amber-400 hover:to-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_0_25px_rgba(245,158,11,0.4)] flex items-center justify-center gap-2 cursor-pointer"
          >
            {rebuildAcc.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                EXECUTING REBUILD (IN PROCESS)...
              </span>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                REBUILD BANNED ACCOUNT (EXPERIMENTAL)
              </>
            )}
          </button>
        ) : (
          <div className="space-y-2.5 pt-1">
            <button
              data-testid="button-carx-submit"
              type="submit"
              disabled={isPending || !email || !password}
              className={`w-full py-3.5 rounded-xl font-gaming font-bold text-xs tracking-widest uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                mode === "login"
                  ? "bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400 text-black hover:from-amber-400 hover:to-yellow-300 shadow-[0_0_25px_rgba(245,158,11,0.35)] hover:shadow-[0_0_35px_rgba(245,158,11,0.5)]"
                  : "bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 text-black hover:from-cyan-400 hover:to-emerald-300 shadow-[0_0_25px_rgba(6,182,212,0.35)] hover:shadow-[0_0_35px_rgba(6,182,212,0.5)]"
              }`}
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  {mode === "login" ? "LINKING DRIVER TELEMETRY..." : "INITIALIZING DRIVER ACCOUNT..."}
                </span>
              ) : mode === "login" ? (
                "IGNITE ENGINE // LOGIN TO CARX"
              ) : (
                "CREATE ACCOUNT // REGISTER"
              )}
            </button>

            {/* Quick Fast Delete Emergency Option */}
            <button
              type="button"
              disabled={isPending || !email || !password}
              onClick={handleDelete}
              className="w-full py-2 rounded-xl text-[11px] font-chakra font-bold text-red-400/80 hover:text-red-300 hover:bg-red-950/30 border border-red-500/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleteAcc.isPending ? "Purging Account..." : "Fast Purge Account (Using Above Credentials)"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

function InjectionPanel({ session, userToken, onDisconnect }: { session: CarXSession; userToken: string; onDisconnect: () => void }) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<ProfileStats | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const [currencyPreset, setCurrencyPreset] = useState<string>("step");
  const [customSilver, setCustomSilver] = useState("1000");
  const [customGold, setCustomGold] = useState("1000");
  const [customXp, setCustomXp] = useState("100");

  const [carsMode, setCarsMode] = useState<string>(CarsInjectInputMode.all);
  const [customCarCount, setCustomCarCount] = useState("50");

  const [selectedMap, setSelectedMap] = useState<string>("next");
  const [cosmeticsMode, setCosmeticsMode] = useState<string>("next");
  const [customCosmeticCount, setCustomCosmeticCount] = useState<string>("1");
  const [selectedCosmeticSet, setSelectedCosmeticSet] = useState<number>(1);
  const [neonOption, setNeonOption] = useState<string>("all");
  const [tireOption, setTireOption] = useState<string>("all");
  const [plateOption, setPlateOption] = useState<string>("all");
  const [rimOption, setRimOption] = useState<string>("all");

  const [tokenToProbe, setTokenToProbe] = useState(session.token || "");
  const [banCheckResult, setBanCheckResult] = useState<{
    checked: boolean;
    isBanned: boolean;
    banReason?: string;
    statusText?: string;
    checkedToken?: string;
    timestamp?: string;
  } | null>(null);
  const [banModalOpen, setBanModalOpen] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedBanEmail, setCopiedBanEmail] = useState(false);
  const [copiedBanToken, setCopiedBanToken] = useState(false);

  const [results, setResults] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const [fleetModalOpen, setFleetModalOpen] = useState(false);
  const [fleetSearch, setFleetSearch] = useState("");

  const deleteAcc = useDeleteCarX({
    mutation: {
      onSuccess: (d) => {
        if (d.success) {
          toast({ title: "Account Deleted! 🗑️", description: d.message || "CarX account has been purged successfully." });
          onDisconnect();
        } else {
          toast({ title: "Delete Failed", description: d.message || "Failed to delete account.", variant: "destructive" });
        }
      },
      onError: (err) => {
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        toast({ title: "Delete Failed", description: msg || "Request failed", variant: "destructive" });
      }
    }
  });

  const rebuildDashboardAcc = useRebuildBannedAccount({
    mutation: {
      onSuccess: (d) => {
        if (d.success) {
          toast({
            title: "Rebuild Completed! 🔄",
            description: d.message || "Banned account has been cloned, purged, and re-registered fresh!"
          });
          if (d.token) {
            setSession((prev: any) => prev ? ({
              ...prev,
              token: d.token,
              carxId: d.carxId || prev.carxId,
            }) : null);
          }
          fetchProfile();
        } else {
          toast({
            title: "Rebuild Notice",
            description: d.message || "Rebuild process finished with notes.",
            variant: "destructive"
          });
        }
      },
      onError: (err) => {
        const msg = (err as any)?.response?.data?.message || "Rebuild failed";
        toast({ title: "Rebuild Error", description: msg, variant: "destructive" });
      }
    }
  });

  const handleDeleteCurrentAccount = () => {
    if (!window.confirm(`⚠️ DANGER: Are you sure you want to permanently delete this CarX account (${session.email})?\nAll progress, cars, and data will be erased forever on CarX servers!`)) {
      return;
    }
    const pw = session.password || localStorage.getItem("carx_default_password") || "CARXMING";
    deleteAcc.mutate({
      data: {
        email: session.email,
        password: pw,
        token: session.token,
        deviceId: session.deviceId,
        userToken
      }
    });
  };

  const handleRebuildCurrentAccount = () => {
    const pw = session.password || localStorage.getItem("carx_default_password") || "CARXMING";
    if (!window.confirm("⚠️ EXPERIMENTAL REBUILD NOTICE:\n\n• This feature is currently in progress and experimental — it may not work properly for every account.\n• Warning: Street Pass carries a very high ban detection rate if injected.\n\nDo you want to proceed with account rebuilding?")) {
      return;
    }
    rebuildDashboardAcc.mutate({
      data: {
        email: session.email,
        password: pw,
        token: session.token,
        userToken,
        deviceId: session.deviceId,
        uniqueId: session.uniqueId
      }
    });
  };

  const getProfile = useGetProfile({
    mutation: {
      onSuccess: (d) => {
        if (d.success && d.stats) {
          const isBannedAcc = Boolean(d.stats.isBanned ?? d.isBanned);
          const banReasonText = d.stats.banReason || d.banReason;
          setProfile({
            silver: d.stats.cash !== undefined ? d.stats.cash : 0,
            gold: d.stats.gold !== undefined ? d.stats.gold : 0,
            xp: d.stats.exp !== undefined ? d.stats.exp : 0,
            level: d.stats.level || 1,
            cars: d.stats.cars || d.stats.cars_count || 0,
            clubs_count: d.stats.clubs_count || 0,
            real_estates_count: d.stats.real_estates_count || 0,
            maps_count: d.stats.maps_count !== undefined ? d.stats.maps_count : 0,
            unlocked_maps: d.stats.unlocked_maps || [],
            current_car: d.stats.current_car || "toyotasupra2020",
            current_car_id: d.stats.current_car_id || "",
            streetPass: !!d.stats.street_pass,
            premium: true,
            isVerified: !!d.stats.isVerified,
            isBanned: isBannedAcc,
            banReason: banReasonText,
            name: d.stats.name,
            avatars_count: d.stats.avatars_count !== undefined ? d.stats.avatars_count : 0,
            frames_count: d.stats.frames_count !== undefined ? d.stats.frames_count : 0,
            banners_count: d.stats.banners_count !== undefined ? d.stats.banners_count : 0,
            neons_count: d.stats.neons_count,
            neons_total: d.stats.neons_total,
            neons_approved: d.stats.neons_approved,
            tire_walls_count: d.stats.tire_walls_count,
            tire_walls_total: d.stats.tire_walls_total,
            tire_walls_approved: d.stats.tire_walls_approved,
            plates_count: d.stats.plates_count,
            plates_total: d.stats.plates_total,
            plates_approved: d.stats.plates_approved,
            rims_count: d.stats.rims_count,
            rims_total: d.stats.rims_total,
            rims_approved: d.stats.rims_approved,
            profile_styles_approved: d.stats.profile_styles_approved,
            maps_approved: d.stats.maps_approved,
            houses_approved: d.stats.houses_approved,
            cars_list: d.stats.cars_list || [],
          });
          if (isBannedAcc) {
            toast({
              title: "🚨 Ban Detected!",
              description: banReasonText || "CarX anti-cheat has flagged or restricted this account.",
              variant: "destructive"
            });
          }
        }
        setLoadingProfile(false);
      },
      onError: () => { setLoadingProfile(false); toast({ title: "Error", description: "Failed to fetch profile", variant: "destructive" }); },
    },
  });

  const injectCurrency = useInjectCurrency({
    mutation: {
      onSuccess: (d) => {
        setResults(r => ({ ...r, currency: { ok: true, msg: d.message || "Done" } }));
        fetchProfile();
      },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, currency: { ok: false, msg: msg || "Failed" } }));
      },
    },
  });

  const unlockMaps = useUnlockMaps({
    mutation: {
      onSuccess: (d: any) => {
        setResults(r => ({ ...r, maps: { ok: true, msg: d.message || "Done" } }));
        if (d.stats) {
          setProfile(p => p ? ({
            ...p,
            maps_count: d.stats.maps_count !== undefined ? d.stats.maps_count : p.maps_count,
            unlocked_maps: d.stats.unlocked_maps || p.unlocked_maps,
          }) : null);
        }
        fetchProfile();
      },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, maps: { ok: false, msg: msg || "Failed" } }));
      },
    },
  });

  const unlockClubs = useUnlockClubs({
    mutation: {
      onSuccess: (d) => {
        setResults(r => ({ ...r, clubs: { ok: true, msg: d.message || "Done" } }));
        fetchProfile();
      },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, clubs: { ok: false, msg: msg || "Failed" } }));
      },
    },
  });

  const unlockMapsHouses = useUnlockMapsHouses({
    mutation: {
      onSuccess: (d: any) => {
        setResults(r => ({ ...r, mapsHouses: { ok: true, msg: d.message || "Maps & Real Estate Unlocked!" } }));
        if (d.stats) {
          setProfile(p => p ? ({
            ...p,
            maps_count: d.stats.maps_count !== undefined ? d.stats.maps_count : p.maps_count,
            unlocked_maps: d.stats.unlocked_maps || p.unlocked_maps,
            clubs_count: d.stats.clubs_count !== undefined ? d.stats.clubs_count : p.clubs_count,
            real_estates_count: d.stats.real_estates_count !== undefined ? d.stats.real_estates_count : p.real_estates_count,
            maps_approved: d.stats.maps_approved !== undefined ? d.stats.maps_approved : p.maps_approved,
            houses_approved: d.stats.houses_approved !== undefined ? d.stats.houses_approved : p.houses_approved,
          }) : null);
        }
        toast({ title: "Unlocked!", description: d.message || "All maps & houses unlocked sequentially." });
        fetchProfile();
      },
      onError: (err: any) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, mapsHouses: { ok: false, msg: msg || "Failed to unlock maps & houses" } }));
        toast({ title: "Unlock Failed", description: msg || "Error unlocking maps & houses", variant: "destructive" });
      },
    },
  });

  const checkBan = useCheckBan({
    mutation: {
      onSuccess: (d: any) => {
        const isBanned = Boolean(d.isBanned || d.banned);
        const reason = d.banReason || d.message || (isBanned ? "Account flagged as banned/restricted" : "Active & in good standing");
        setBanCheckResult({
          checked: true,
          isBanned,
          banReason: reason,
          statusText: d.statusText || (isBanned ? "BANNED" : "CLEAN / ACTIVE"),
          checkedToken: tokenToProbe,
          timestamp: new Date().toLocaleTimeString(),
        });
        setBanModalOpen(true);
        if (isBanned) {
          toast({
            title: "🚨 BAN DETECTED!",
            description: reason,
            variant: "destructive",
          });
        } else {
          toast({
            title: "🛡️ ACCOUNT IS CLEAN!",
            description: "No anti-cheat bans or restrictions detected on this active token.",
          });
        }
      },
      onError: (err: any) => {
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to probe ban status";
        toast({ title: "Ban Check Failed", description: msg, variant: "destructive" });
      }
    }
  });

  const handleRunBanCheck = (targetToken?: string) => {
    const t = (targetToken || tokenToProbe || session.token || "").trim();
    if (!t) {
      toast({ title: "Token Required", description: "Please enter an active token to test.", variant: "destructive" });
      return;
    }
    checkBan.mutate({
      data: {
        token: t,
        email: session.email,
        userId: session.carxId,
        deviceId: session.deviceId,
        uniqueId: session.uniqueId,
        userToken
      }
    });
  };

  const injectCars = useInjectCars({
    mutation: {
      onSuccess: (d: any) => {
        setResults(r => ({ ...r, cars: { ok: true, msg: d.message || "Done" } }));
        if (d.stats) {
          setProfile(p => p ? ({
            ...p,
            cars: d.stats.cars || d.stats.cars_count || p.cars,
            current_car: d.stats.current_car || p.current_car,
            current_car_id: d.stats.current_car_id || p.current_car_id,
            cars_list: d.stats.cars_list || p.cars_list,
          }) : null);
        }
        fetchProfile();
      },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, cars: { ok: false, msg: msg || "Failed" } }));
      },
    },
  });

  const unlockStreetPass = useUnlockStreetPass({
    mutation: {
      onSuccess: (d) => {
        setResults(r => ({ ...r, streetPass: { ok: true, msg: d.message || "Done" } }));
        fetchProfile();
      },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, streetPass: { ok: false, msg: msg || "Failed" } }));
      },
    },
  });

  const unlockProfileStyle = useUnlockProfileStyle({
    mutation: {
      onSuccess: (d: any) => {
        setResults(r => ({ ...r, profileStyle: { ok: true, msg: d.message || "Avatars & Frames Unlocked!" } }));
        if (d.stats) {
          setProfile(p => p ? ({
            ...p,
            avatar: d.stats.avatar || p.avatar,
            avatars_count: d.stats.avatars_count !== undefined ? d.stats.avatars_count : p.avatars_count,
            frames_count: d.stats.frames_count !== undefined ? d.stats.frames_count : p.frames_count,
            banners_count: d.stats.banners_count !== undefined ? d.stats.banners_count : p.banners_count,
          }) : null);
        }
        fetchProfile();
      },
      onError: (err: any) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, profileStyle: { ok: false, msg: msg || "Failed to unlock avatars" } }));
      },
    },
  });

  const unlockNeon = useUnlockNeon({
    mutation: {
      onSuccess: (d: any) => {
        setResults(r => ({ ...r, neon: { ok: true, msg: d.message || "Neon Lights Injected!" } }));
        toast({ title: "Neon Injected!", description: d.message });
        if (d.stats) {
          setProfile(p => p ? ({
            ...p,
            neons_count: d.stats.neons_count !== undefined ? d.stats.neons_count : p.neons_count,
            neons_total: d.stats.neons_total !== undefined ? d.stats.neons_total : p.neons_total,
            neons_approved: d.stats.neons_approved !== undefined ? d.stats.neons_approved : p.neons_approved,
          }) : null);
        }
        fetchProfile();
      },
      onError: (err: any) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, neon: { ok: false, msg: msg || "Failed to inject neon" } }));
      },
    },
  });

  const unlockTireWalls = useUnlockTireWalls({
    mutation: {
      onSuccess: (d: any) => {
        setResults(r => ({ ...r, tireWalls: { ok: true, msg: d.message || "Tire Sidewalls Injected!" } }));
        toast({ title: "Tire Sidewalls Injected!", description: d.message });
        if (d.stats) {
          setProfile(p => p ? ({
            ...p,
            tire_walls_count: d.stats.tire_walls_count !== undefined ? d.stats.tire_walls_count : p.tire_walls_count,
            tire_walls_total: d.stats.tire_walls_total !== undefined ? d.stats.tire_walls_total : p.tire_walls_total,
            tire_walls_approved: d.stats.tire_walls_approved !== undefined ? d.stats.tire_walls_approved : p.tire_walls_approved,
          }) : null);
        }
        fetchProfile();
      },
      onError: (err: any) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, tireWalls: { ok: false, msg: msg || "Failed to inject tire sidewalls" } }));
      },
    },
  });

  const unlockNumberPlates = useUnlockNumberPlates({
    mutation: {
      onSuccess: (d: any) => {
        setResults(r => ({ ...r, numberPlates: { ok: true, msg: d.message || "Number Plates Injected!" } }));
        toast({ title: "Number Plates Injected!", description: d.message });
        if (d.stats) {
          setProfile(p => p ? ({
            ...p,
            plates_count: d.stats.plates_count !== undefined ? d.stats.plates_count : p.plates_count,
            plates_total: d.stats.plates_total !== undefined ? d.stats.plates_total : p.plates_total,
            plates_approved: d.stats.plates_approved !== undefined ? d.stats.plates_approved : p.plates_approved,
          }) : null);
        }
        fetchProfile();
      },
      onError: (err: any) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, numberPlates: { ok: false, msg: msg || "Failed to inject number plates" } }));
      },
    },
  });

  const unlockWheelRims = useUnlockWheelRims({
    mutation: {
      onSuccess: (d: any) => {
        setResults(r => ({ ...r, wheelRims: { ok: true, msg: d.message || "Wheel Rims Injected!" } }));
        toast({ title: "Wheel Rims Injected!", description: d.message });
        if (d.stats) {
          setProfile(p => p ? ({
            ...p,
            rims_count: d.stats.rims_count !== undefined ? d.stats.rims_count : p.rims_count,
            rims_total: d.stats.rims_total !== undefined ? d.stats.rims_total : p.rims_total,
            rims_approved: d.stats.rims_approved !== undefined ? d.stats.rims_approved : p.rims_approved,
          }) : null);
        }
        fetchProfile();
      },
      onError: (err: any) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, wheelRims: { ok: false, msg: msg || "Failed to inject wheel rims" } }));
      },
    },
  });

  const injectAll = useInjectAll({
    mutation: {
      onSuccess: (d: any) => {
        const r = d as { currency?: boolean; maps?: boolean; cars?: number; streetPass?: boolean; message?: string; stats?: any };
        setResults({
          currency: { ok: !!r.currency, msg: "Currency injected" },
          maps: { ok: !!r.maps, msg: "Maps unlocked" },
          cars: { ok: r.cars !== undefined && r.cars > 0, msg: `${r.cars} cars added` },
          streetPass: { ok: !!r.streetPass, msg: r.streetPass ? "Street Pass activated" : "Skipped" },
        });
        if (d.stats) {
          const s = d.stats;
          setProfile(p => p ? ({
            ...p,
            silver: s.cash !== undefined ? s.cash : p.silver,
            gold: s.gold !== undefined ? s.gold : p.gold,
            xp: s.exp !== undefined ? s.exp : p.xp,
            level: s.level || p.level,
            cars: s.cars || s.cars_count || p.cars,
            clubs_count: s.clubs_count || p.clubs_count,
            real_estates_count: s.real_estates_count || p.real_estates_count,
            current_car: s.current_car || p.current_car,
            current_car_id: s.current_car_id || p.current_car_id,
            cars_list: s.cars_list || p.cars_list,
          }) : null);
        }
        toast({ title: "Inject All Complete!", description: r.message });
        fetchProfile();
      },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: "Inject All Failed", description: msg, variant: "destructive" });
      },
    },
  });

  const safeRepair = useSafeRepair({
    mutation: {
      onSuccess: (d: any) => {
        setResults(r => ({ ...r, safeRepair: { ok: true, msg: d.message || "Safe Repair Complete!" } }));
        toast({ title: "Safe Repair Complete", description: d.message });
        fetchProfile();
      },
      onError: (err: any) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, safeRepair: { ok: false, msg: msg || "Failed to repair account" } }));
      },
    },
  });

  const cleanRewriteAcc = useCleanRewriteAccount({
    mutation: {
      onSuccess: (d: any) => {
        setResults(r => ({ ...r, cleanRewrite: { ok: true, msg: d.message || "Clean Rewrite Complete!" } }));
        toast({ title: "Clean JSON Blueprint Rewritten! ✨", description: d.message || "All 52 houses, 6 districts, and profile references rewritten cleanly without errors." });
        if (d.stats) {
          setProfile(p => p ? ({ ...p, ...d.stats }) : null);
        }
        fetchProfile();
      },
      onError: (err: any) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setResults(r => ({ ...r, cleanRewrite: { ok: false, msg: msg || "Failed to rewrite account" } }));
        toast({ title: "Clean Rewrite Failed", description: msg, variant: "destructive" });
      },
    },
  });

  const handleCleanRewrite = () => {
    if (!session) return;
    cleanRewriteAcc.mutate({
      data: {
        token: session.token,
        userId: session.carxId,
        deviceId: session.deviceId,
        uniqueId: session.uniqueId,
        service_type: "clean_rewrite_account",
        userToken
      }
    });
  };

  const carsQuery = useGetCars(
    { userToken },
    { query: { queryKey: getGetCarsQueryKey({ userToken }), enabled: true } }
  );

  const totalCars = carsQuery.data?.total || 89;

  const fetchProfile = () => {
    setLoadingProfile(true);
    getProfile.mutate({
      data: {
        token: session.token,
        userId: session.carxId,
        deviceId: session.deviceId,
        uniqueId: session.uniqueId,
        userToken
      }
    });
  };

  // Auto-load profile on mount (same as Replit2 — loads immediately on login/register)
  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token]);

  const handleInjectCurrency = (forced?: { service_type?: string; cash?: number; gold?: number; exp?: number }) => {
    let service = "custom_resource";
    let cashVal = 1000;
    let goldVal = 1000;
    let expVal = 100;

    if (forced) {
      if (forced.service_type) service = forced.service_type;
      cashVal = forced.cash !== undefined ? forced.cash : 0;
      goldVal = forced.gold !== undefined ? forced.gold : 0;
      expVal = forced.exp !== undefined ? forced.exp : 0;
    } else if (currencyPreset === CurrencyInputPreset.custom) {
      cashVal = Number(customSilver) || 0;
      goldVal = Number(customGold) || 0;
      expVal = Number(customXp) || 0;
    } else if (currencyPreset === "step" || currencyPreset === CurrencyInputPreset.safe || currencyPreset === CurrencyInputPreset.max) {
      cashVal = 1000;
      goldVal = 1000;
      expVal = 100;
    } else if (currencyPreset === CurrencyInputPreset.medium || currencyPreset === "medium") {
      cashVal = 10000;
      goldVal = 5000;
      expVal = 500;
    }

    injectCurrency.mutate({
      data: {
        token: session.token,
        userId: session.carxId,
        deviceId: session.deviceId,
        uniqueId: session.uniqueId,
        service_type: service,
        cash: cashVal,
        gold: goldVal,
        exp: expVal,
        custom_amount: service === "cash" ? cashVal : (service === "gold" ? goldVal : (service === "exp" ? expVal : undefined)),
        userToken
      },
    });
  };

  const handleInjectCars = () => {
    let service = "get_all_cars";
    let countVal = 10;
    if (carsMode === "first50") {
      service = "inject_random_cars";
      countVal = 50;
    } else if (carsMode === "random10") {
      service = "inject_random_cars";
      countVal = 10;
    } else if (carsMode === "custom") {
      service = "inject_random_cars";
      countVal = Number(customCarCount) || 10;
    }

    injectCars.mutate({
      data: {
        token: session.token,
        userId: session.carxId,
        deviceId: session.deviceId,
        uniqueId: session.uniqueId,
        service_type: service,
        random_cars_count: countVal,
        userToken
      }
    });
  };

  const anyPending =
    injectCurrency.isPending || unlockMaps.isPending || unlockClubs.isPending || unlockMapsHouses.isPending ||
    injectCars.isPending || unlockStreetPass.isPending || unlockProfileStyle.isPending ||
    unlockNeon.isPending || unlockTireWalls.isPending || unlockNumberPlates.isPending || unlockWheelRims.isPending ||
    injectAll.isPending || safeRepair.isPending || cleanRewriteAcc.isPending || checkBan.isPending;

  const CURRENCY_PRESETS = [
    { v: "step", l: "Safe Step (+1K)", sub: "+1K Cash / +1K Gold / +100 EXP" },
    { v: "medium", l: "Medium (+10K)", sub: "+10K Cash / +5K Gold / +500 EXP" },
    { v: CurrencyInputPreset.custom, l: "Custom", sub: "Set custom increment" },
  ];

  const CAR_MODES = [
    { v: CarsInjectInputMode.all, l: "All (89 Cars)", sub: "All 89 original cars" },
    { v: CarsInjectInputMode.first50, l: "First 50", sub: "50 cars" },
    { v: CarsInjectInputMode.random10, l: "Random 10", sub: "10 cars" },
    { v: CarsInjectInputMode.custom, l: "Custom", sub: "Pick count" },
  ];

  const handleInjectProfileStyle = () => {
    let modeVal = cosmeticsMode;
    let countVal = 1;
    let setId: number | undefined = undefined;

    if (cosmeticsMode === "all") {
      modeVal = "all";
    } else if (cosmeticsMode === "next") {
      modeVal = "next";
      countVal = 1;
    } else if (cosmeticsMode === "custom") {
      modeVal = "custom_count";
      countVal = Math.min(22, Math.max(1, Number(customCosmeticCount) || 1));
    } else if (cosmeticsMode === "specific") {
      modeVal = "specific";
      setId = selectedCosmeticSet;
    }

    unlockProfileStyle.mutate({
      data: {
        token: session.token,
        userId: session.carxId,
        deviceId: session.deviceId,
        uniqueId: session.uniqueId,
        service_type: "unlock_profile_style",
        cosmetic_mode: modeVal,
        custom_count: countVal,
        set_id: setId,
        userToken
      }
    });
  };

  const handleInjectNeon = (opt?: string, count?: number) => {
    if (!session) return;
    const chosenOption = opt || neonOption;
    unlockNeon.mutate({
      data: {
        token: session.token,
        userId: session.carxId,
        deviceId: session.deviceId,
        uniqueId: session.uniqueId,
        service_type: "unlock_neon",
        neon_option: chosenOption,
        custom_count: count !== undefined ? count : (chosenOption === "next" ? 1 : undefined),
        userToken
      }
    });
  };

  const handleInjectTireWalls = (opt?: string, count?: number) => {
    if (!session) return;
    const chosenOption = opt || tireOption;
    unlockTireWalls.mutate({
      data: {
        token: session.token,
        userId: session.carxId,
        deviceId: session.deviceId,
        uniqueId: session.uniqueId,
        service_type: "unlock_tire_walls",
        tire_option: chosenOption,
        custom_count: count !== undefined ? count : (chosenOption === "next" ? 1 : undefined),
        userToken
      }
    });
  };

  const handleInjectNumberPlates = (opt?: string, count?: number) => {
    if (!session) return;
    const chosenOption = opt || plateOption;
    unlockNumberPlates.mutate({
      data: {
        token: session.token,
        userId: session.carxId,
        deviceId: session.deviceId,
        uniqueId: session.uniqueId,
        service_type: "unlock_number_plates",
        plate_option: chosenOption,
        custom_count: count !== undefined ? count : (chosenOption === "next" ? 1 : undefined),
        userToken
      }
    });
  };

  const handleInjectWheelRims = (opt?: string, count?: number) => {
    if (!session) return;
    const chosenOption = opt || rimOption;
    unlockWheelRims.mutate({
      data: {
        token: session.token,
        userId: session.carxId,
        deviceId: session.deviceId,
        uniqueId: session.uniqueId,
        service_type: "unlock_wheel_rims",
        rim_option: chosenOption,
        custom_count: count !== undefined ? count : (chosenOption === "next" ? 1 : undefined),
        userToken
      }
    });
  };

  const NEON_MODES = [
    { v: "next", l: "Next (+1)", sub: "One by One" },
    { v: "all", l: "All Neons", sub: "15 Animated + Static" },
    { v: "animated", l: "Animated", sub: "15 Sequences" },
    { v: "pulse_flow", l: "Pulse & Flow", sub: "Neons 1-8" },
    { v: "cyber_hyper", l: "Cyber / Hyper", sub: "Neons 9-15" },
    { v: "static", l: "Static Glow", sub: "Classic Undercar" },
  ];

  const TIRE_MODES = [
    { v: "next", l: "Next (+1)", sub: "One by One" },
    { v: "all", l: "All Sidewalls", sub: "All 14 Branded" },
    { v: "racing_drift", l: "Racing & Drift", sub: "Faster, Drift, GripX" },
    { v: "street_style", l: "Street & Style", sub: "Shinobi, Donuts, Yolo" },
  ];

  const PLATE_MODES = [
    { v: "next", l: "Next (+1)", sub: "One by One" },
    { v: "all", l: "All Plates", sub: "74+ Vanity & Events" },
    { v: "events", l: "Event Specials", sub: "Halloween, Lunar, Snow" },
    { v: "jdm_street", l: "JDM & Street", sub: "Akuma, Oni, 500HP" },
  ];

  const RIM_MODES = [
    { v: "next", l: "Next (+1)", sub: "One by One" },
    { v: "all", l: "All Rims", sub: "412+ Rims Total" },
    { v: "battlepass", l: "Battle Pass", sub: "110 BP Exclusive Rims" },
    { v: "aftermarket_jdm", l: "Tuner & JDM", sub: "Classic Tuner 1-470" },
  ];

  const COSMETICS_MODES = [
    { v: "next", l: "Next (+1)", sub: "One by One" },
    { v: "custom", l: "Custom", sub: "Add X Sets" },
    { v: "specific", l: "Specific", sub: "Pick Set 1-22" },
    { v: "all", l: "All Sets", sub: "All Avatars & Frames" },
  ];

  const COSMETIC_SETS_OPTIONS = [
    { id: 1, label: "Set 1 (Avatar 1 / Frame 1)" },
    { id: 2, label: "Set 2 (Avatar 2 / Frame 2)" },
    { id: 3, label: "Set 3 (Avatar 3 / Frame 3)" },
    { id: 4, label: "Set 4 (Avatar 4 / Frame 4)" },
    { id: 5, label: "Set 5 (Avatar 5 / Frame 5)" },
    { id: 6, label: "Set 6 (Avatar 6 / Frame 6)" },
    { id: 7, label: "Set 7 (Avatar 7 / Frame 7)" },
    { id: 8, label: "Set 8 (Avatar 8 / Frame 8)" },
    { id: 9, label: "Set 9 (Avatar 9 / Frame 9)" },
    { id: 10, label: "Set 10 (Avatar 10 / Frame 10)" },
    { id: 11, label: "Set 11 (Avatar 11 / Frame 11)" },
    { id: 12, label: "Set 12 (Avatar 12 / Frame 12)" },
    { id: 13, label: "Set 13 (Avatar 13 / Frame 13)" },
    { id: 14, label: "Set 14 (Avatar 14 / Frame 14)" },
    { id: 15, label: "Set 15 (Avatar 15 / Frame 15)" },
    { id: 16, label: "Set 16 (Avatar 16 / Frame 16)" },
    { id: 17, label: "Set 17 (Avatar 17 / Frame 17)" },
    { id: 18, label: "Set 18 (Avatar 18 / Frame 18)" },
    { id: 19, label: "Champion 1 (Golden Cup 1)" },
    { id: 20, label: "Champion 2 (Golden Cup 2)" },
    { id: 21, label: "Champion 3 (Golden Cup 3)" },
    { id: 22, label: "Champion 4 (Crown Champ 4)" },
  ];

  const filteredFleet = (profile?.cars_list || []).filter(c =>
    !fleetSearch || c.descId.toLowerCase().includes(fleetSearch.toLowerCase()) || c.id.includes(fleetSearch)
  );

  return (
    <div className="space-y-4">
      {/* Fleet Modal */}
      {fleetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="cyber-card rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-purple-500/40 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/80">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🏎️</span>
                <div>
                  <h3 className="text-sm font-gaming font-bold text-white tracking-wide">
                    GARAGE FLEET INSPECTOR ({profile?.cars || 0} CARS)
                  </h3>
                  <p className="text-[11px] font-chakra text-purple-400">
                    Live database of cars parked in account garages
                  </p>
                </div>
              </div>
              <button
                onClick={() => setFleetModalOpen(false)}
                className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-4 border-b border-zinc-800 bg-black/40">
              <input
                type="text"
                value={fleetSearch}
                onChange={(e) => setFleetSearch(e.target.value)}
                placeholder="Search car model or slot ID..."
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-4 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-400 font-mono"
              />
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-2 bg-black/80">
              {filteredFleet.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 text-xs font-chakra">
                  No cars matching search filter
                </div>
              ) : (
                filteredFleet.map((c, idx) => (
                  <div
                    key={`${c.id}-${idx}`}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                      c.id === profile?.current_car_id || c.descId === profile?.current_car
                        ? "bg-purple-950/40 border-purple-500/60 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                        : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">🏎️</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-white uppercase">{c.descId}</span>
                          {(c.id === profile?.current_car_id || c.descId === profile?.current_car) && (
                            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold">
                              ACTIVE RIDE
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-zinc-500">Slot #{c.id}</span>
                      </div>
                    </div>
                    {c.rating !== undefined && c.rating > 0 && (
                      <span className="font-mono text-xs text-amber-400 font-bold">
                        ⭐ {c.rating} PR
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-900/80 flex items-center justify-between text-[11px] font-chakra text-zinc-500">
              <span>Showing {filteredFleet.length} of {profile?.cars || 0} cars</span>
              <button
                onClick={() => setFleetModalOpen(false)}
                className="text-purple-400 hover:text-purple-300 font-bold uppercase cursor-pointer"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logged in Header & Profile Dashboard */}
      <div className="cyber-card rounded-3xl p-5 shadow-xl border border-zinc-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <div className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">CONNECTED ACCOUNT</div>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-sm font-bold font-mono text-white select-all">
                {session.email}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (session.email) {
                    navigator.clipboard.writeText(session.email);
                    setCopiedEmail(true);
                    setTimeout(() => setCopiedEmail(false), 2000);
                  }
                }}
                className="px-2 py-0.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[10px] font-mono flex items-center gap-1 border border-zinc-700 transition-all cursor-pointer shadow-sm"
                title="Copy Email"
              >
                {copiedEmail ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-zinc-400" />}
                <span className={copiedEmail ? "text-emerald-400 font-bold" : ""}>
                  {copiedEmail ? "Copied!" : "Copy Email"}
                </span>
              </button>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {session.carxId && (
                <div className="text-[11px] font-mono text-zinc-400">
                  CarX ID: <span className="text-amber-400 font-bold select-all">{session.carxId}</span>
                </div>
              )}
              {profile?.isVerified !== undefined && (
                <span className={`text-[10px] font-chakra font-bold px-2 py-0.5 rounded-full border ${
                  profile.isVerified
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                    : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                }`}>
                  {profile.isVerified ? "✓ VERIFIED EMAIL" : "⚠️ UNVERIFIED"}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center flex-wrap">
            <button
              onClick={() => handleRunBanCheck()}
              disabled={checkBan.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-red-500/20 to-rose-500/20 hover:from-red-500/30 hover:to-rose-500/30 border border-red-500/40 text-red-300 font-mono text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer shadow-sm"
            >
              <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
              {checkBan.isPending ? "Testing Ban..." : "Test Ban Status"}
            </button>
            <button
              onClick={fetchProfile}
              disabled={loadingProfile}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 font-mono text-[10px] uppercase tracking-wider rounded-xl transition-all disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingProfile ? "animate-spin" : ""}`} />
              {loadingProfile ? "Syncing..." : "Sync Stats"}
            </button>
            <button
              onClick={handleDeleteCurrentAccount}
              disabled={deleteAcc.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/30 hover:bg-red-600 border border-red-500/60 text-red-200 font-mono text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-300" />
              {deleteAcc.isPending ? "Deleting..." : "Delete Account"}
            </button>
            <button
              onClick={onDisconnect}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/20 hover:bg-red-950/40 border border-red-500/30 hover:border-red-400 text-red-400 font-mono text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              Disconnect
            </button>
          </div>
        </div>

        {/* Anti-Cheat Ban Alert Banner */}
        {profile?.isBanned && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-4 rounded-2xl bg-gradient-to-r from-red-950/80 via-red-900/60 to-rose-950/80 border-2 border-red-500/80 shadow-[0_0_25px_rgba(239,68,68,0.3)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-red-200"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-600/30 border border-red-500/50 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6 text-red-400 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-red-600 text-white animate-pulse">
                    BANNED / RESTRICTED
                  </span>
                  <span className="text-xs text-red-300 font-bold">CarX Anti-Cheat Detection</span>
                </div>
                <p className="text-xs text-red-300/80 mt-1">
                  {profile.banReason || "This account has been flagged or blocked by CarX active security policies."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                onClick={handleRebuildCurrentAccount}
                disabled={rebuildDashboardAcc.isPending}
                className="px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black rounded-xl text-xs font-gaming font-bold uppercase tracking-wider transition-all shadow-[0_0_15px_rgba(245,158,11,0.4)] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rebuildDashboardAcc.isPending ? "animate-spin" : ""}`} />
                {rebuildDashboardAcc.isPending ? "Rebuilding..." : "Rebuild Banned Account"}
              </button>
              <button
                onClick={handleDeleteCurrentAccount}
                disabled={deleteAcc.isPending}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md shrink-0 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleteAcc.isPending ? "Purging..." : "Purge Account"}
              </button>
            </div>
          </motion.div>
        )}

        {/* Live Profile Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatBadge
            label="Cash (Silver)"
            value={profile ? `$${profile.silver.toLocaleString()}` : "Loading..."}
            icon="💵"
            accent="border-emerald-500/40 bg-emerald-950/20"
          />
          <StatBadge
            label="Gold Currency"
            value={profile ? `${profile.gold.toLocaleString()}` : "Loading..."}
            icon="🪙"
            accent="border-amber-500/40 bg-amber-950/20"
          />
          <StatBadge
            label="Player Level"
            value={profile ? `Lv ${profile.level}` : "Loading..."}
            icon="⚡"
            accent="border-blue-500/40 bg-blue-950/20"
          />
          <StatBadge
            label="Garage Cars"
            value={profile ? `${profile.cars} Cars` : "Loading..."}
            icon="🏎️"
            accent="border-purple-500/40 bg-purple-950/20"
            extraBtn={
              profile && profile.cars > 0 ? (
                <button
                  type="button"
                  onClick={() => setFleetModalOpen(true)}
                  className="text-[9px] font-chakra font-bold text-purple-400 hover:text-purple-200 underline cursor-pointer"
                >
                  VIEW FLEET
                </button>
              ) : undefined
            }
          />
          <StatBadge
            label="Houses & Clubs"
            value={profile ? `${profile.real_estates_count} Garages · ${profile.clubs_count} Clubs` : "Loading..."}
            icon="🏠"
            accent="border-cyan-500/40 bg-cyan-950/20"
          />
          <StatBadge
            label="Maps Unlocked"
            value={profile ? `${profile.maps_count ?? 0}/6 Maps` : "Loading..."}
            icon="🗺️"
            accent="border-teal-500/40 bg-teal-950/20"
          />
        </div>

        {profile?.current_car && (
          <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-black/60 border border-purple-500/30 text-xs font-chakra">
            <div className="flex items-center gap-2">
              <span className="text-base">🏎️</span>
              <span className="text-zinc-400">ACTIVE RIDE:</span>
              <strong className="text-purple-300 font-mono uppercase">{profile.current_car}</strong>
              {profile.current_car_id && (
                <span className="text-zinc-500 font-mono">(Slot #{profile.current_car_id})</span>
              )}
            </div>
            <button
              onClick={() => setFleetModalOpen(true)}
              className="text-[11px] font-chakra font-bold text-purple-400 hover:text-purple-300 uppercase underline cursor-pointer"
            >
              Browse Garage Fleet →
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Currency Module */}
        <div className="cyber-card cyber-card-glow-amber rounded-3xl p-5 space-y-4 flex flex-col justify-between border border-amber-500/30">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-xs font-gaming font-bold text-white tracking-wider uppercase">RESOURCE ENGINE</h3>
                  <p className="text-[10px] font-chakra text-amber-300/80">Cash · Gold · EXP</p>
                </div>
              </div>
              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold uppercase">
                Anti-Ban Safe
              </span>
            </div>

            <p className="text-xs font-chakra text-zinc-400 leading-relaxed">
              Inject safe increments directly to account database. Rapid 1-click steppers for fast top-ups.
            </p>

            {/* Quick 1-Click Steppers */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={anyPending}
                onClick={() => handleInjectCurrency({ service_type: "cash", cash: 1000 })}
                className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/40 text-emerald-300 font-bold transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.15)] hover:scale-[1.02]"
              >
                <span className="text-xs font-mono font-black">💵 +1,000</span>
                <span className="text-[9px] font-chakra text-emerald-400/90 uppercase font-bold mt-0.5">Cash</span>
              </button>
              <button
                type="button"
                disabled={anyPending}
                onClick={() => handleInjectCurrency({ service_type: "gold", gold: 1000 })}
                className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-amber-950/40 hover:bg-amber-900/60 border border-amber-500/40 text-amber-300 font-bold transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_15px_rgba(245,158,11,0.15)] hover:scale-[1.02]"
              >
                <span className="text-xs font-mono font-black">🪙 +1,000</span>
                <span className="text-[9px] font-chakra text-amber-400/90 uppercase font-bold mt-0.5">Gold</span>
              </button>
              <button
                type="button"
                disabled={anyPending}
                onClick={() => handleInjectCurrency({ service_type: "exp", exp: 100 })}
                className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/40 text-cyan-300 font-bold transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.15)] hover:scale-[1.02]"
              >
                <span className="text-xs font-mono font-black">⚡ +100</span>
                <span className="text-[9px] font-chakra text-cyan-400/90 uppercase font-bold mt-0.5">EXP</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {CURRENCY_PRESETS.map(({ v, l, sub }) => (
                <button
                  key={v}
                  onClick={() => setCurrencyPreset(v)}
                  className={`flex flex-col items-center py-2 px-1 rounded-xl text-center transition-all border cursor-pointer ${
                    currencyPreset === v
                      ? "bg-amber-500 border-amber-400 text-black font-bold shadow-[0_0_15px_rgba(245,158,11,0.4)]"
                      : "bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  <span className="text-xs font-chakra">{l}</span>
                  <span className={`text-[9px] font-mono mt-0.5 ${currencyPreset === v ? "text-black/80 font-bold" : "text-zinc-500"}`}>{sub}</span>
                </button>
              ))}
            </div>

            <AnimatePresence>
              {currencyPreset === CurrencyInputPreset.custom && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden space-y-2 pt-1"
                >
                  <NumInput label="Cash (Silver)" value={customSilver} onChange={setCustomSilver} min={0} max={1000000} placeholder="1000" icon="🪙" accent="text-zinc-300" />
                  <NumInput label="Gold Coins" value={customGold} onChange={setCustomGold} min={0} max={100000} placeholder="1000" icon="💰" accent="text-amber-400" />
                  <NumInput label="Player EXP" value={customXp} onChange={setCustomXp} min={0} max={100000} placeholder="100" icon="⚡" accent="text-cyan-400" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <button
              data-testid="button-inject-currency"
              onClick={() => handleInjectCurrency()}
              disabled={anyPending}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black font-gaming font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_20px_rgba(245,158,11,0.25)] hover:shadow-[0_0_30px_rgba(245,158,11,0.4)]"
            >
              {injectCurrency.isPending ? (
                <span className="flex items-center justify-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> INJECTING RESOURCES...</span>
              ) : "DEPLOY STEP BUNDLE (+1K CASH, +1K GOLD, +100 EXP)"}
            </button>
            {results.currency && (
              <div className={`flex items-center gap-1.5 text-xs font-mono ${results.currency.ok ? "text-emerald-400" : "text-red-400"}`}>
                {results.currency.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {results.currency.msg}
              </div>
            )}
          </div>
        </div>

        {/* Maps & Real Estate Module */}
        <div className="cyber-card cyber-card-glow-cyan rounded-3xl p-5 space-y-4 flex flex-col justify-between border border-cyan-500/30">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                  <Map className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-xs font-gaming font-bold text-white tracking-wider uppercase">WORLD MAP & REAL ESTATE</h3>
                  <p className="text-[10px] font-chakra text-cyan-300/80">6 Zones · 52 Garages · 22 Clubs</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {profile?.maps_approved ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold uppercase flex items-center gap-1 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> APPROVED ✅ (6/6)
                  </span>
                ) : (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 font-bold uppercase flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-zinc-400" /> {profile ? `${profile.maps_count || 0}/6 UNLOCKED` : "1-CLICK UNLOCK"}
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs font-chakra text-zinc-400 leading-relaxed">
              Unlocks Mountain, Sunset, Port, Suburb & Midtown world map zones plus all 52 player houses and 22 clubs one-by-one under the hood without slot corruption.
            </p>

            <div className="grid grid-cols-2 gap-2 py-1">
              <div className="bg-black/60 border border-cyan-500/30 rounded-xl p-3 text-center">
                <div className="text-[10px] font-chakra font-bold text-zinc-400 uppercase tracking-wider">World Maps</div>
                <div className="text-base font-black text-cyan-300 font-mono mt-0.5">
                  {profile ? `${profile.maps_count ?? 0} / 6 Active` : "6 Zones"}
                </div>
              </div>
              <div className="bg-black/60 border border-purple-500/30 rounded-xl p-3 text-center">
                <div className="text-[10px] font-chakra font-bold text-zinc-400 uppercase tracking-wider">Garages & Clubs</div>
                <div className="text-base font-black text-purple-300 font-mono mt-0.5">
                  {profile ? `${profile.real_estates_count}H · ${profile.clubs_count}C` : "52H · 22C"}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <button
              data-testid="button-unlock-maps-houses"
              onClick={() => unlockMapsHouses.mutate({
                data: {
                  token: session.token,
                  userId: session.carxId,
                  deviceId: session.deviceId,
                  uniqueId: session.uniqueId,
                  service_type: "unlock_maps_houses",
                  unlock_houses: true,
                  unlock_maps: true,
                  userToken
                }
              })}
              disabled={anyPending}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 via-teal-400 to-cyan-400 hover:from-cyan-400 hover:to-teal-300 text-black font-gaming font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 shadow-[0_0_20px_rgba(6,182,212,0.25)] hover:shadow-[0_0_30px_rgba(6,182,212,0.4)] cursor-pointer"
            >
              {unlockMapsHouses.isPending ? (
                <span className="flex items-center justify-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> UNLOCKING MAPS & HOUSES...
                </span>
              ) : (
                "🗺️ UNLOCK ALL MAPS & HOUSES (1-CLICK)"
              )}
            </button>
            {results.mapsHouses && (
              <div className={`flex items-center gap-1.5 text-xs font-mono ${results.mapsHouses.ok ? "text-emerald-400" : "text-red-400"}`}>
                {results.mapsHouses.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {results.mapsHouses.msg}
              </div>
            )}
          </div>
        </div>

        {/* Vehicles Injection */}
        <div className="cyber-card cyber-card-glow-purple rounded-3xl p-5 space-y-4 flex flex-col justify-between border border-purple-500/30">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
                  <Car className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-xs font-gaming font-bold text-white tracking-wider uppercase">VEHICLE FLEET DECK (89 CARS)</h3>
                  <p className="text-[10px] font-chakra text-purple-300/80">Original 89 Meta Cars · Pro Tunes</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFleetModalOpen(true)}
                className="text-[9px] font-chakra font-bold text-purple-400 hover:text-purple-200 underline cursor-pointer uppercase"
              >
                Browse Fleet ({profile?.cars || 0}) →
              </button>
            </div>

            <p className="text-xs font-chakra text-zinc-400 leading-relaxed">
              Injects the original 89 CarX meta vehicles into account garage slots with verified CarX physics & ratings.
            </p>

            <div className="grid grid-cols-2 gap-1.5">
              {CAR_MODES.map(({ v, l, sub }) => (
                <button
                  key={v}
                  onClick={() => setCarsMode(v)}
                  className={`flex flex-col items-center py-2 px-1 rounded-xl text-center transition-all border cursor-pointer ${
                    carsMode === v
                      ? "bg-purple-600 border-purple-400 text-white font-bold shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                      : "bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  <span className="text-xs font-chakra">{l}</span>
                  <span className={`text-[9px] font-mono mt-0.5 ${carsMode === v ? "text-purple-200" : "text-zinc-500"}`}>{sub}</span>
                </button>
              ))}
            </div>

            <AnimatePresence>
              {carsMode === CarsInjectInputMode.custom && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden pt-1"
                >
                  <NumInput
                    label="Car Count to Inject"
                    value={customCarCount}
                    onChange={setCustomCarCount}
                    min={1}
                    max={totalCars || 89}
                    placeholder="50"
                    icon="🏎️"
                    accent="text-purple-300"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <button
              data-testid="button-inject-cars"
              onClick={handleInjectCars}
              disabled={anyPending}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 via-fuchsia-600 to-purple-500 hover:from-purple-500 hover:to-fuchsia-500 text-white font-gaming font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 shadow-[0_0_20px_rgba(168,85,247,0.25)] hover:shadow-[0_0_30px_rgba(168,85,247,0.4)] cursor-pointer"
            >
              {injectCars.isPending ? (
                <span className="flex items-center justify-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> INJECTING VEHICLES...</span>
              ) : carsMode === CarsInjectInputMode.all ? "🚗 INJECT ALL 89 CARS TO GARAGE" : "🚗 INJECT CARS TO GARAGE"}
            </button>
            {results.cars && (
              <div className={`flex items-center gap-1.5 text-xs font-mono ${results.cars.ok ? "text-emerald-400" : "text-red-400"}`}>
                {results.cars.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {results.cars.msg}
              </div>
            )}
          </div>
        </div>

        {/* Anti-Cheat & Active Token Ban Detector */}
        <div className="cyber-card cyber-card-glow-red rounded-3xl p-5 space-y-4 flex flex-col justify-between border border-red-500/30">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                  <ShieldAlert className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <h3 className="text-xs font-gaming font-bold text-white tracking-wider uppercase">ANTI-CHEAT BAN DETECTOR</h3>
                  <p className="text-[10px] font-chakra text-red-300/80">Active Token Probe · Restriction Test</p>
                </div>
              </div>
              <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border font-bold uppercase ${
                profile?.isBanned || banCheckResult?.isBanned
                  ? "bg-red-500/20 text-red-300 border-red-500/40 animate-pulse"
                  : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
              }`}>
                {profile?.isBanned || banCheckResult?.isBanned ? "🚨 BANNED" : "🛡️ ACTIVE / CLEAN"}
              </span>
            </div>

            <p className="text-xs font-chakra text-zinc-400 leading-relaxed">
              Test active CarX session token against anti-cheat servers to verify suspension flags, restriction status, and multiplayer matchmaking standing.
            </p>

            <div className="space-y-2">
              <label className="text-[11px] font-chakra font-bold text-zinc-400 flex items-center justify-between uppercase tracking-wider">
                <span>Active Token to Test</span>
                {session.token && (
                  <button
                    type="button"
                    onClick={() => setTokenToProbe(session.token)}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 font-mono font-bold cursor-pointer"
                  >
                    Use Current Session
                  </button>
                )}
              </label>
              <input
                type="text"
                value={tokenToProbe}
                onChange={(e) => setTokenToProbe(e.target.value)}
                placeholder="Paste active CarX session token..."
                className="w-full bg-zinc-900/90 border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-400 font-mono"
              />
            </div>

            {banCheckResult && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`p-4 rounded-2xl border-2 text-xs font-chakra space-y-2.5 shadow-2xl ${
                  banCheckResult.isBanned
                    ? "bg-zinc-950 border-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.45)] ring-1 ring-red-500/50"
                    : "bg-zinc-950 border-emerald-400 text-white shadow-[0_0_30px_rgba(52,211,153,0.35)] ring-1 ring-emerald-500/50"
                }`}
              >
                <div className="flex items-center justify-between font-bold pb-2 border-b border-zinc-800">
                  <span className="flex items-center gap-2 text-sm uppercase font-gaming tracking-wide">
                    {banCheckResult.isBanned ? (
                      <span className="text-red-400 flex items-center gap-1.5 font-black">
                        🚨 BANNED / RESTRICTED
                      </span>
                    ) : (
                      <span className="text-emerald-400 flex items-center gap-1.5 font-black">
                        🛡️ ACTIVE & CLEAN (SAFE)
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded-md border border-zinc-800">
                    {banCheckResult.timestamp}
                  </span>
                </div>

                {/* Copyable Gmail in Result Box */}
                {session.email && (
                  <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-zinc-900/90 border border-zinc-700/80">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs">📧</span>
                      <span className="font-mono text-xs font-bold text-amber-300 truncate select-all">
                        {session.email}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(session.email);
                        setCopiedBanEmail(true);
                        setTimeout(() => setCopiedBanEmail(false), 2000);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 border border-amber-500/40 text-[10px] font-mono font-bold flex items-center gap-1 transition-all cursor-pointer shrink-0"
                    >
                      {copiedBanEmail ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      {copiedBanEmail ? "Copied!" : "Copy Gmail"}
                    </button>
                  </div>
                )}

                <div className="text-xs font-mono text-zinc-100 bg-black/60 p-2.5 rounded-xl border border-zinc-800/80 leading-relaxed break-words">
                  <span className="text-[10px] font-chakra font-bold text-zinc-400 uppercase tracking-widest block mb-1">
                    DIAGNOSTIC REPORT:
                  </span>
                  {banCheckResult.banReason || (banCheckResult.isBanned ? "Account flagged by CarX anti-cheat security filters." : "No ban flags detected. Account active on game servers.")}
                </div>
              </motion.div>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <button
              onClick={() => handleRunBanCheck()}
              disabled={checkBan.isPending || !tokenToProbe.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-red-600 via-rose-600 to-red-500 hover:from-red-500 hover:to-rose-500 text-white font-gaming font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 shadow-[0_0_20px_rgba(239,68,68,0.25)] hover:shadow-[0_0_30px_rgba(239,68,68,0.4)] cursor-pointer"
            >
              {checkBan.isPending ? (
                <span className="flex items-center justify-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> PROBING ANTI-CHEAT STATUS...
                </span>
              ) : (
                "🛡️ TEST ACTIVE TOKEN BAN STATUS"
              )}
            </button>
          </div>
        </div>

        {/* Street Pass Module */}
        <div className="cyber-card cyber-card-glow-amber rounded-3xl p-5 space-y-4 flex flex-col justify-between border border-yellow-500/30">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center">
                  <Star className="w-4 h-4 text-yellow-400" />
                </div>
                <div>
                  <h3 className="text-xs font-gaming font-bold text-white tracking-wider uppercase">STREET PASS // SEASON</h3>
                  <p className="text-[10px] font-chakra text-yellow-300/80">Battle Pass · Tier Rewards · EP Boost</p>
                </div>
              </div>
              <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border font-bold uppercase ${
                profile?.streetPass
                  ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/40"
                  : "bg-zinc-800 text-zinc-500 border-zinc-700"
              }`}>
                {profile?.streetPass ? "ACTIVE PASS" : "LOCKED"}
              </span>
            </div>
            <p className="text-xs font-chakra text-zinc-400 leading-relaxed">
              Unlocks the premium Street Pass track, level rewards, and bonus event points immediately.
            </p>

            {/* High ban risk warning banner */}
            <div className="p-2.5 rounded-xl bg-red-950/40 border border-red-500/40 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="text-[10px] font-gaming font-bold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>HIGH BAN RISK WARNING</span>
                  <span className="bg-red-500/30 text-red-300 text-[8px] px-1.5 py-0.2 rounded font-mono font-bold">ELEVATED</span>
                </div>
                <p className="text-[10px] font-chakra text-red-200/90 leading-tight">
                  Injecting Street Pass carries a significantly higher ban detection rate on modern CarX servers. Proceed with extreme caution.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <button
              data-testid="button-unlock-streetpass"
              onClick={() => {
                if (!window.confirm("⚠️ HIGH BAN RISK WARNING:\n\nInjecting Street Pass currently has a very high ban rate on official CarX Street servers.\n\nAre you sure you want to proceed?")) return;
                unlockStreetPass.mutate({
                  data: {
                    token: session.token,
                    userId: session.carxId,
                    deviceId: session.deviceId,
                    uniqueId: session.uniqueId,
                    service_type: "battlepass",
                    unlock_streetpass: true,
                    userToken
                  }
                });
              }}
              disabled={anyPending}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-400 hover:from-yellow-400 hover:to-amber-300 text-black font-gaming font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 shadow-[0_0_20px_rgba(234,179,8,0.25)] hover:shadow-[0_0_30px_rgba(234,179,8,0.4)] cursor-pointer"
            >
              {unlockStreetPass.isPending ? (
                <span className="flex items-center justify-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> UNLOCKING STREET PASS...</span>
              ) : "⭐ UNLOCK STREET PASS & REWARDS"}
            </button>
            {results.streetPass && (
              <div className={`flex items-center gap-1.5 text-xs font-mono ${results.streetPass.ok ? "text-emerald-400" : "text-red-400"}`}>
                {results.streetPass.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {results.streetPass.msg}
              </div>
            )}
          </div>
        </div>

        {/* Cosmetics Module */}
        <div className="cyber-card cyber-card-glow-pink rounded-3xl p-5 space-y-4 flex flex-col justify-between border border-pink-500/30">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-pink-500/10 border border-pink-500/30 flex items-center justify-center">
                  <User className="w-4 h-4 text-pink-400" />
                </div>
                <div>
                  <h3 className="text-xs font-gaming font-bold text-white tracking-wider uppercase">DRIVER IDENTITY & STYLE</h3>
                  <p className="text-[10px] font-chakra text-pink-300/80">Avatars · Frames · Banners</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {profile?.profile_styles_approved ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold uppercase flex items-center gap-1 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> APPROVED ✅ (20/20)
                  </span>
                ) : (profile?.avatars_count || 0) > 0 ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold uppercase flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-amber-400" /> {profile?.avatars_count}/20 SETS
                  </span>
                ) : (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30 font-bold uppercase">
                    20 Sets
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs font-chakra text-zinc-400 leading-relaxed">
              Inject custom profile avatars, frames & banners one by one like cars or unlock all 20 sets at once.
            </p>

            <div className="grid grid-cols-2 gap-1.5">
              {COSMETICS_MODES.map(({ v, l, sub }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setCosmeticsMode(v)}
                  className={`flex flex-col items-center py-2 px-1 rounded-xl text-center transition-all border cursor-pointer ${
                    cosmeticsMode === v
                      ? "bg-pink-600 border-pink-400 text-white font-bold shadow-[0_0_15px_rgba(236,72,153,0.3)]"
                      : "bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  <span className="text-xs font-chakra">{l}</span>
                  <span className={`text-[9px] font-mono mt-0.5 ${cosmeticsMode === v ? "text-pink-200" : "text-zinc-500"}`}>{sub}</span>
                </button>
              ))}
            </div>

            <AnimatePresence>
              {cosmeticsMode === "custom" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden pt-1"
                >
                  <NumInput
                    label="Sets Count to Unlock"
                    value={customCosmeticCount}
                    onChange={setCustomCosmeticCount}
                    min={1}
                    max={20}
                    placeholder="1"
                    icon="🎨"
                    accent="text-pink-300"
                  />
                </motion.div>
              )}

              {cosmeticsMode === "specific" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden space-y-1 pt-1"
                >
                  <label className="text-[11px] font-chakra font-bold text-zinc-400 flex items-center justify-between uppercase tracking-wider">
                    <span>🎯 Choose Specific Set</span>
                  </label>
                  <select
                    value={selectedCosmeticSet}
                    onChange={(e) => setSelectedCosmeticSet(Number(e.target.value))}
                    className="w-full bg-zinc-900/90 border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500/80 transition-all font-mono cursor-pointer"
                  >
                    {COSMETIC_SETS_OPTIONS.map(opt => (
                      <option key={opt.id} value={opt.id} className="bg-zinc-900 text-white">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <button
              data-testid="button-unlock-avatars"
              onClick={handleInjectProfileStyle}
              disabled={anyPending}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-600 via-rose-500 to-pink-500 hover:from-pink-500 hover:to-rose-400 text-white font-gaming font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_20px_rgba(236,72,153,0.25)] hover:shadow-[0_0_30px_rgba(236,72,153,0.4)]"
            >
              {unlockProfileStyle.isPending ? (
                <span className="flex items-center justify-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  {cosmeticsMode === "next" ? "UNLOCKING NEXT SET..." : "INJECTING COSMETICS..."}
                </span>
              ) : (
                cosmeticsMode === "next"
                  ? "👤 UNLOCK NEXT AVATAR & FRAME (+1)"
                  : cosmeticsMode === "custom"
                  ? `👤 INJECT ${customCosmeticCount || 1} SETS (ONE-BY-ONE)`
                  : cosmeticsMode === "specific"
                  ? `👤 EQUIP SET #${selectedCosmeticSet}`
                  : "👤 UNLOCK ALL 20 AVATARS & FRAMES"
              )}
            </button>
            {results.profileStyle && (
              <div className={`flex items-center gap-1.5 text-xs font-mono ${results.profileStyle.ok ? "text-emerald-400" : "text-red-400"}`}>
                {results.profileStyle.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {results.profileStyle.msg}
              </div>
            )}
          </div>
        </div>

        {/* Neon Lights Underglow Module */}
        <div className="cyber-card cyber-card-glow-cyan rounded-3xl p-5 space-y-4 flex flex-col justify-between border border-cyan-500/30">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-xs font-gaming font-bold text-white tracking-wider uppercase">NEON UNDERGLOW</h3>
                  <p className="text-[10px] font-chakra text-cyan-300/80">Animated 1-15 & Static Chassis Kits</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {profile?.neons_approved ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold uppercase flex items-center gap-1 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> APPROVED ✅ (15/15)
                  </span>
                ) : (profile?.neons_count || 0) > 0 ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold uppercase flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-amber-400" /> {profile?.neons_count}/15 KITS
                  </span>
                ) : (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold uppercase">
                    15 Kits
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs font-chakra text-zinc-400 leading-relaxed">
              Unlock RGB animated and static chassis neon lighting kits one-by-one or all 15 kits in Battle Pass and garage styling.
            </p>

            <div className="grid grid-cols-3 gap-1.5">
              {NEON_MODES.map(({ v, l, sub }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setNeonOption(v)}
                  className={`flex flex-col items-center py-2 px-1 rounded-xl text-center transition-all border cursor-pointer ${
                    neonOption === v
                      ? "bg-cyan-600 border-cyan-400 text-white font-bold shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                      : "bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  <span className="text-xs font-chakra">{l}</span>
                  <span className={`text-[9px] font-mono mt-0.5 ${neonOption === v ? "text-cyan-200" : "text-zinc-500"}`}>{sub}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleInjectNeon("next", 1)}
                disabled={anyPending}
                className="py-2.5 px-2 rounded-xl bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 font-gaming font-bold text-[11px] tracking-wider uppercase transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_10px_rgba(6,182,212,0.15)] flex items-center justify-center gap-1"
              >
                ⚡ NEXT (+1)
              </button>
              <button
                type="button"
                onClick={() => handleInjectNeon("all")}
                disabled={anyPending}
                className="py-2.5 px-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 hover:from-cyan-500 hover:to-teal-400 text-white font-gaming font-bold text-[11px] tracking-wider uppercase transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.3)] flex items-center justify-center gap-1"
              >
                🚀 ALL (15)
              </button>
            </div>
            <button
              data-testid="button-unlock-neon"
              onClick={() => handleInjectNeon()}
              disabled={anyPending}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-600 via-teal-500 to-cyan-500 hover:from-cyan-500 hover:to-teal-400 text-white font-gaming font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_20px_rgba(6,182,212,0.25)] hover:shadow-[0_0_30px_rgba(6,182,212,0.4)]"
            >
              {unlockNeon.isPending ? (
                <span className="flex items-center justify-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  INJECTING NEON...
                </span>
              ) : (
                neonOption === "next" ? "⚡ INJECT NEXT NEON (+1 ONE-BY-ONE)" : `💡 INJECT NEON (${neonOption.toUpperCase()})`
              )}
            </button>
            {results.neon && (
              <div className={`flex items-center gap-1.5 text-xs font-mono ${results.neon.ok ? "text-emerald-400" : "text-red-400"}`}>
                {results.neon.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {results.neon.msg}
              </div>
            )}
          </div>
        </div>

        {/* All Tire Sidewalls Module */}
        <div className="cyber-card cyber-card-glow-amber rounded-3xl p-5 space-y-4 flex flex-col justify-between border border-amber-500/30">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                  <Disc className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-xs font-gaming font-bold text-white tracking-wider uppercase">TIRE SIDEWALLS</h3>
                  <p className="text-[10px] font-chakra text-amber-300/80">All 14 Branded Tires & Battle Pass</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {profile?.tire_walls_approved ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold uppercase flex items-center gap-1 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> APPROVED ✅ (14/14)
                  </span>
                ) : (profile?.tire_walls_count || 0) > 0 ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold uppercase flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-amber-400" /> {profile?.tire_walls_count}/14 TIRES
                  </span>
                ) : (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold uppercase">
                    14 Tires
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs font-chakra text-zinc-400 leading-relaxed">
              Inject Faster, DriftHunters, GripX, Shinobi, Toccata, Donuts and yellow brand lettering one-by-one or all at once.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {TIRE_MODES.map(({ v, l, sub }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTireOption(v)}
                  className={`flex flex-col items-center py-2 px-1 rounded-xl text-center transition-all border cursor-pointer ${
                    tireOption === v
                      ? "bg-amber-600 border-amber-400 text-white font-bold shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                      : "bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  <span className="text-xs font-chakra">{l}</span>
                  <span className={`text-[9px] font-mono mt-0.5 ${tireOption === v ? "text-amber-200" : "text-zinc-500"}`}>{sub}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleInjectTireWalls("next", 1)}
                disabled={anyPending}
                className="py-2.5 px-2 rounded-xl bg-amber-950/80 hover:bg-amber-900 border border-amber-500/50 text-amber-200 font-gaming font-bold text-[11px] tracking-wider uppercase transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_10px_rgba(245,158,11,0.15)] flex items-center justify-center gap-1"
              >
                ⚡ NEXT (+1)
              </button>
              <button
                type="button"
                onClick={() => handleInjectTireWalls("all")}
                disabled={anyPending}
                className="py-2.5 px-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white font-gaming font-bold text-[11px] tracking-wider uppercase transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_15px_rgba(245,158,11,0.3)] flex items-center justify-center gap-1"
              >
                🚀 ALL (14)
              </button>
            </div>
            <button
              data-testid="button-unlock-tire-walls"
              onClick={() => handleInjectTireWalls()}
              disabled={anyPending}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 via-orange-500 to-amber-500 hover:from-amber-500 hover:to-orange-400 text-white font-gaming font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_20px_rgba(245,158,11,0.25)] hover:shadow-[0_0_30px_rgba(245,158,11,0.4)]"
            >
              {unlockTireWalls.isPending ? (
                <span className="flex items-center justify-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  INJECTING SIDEWALLS...
                </span>
              ) : (
                tireOption === "next" ? "⚡ INJECT NEXT SIDEWALL (+1 ONE-BY-ONE)" : `🛞 INJECT SIDEWALLS (${tireOption.toUpperCase()})`
              )}
            </button>
            {results.tireWalls && (
              <div className={`flex items-center gap-1.5 text-xs font-mono ${results.tireWalls.ok ? "text-emerald-400" : "text-red-400"}`}>
                {results.tireWalls.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {results.tireWalls.msg}
              </div>
            )}
          </div>
        </div>

        {/* Custom Number Plates Module */}
        <div className="cyber-card cyber-card-glow-purple rounded-3xl p-5 space-y-4 flex flex-col justify-between border border-purple-500/30">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
                  <Hash className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-xs font-gaming font-bold text-white tracking-wider uppercase">NUMBER PLATES</h3>
                  <p className="text-[10px] font-chakra text-purple-300/80">74+ Custom, JDM & Event Vanity Plates</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {profile?.plates_approved ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold uppercase flex items-center gap-1 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> APPROVED ✅ ({profile?.plates_count}/74)
                  </span>
                ) : (profile?.plates_count || 0) > 0 ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold uppercase flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-amber-400" /> {profile?.plates_count}/74 PLATES
                  </span>
                ) : (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold uppercase">
                    74 Plates
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs font-chakra text-zinc-400 leading-relaxed">
              Unlock Akuma Gold, Oni Graffiti, Lunar Carnival, Halloween, Championship and classic vanity plates one-by-one or all at once.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {PLATE_MODES.map(({ v, l, sub }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPlateOption(v)}
                  className={`flex flex-col items-center py-2 px-1 rounded-xl text-center transition-all border cursor-pointer ${
                    plateOption === v
                      ? "bg-purple-600 border-purple-400 text-white font-bold shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                      : "bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  <span className="text-xs font-chakra">{l}</span>
                  <span className={`text-[9px] font-mono mt-0.5 ${plateOption === v ? "text-purple-200" : "text-zinc-500"}`}>{sub}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleInjectNumberPlates("next", 1)}
                disabled={anyPending}
                className="py-2.5 px-2 rounded-xl bg-purple-950/80 hover:bg-purple-900 border border-purple-500/50 text-purple-200 font-gaming font-bold text-[11px] tracking-wider uppercase transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_10px_rgba(168,85,247,0.15)] flex items-center justify-center gap-1"
              >
                ⚡ NEXT (+1)
              </button>
              <button
                type="button"
                onClick={() => handleInjectNumberPlates("all")}
                disabled={anyPending}
                className="py-2.5 px-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-500 hover:from-purple-500 hover:to-indigo-400 text-white font-gaming font-bold text-[11px] tracking-wider uppercase transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_15px_rgba(168,85,247,0.3)] flex items-center justify-center gap-1"
              >
                🚀 ALL (74+)
              </button>
            </div>
            <button
              data-testid="button-unlock-number-plates"
              onClick={() => handleInjectNumberPlates()}
              disabled={anyPending}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-500 to-purple-500 hover:from-purple-500 hover:to-indigo-400 text-white font-gaming font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_20px_rgba(168,85,247,0.25)] hover:shadow-[0_0_30px_rgba(168,85,247,0.4)]"
            >
              {unlockNumberPlates.isPending ? (
                <span className="flex items-center justify-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  INJECTING PLATES...
                </span>
              ) : (
                plateOption === "next" ? "⚡ INJECT NEXT PLATE (+1 ONE-BY-ONE)" : `🔢 INJECT PLATES (${plateOption.toUpperCase()})`
              )}
            </button>
            {results.numberPlates && (
              <div className={`flex items-center gap-1.5 text-xs font-mono ${results.numberPlates.ok ? "text-emerald-400" : "text-red-400"}`}>
                {results.numberPlates.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {results.numberPlates.msg}
              </div>
            )}
          </div>
        </div>

        {/* Wheel Rims Module */}
        <div className="cyber-card cyber-card-glow-blue rounded-3xl p-5 space-y-4 flex flex-col justify-between border border-blue-500/30">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                  <Layers className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-xs font-gaming font-bold text-white tracking-wider uppercase">WHEEL RIMS</h3>
                  <p className="text-[10px] font-chakra text-blue-300/80">412+ Rims & Battle Pass Exclusives</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {profile?.rims_approved ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold uppercase flex items-center gap-1 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> APPROVED ✅ ({profile?.rims_count} Rims)
                  </span>
                ) : (profile?.rims_count || 0) > 0 ? (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold uppercase flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-amber-400" /> {profile?.rims_count} RIMS
                  </span>
                ) : (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold uppercase">
                    412 Rims
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs font-chakra text-zinc-400 leading-relaxed">
              Inject all 400+ aftermarket tuner rims, 3-piece wheels, and 110 Battle Pass exclusive rim designs one-by-one or all at once.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {RIM_MODES.map(({ v, l, sub }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setRimOption(v)}
                  className={`flex flex-col items-center py-2 px-1 rounded-xl text-center transition-all border cursor-pointer ${
                    rimOption === v
                      ? "bg-blue-600 border-blue-400 text-white font-bold shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                      : "bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  <span className="text-xs font-chakra">{l}</span>
                  <span className={`text-[9px] font-mono mt-0.5 ${rimOption === v ? "text-blue-200" : "text-zinc-500"}`}>{sub}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleInjectWheelRims("next", 1)}
                disabled={anyPending}
                className="py-2.5 px-2 rounded-xl bg-blue-950/80 hover:bg-blue-900 border border-blue-500/50 text-blue-200 font-gaming font-bold text-[11px] tracking-wider uppercase transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_10px_rgba(59,130,246,0.15)] flex items-center justify-center gap-1"
              >
                ⚡ NEXT (+1)
              </button>
              <button
                type="button"
                onClick={() => handleInjectWheelRims("all")}
                disabled={anyPending}
                className="py-2.5 px-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-gaming font-bold text-[11px] tracking-wider uppercase transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_15px_rgba(59,130,246,0.3)] flex items-center justify-center gap-1"
              >
                🚀 ALL (412+)
              </button>
            </div>
            <button
              data-testid="button-unlock-wheel-rims"
              onClick={() => handleInjectWheelRims()}
              disabled={anyPending}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-500 hover:from-blue-500 hover:to-cyan-400 text-white font-gaming font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 cursor-pointer shadow-[0_0_20px_rgba(59,130,246,0.25)] hover:shadow-[0_0_30px_rgba(59,130,246,0.4)]"
            >
              {unlockWheelRims.isPending ? (
                <span className="flex items-center justify-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  INJECTING RIMS...
                </span>
              ) : (
                rimOption === "next" ? "⚡ INJECT NEXT RIM (+1 ONE-BY-ONE)" : `🏎️ INJECT RIMS (${rimOption.toUpperCase()})`
              )}
            </button>
            {results.wheelRims && (
              <div className={`flex items-center gap-1.5 text-xs font-mono ${results.wheelRims.ok ? "text-emerald-400" : "text-red-400"}`}>
                {results.wheelRims.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {results.wheelRims.msg}
              </div>
            )}
          </div>
        </div>

        {/* Safe Repair Module */}
        <div className="cyber-card cyber-card-glow-emerald rounded-3xl p-5 space-y-4 flex flex-col justify-between border border-emerald-500/30">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <RefreshCw className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-xs font-gaming font-bold text-white tracking-wider uppercase">PIT-STOP SAFE REPAIR</h3>
                  <p className="text-[10px] font-chakra text-emerald-300/80">Fix "Checking Profile" · Reset Slot Tables</p>
                </div>
              </div>
              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold uppercase">
                Diagnostic
              </span>
            </div>
            <p className="text-xs font-chakra text-zinc-400 leading-relaxed">
              Repairs corrupt garage slots, unbinds conflicting ghost cars, and repairs game account tables back to safe verified database defaults.
            </p>
          </div>

          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <button
              data-testid="button-clean-rewrite"
              onClick={handleCleanRewrite}
              disabled={anyPending}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-black font-gaming font-black text-xs uppercase tracking-wider transition-all disabled:opacity-40 shadow-[0_0_25px_rgba(6,182,212,0.35)] hover:shadow-[0_0_35px_rgba(6,182,212,0.5)] cursor-pointer flex items-center justify-center gap-2"
            >
              {cleanRewriteAcc.isPending ? (
                <span className="flex items-center justify-center gap-1.5"><RefreshCw className="w-4 h-4 animate-spin text-black" /> REWRITING CLEAN JSON BLUEPRINT...</span>
              ) : "🧹 REWRITE CLEAN JSON // FIX REPORT ERROR"}
            </button>
            <button
              data-testid="button-safe-repair"
              onClick={() => {
                if (window.confirm("🩹 WARNING: This will reset your garage to 1 starting car, beat all clubs, and repair all slot tables to 100% valid game database values. Use this if your game is stuck on 'Checking profile'. Proceed?")) {
                  safeRepair.mutate({
                    data: {
                      token: session.token,
                      userId: session.carxId,
                      deviceId: session.deviceId,
                      uniqueId: session.uniqueId,
                      service_type: "safe_repair",
                      userToken
                    }
                  });
                }
              }}
              disabled={anyPending}
              className="w-full py-2.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-emerald-500/30 text-emerald-300 font-chakra font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
            >
              {safeRepair.isPending ? (
                <span className="flex items-center justify-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> REPAIRING ACCOUNT...</span>
              ) : "🔧 EMERGENCY RESET GARAGE / PURGE SLOTS"}
            </button>
            {results.cleanRewrite && (
              <div className={`flex items-center gap-1.5 text-xs font-mono ${results.cleanRewrite.ok ? "text-emerald-400" : "text-red-400"}`}>
                {results.cleanRewrite.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {results.cleanRewrite.msg}
              </div>
            )}
            {results.safeRepair && (
              <div className={`flex items-center gap-1.5 text-xs font-mono ${results.safeRepair.ok ? "text-emerald-400" : "text-red-400"}`}>
                {results.safeRepair.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {results.safeRepair.msg}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Master Overclock Inject All Button */}
      <button
        data-testid="button-inject-all"
        onClick={() => injectAll.mutate({
          data: {
            token: session.token,
            userId: session.carxId,
            deviceId: session.deviceId,
            uniqueId: session.uniqueId,
            service_type: "inject_all",
            userToken
          }
        })}
        disabled={anyPending}
        className="w-full py-4.5 rounded-2xl font-gaming font-black text-sm sm:text-base tracking-widest uppercase bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-400 text-black hover:from-amber-400 hover:to-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_0_40px_rgba(245,158,11,0.4)] hover:shadow-[0_0_60px_rgba(245,158,11,0.65)] hover:scale-[1.008] cursor-pointer"
      >
        {injectAll.isPending ? (
          <span className="flex items-center justify-center gap-3">
            <Zap className="w-5 h-5 animate-bounce" />
            OVERCLOCKING ALL SYSTEMS // INJECTING EVERYTHING...
          </span>
        ) : (
          <span className="flex items-center justify-center gap-3">
            <Zap className="w-5 h-5 fill-current" />
            OVERCLOCK ALL SYSTEMS // FULL INJECTION (MAPS + HOUSES + CARS + PASS + STYLE)
          </span>
        )}
      </button>

      {/* High-Visibility Ban Check Popup Modal */}
      {banModalOpen && banCheckResult && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className={`cyber-card rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-[0_0_60px_rgba(0,0,0,0.95)] border-2 space-y-5 ${
            banCheckResult.isBanned
              ? "border-red-500 shadow-[0_0_45px_rgba(239,68,68,0.5)] bg-zinc-950"
              : "border-emerald-400 shadow-[0_0_45px_rgba(52,211,153,0.45)] bg-zinc-950"
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border ${
                  banCheckResult.isBanned ? "bg-red-500/20 border-red-500/50 text-red-400" : "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                }`}>
                  {banCheckResult.isBanned ? <ShieldAlert className="w-6 h-6 animate-pulse" /> : <ShieldCheck className="w-6 h-6 text-emerald-400" />}
                </div>
                <div>
                  <h3 className="text-sm font-gaming font-bold text-white tracking-wider uppercase">
                    ANTI-CHEAT DIAGNOSTIC
                  </h3>
                  <p className="text-[10px] font-mono text-zinc-400">{banCheckResult.timestamp}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBanModalOpen(false)}
                className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Status Banner */}
            <div className={`p-4 rounded-2xl border-2 flex items-center justify-between gap-3 ${
              banCheckResult.isBanned
                ? "bg-red-600/20 border-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                : "bg-emerald-600/20 border-emerald-400 text-white shadow-[0_0_20px_rgba(52,211,153,0.3)]"
            }`}>
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{banCheckResult.isBanned ? "🚨" : "🛡️"}</span>
                <div>
                  <div className="text-xs font-gaming font-black tracking-wider uppercase">
                    {banCheckResult.isBanned ? "ACCOUNT IS BANNED / RESTRICTED" : "ACCOUNT IS 100% CLEAN & ACTIVE"}
                  </div>
                  <div className="text-[11px] text-zinc-300 font-mono mt-0.5">
                    {banCheckResult.isBanned ? "Flagged on CarX Anti-Cheat Telemetry" : "Safe for all multiplayer & event lobbies"}
                  </div>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider border ${
                banCheckResult.isBanned ? "bg-red-600 text-white border-red-400" : "bg-emerald-500 text-black border-emerald-300"
              }`}>
                {banCheckResult.statusText || (banCheckResult.isBanned ? "BANNED" : "CLEAN")}
              </span>
            </div>

            {/* Copyable Gmail / Email Box */}
            <div className="bg-black/90 border border-zinc-800 rounded-2xl p-4 space-y-2">
              <span className="text-[10px] font-chakra font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span>ACCOUNT EMAIL // GMAIL</span>
                <span className="text-zinc-500 font-mono text-[9px]">Click button to copy</span>
              </span>
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-zinc-900 border border-zinc-700/80">
                <span className="font-mono text-xs font-bold text-amber-300 truncate select-all">
                  {session.email || "No email bound"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (session.email) {
                      navigator.clipboard.writeText(session.email);
                      setCopiedBanEmail(true);
                      setTimeout(() => setCopiedBanEmail(false), 2000);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 border border-amber-500/40 text-[11px] font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
                >
                  {copiedBanEmail ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedBanEmail ? "Copied!" : "Copy Gmail"}
                </button>
              </div>
            </div>

            {/* Reason details */}
            <div className="bg-black/70 border border-zinc-800 rounded-2xl p-4 space-y-1.5">
              <span className="text-[10px] font-chakra font-bold text-zinc-400 uppercase tracking-wider">
                ANTI-CHEAT SERVER RESPONSE
              </span>
              <p className="text-xs font-mono text-zinc-200 leading-relaxed break-words">
                {banCheckResult.banReason || "No anti-cheat violations or active bans found on this account."}
              </p>
            </div>

            {/* Token preview */}
            {banCheckResult.checkedToken && (
              <div className="bg-black/70 border border-zinc-800 rounded-2xl p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-chakra font-bold text-zinc-400 uppercase tracking-wider">
                    PROBED ACTIVE TOKEN
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (banCheckResult.checkedToken) {
                        navigator.clipboard.writeText(banCheckResult.checkedToken);
                        setCopiedBanToken(true);
                        setTimeout(() => setCopiedBanToken(false), 2000);
                      }
                    }}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 font-mono font-bold flex items-center gap-1 cursor-pointer"
                  >
                    {copiedBanToken ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedBanToken ? "Copied Token!" : "Copy Token"}
                  </button>
                </div>
                <div className="text-[11px] font-mono text-zinc-400 truncate select-all">
                  {banCheckResult.checkedToken}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setBanModalOpen(false)}
              className="w-full py-3.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-gaming font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md"
            >
              CLOSE DIAGNOSTIC
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InjectSite({ adminOverrideToken, hideHeader }: { adminOverrideToken?: string; hideHeader?: boolean } = {}) {
  const { token, clearAuth } = useAuth();
  const [session, setSession] = useState<CarXSession | null>(() => {
    try {
      const saved = localStorage.getItem("connectedCarXSession");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const handleSetSession = (s: CarXSession | null) => {
    setSession(s);
    try {
      if (s) {
        localStorage.setItem("connectedCarXSession", JSON.stringify(s));
      } else {
        localStorage.removeItem("connectedCarXSession");
      }
    } catch {}
  };

  const userToken = adminOverrideToken || token || "";

  return (
    <div className={hideHeader ? "w-full" : "min-h-screen bg-[#030308] text-white relative overflow-x-hidden selection:bg-amber-500 selection:text-black"}>
      {!hideHeader && (
        <>
          <div className="cyber-grid-container opacity-40" />
          <div className="neon-orb orb-cyan" />
          <div className="neon-orb orb-fuchsia" />
          <div className="neon-orb orb-yellow" />
        </>
      )}

      <div className={`relative z-10 mx-auto transition-all ${session ? "max-w-6xl" : "max-w-2xl"} ${hideHeader ? "py-2" : "px-4 sm:px-6 py-8"}`}>
        {!hideHeader && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-5 border-b border-zinc-800/80">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl overflow-hidden border border-amber-500/50 flex items-center justify-center shadow-[0_0_25px_rgba(245,158,11,0.35)] bg-black shrink-0 relative group">
                <img src="/logo.jpg" alt="Logo" className="w-full h-full object-cover transition-transform group-hover:scale-110" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-gaming font-black text-white tracking-wide">
                    <span className="bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 bg-clip-text text-transparent">CARX STREET</span>
                    <span className="text-white"> // INJECTOR</span>
                  </h1>
                  <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] font-mono font-bold uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    ONLINE
                  </span>
                </div>
                <p className="text-xs font-chakra text-zinc-400 mt-0.5">
                  Myanmar CarX Street Community Tool · High-Precision Telemetry Hub
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 self-end sm:self-center">
              <button
                data-testid="button-logout"
                onClick={() => { setSession(null); clearAuth(); }}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-red-950/30 text-zinc-400 hover:text-red-400 hover:border-red-500/30 transition-all text-xs font-chakra font-bold cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </div>
        )}

        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-chakra font-bold border transition-all ${
              session
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                : "bg-zinc-900/80 border-zinc-800 text-zinc-500"
            }`}>
              <div className={`w-2 h-2 rounded-full ${session ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
              {session ? `DRIVER LINKED: ${session.email}` : "DRIVER DISCONNECTED // AWAITING TELEMETRY"}
            </div>
            {session && (
              <button
                onClick={() => handleSetSession(null)}
                className="text-xs font-chakra font-bold text-amber-400 hover:text-amber-300 transition-colors uppercase cursor-pointer flex items-center gap-1"
              >
                ⇄ Switch Account
              </button>
            )}
          </div>

          <AnimatePresence mode="wait">
            {!session ? (
              <motion.div
                key="login"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-2xl mx-auto"
              >
                <LoginForm userToken={userToken} onSuccess={handleSetSession} />
              </motion.div>
            ) : (
              <motion.div
                key="injection"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <InjectionPanel session={session} userToken={userToken} onDisconnect={() => handleSetSession(null)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
