import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useListKeys,
  useGenerateKey,
  useRevokeKey,
  useUpdateKey,
  useGetStrings,
  useUpdateStrings,
  getListKeysQueryKey,
} from "@/lib/api-client";
import { useAuth } from "@/context/AuthContext";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import InjectSite from "@/pages/inject-site";
import AccJsonExtractor, { extractAccountJson } from "@/components/AccJsonExtractor";
import { EditKeyModal } from "@/components/EditKeyModal";
import {
  Key, Plus, Trash2, LogOut, Car, Copy, Check,
  Upload, RefreshCw, Clock, Infinity, Calendar, ChevronDown, ChevronUp, Search, Zap,
  Download, Code, Eye, Sparkles, Database, Layers, CheckCircle2, Sliders, Flame, Edit3, Save, RotateCcw, X, FileText
} from "lucide-react";

const TABS = [
  { id: "cars", label: "Car JSON & Fleet Editor", icon: Car },
  { id: "extractor", label: "Acc JSON Extractor", icon: Sparkles },
  { id: "injector", label: "Account Injector", icon: Zap },
  { id: "keys", label: "Keys Vault", icon: Key },
];

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-800/80 hover:bg-amber-500/20 text-zinc-300 hover:text-amber-300 border border-zinc-700/60 hover:border-amber-500/30 transition-all text-xs font-chakra font-bold cursor-pointer"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      {label || (copied ? "COPIED" : "COPY")}
    </button>
  );
}

const ALL_FEATURES = [
  { id: "cash_gold", label: "💵 Cash & Gold" },
  { id: "level_xp", label: "⚡ Level / XP" },
  { id: "unlock_clubs", label: "🏆 Unlock Clubs" },
  { id: "get_all_cars", label: "🚗 All Cars" },
  { id: "safe_repair", label: "🩹 Safe Repair" },
  { id: "battlepass", label: "🎟 Street Pass" },
  { id: "streetpass_ep", label: "🎖 EP Points" },
  { id: "bulk_generate", label: "👥 Bulk Generate" },
  { id: "premium", label: "👑 Premium" },
];

const DAY_PRESETS = [
  { label: "1 Day (24h)", val: 1, unit: "d" },
  { label: "2 Days", val: 2, unit: "d" },
  { label: "3 Days", val: 3, unit: "d" },
  { label: "5 Days", val: 5, unit: "d" },
  { label: "7 Days (1 Wk)", val: 7, unit: "d" },
  { label: "14 Days (2 Wks)", val: 14, unit: "d" },
  { label: "30 Days (1 Mo)", val: 30, unit: "d" },
  { label: "60 Days (2 Mo)", val: 60, unit: "d" },
  { label: "90 Days (3 Mo)", val: 90, unit: "d" },
  { label: "180 Days (6 Mo)", val: 180, unit: "d" },
  { label: "365 Days (1 Yr)", val: 365, unit: "d" },
  { label: "♾️ Lifetime", val: null, unit: "unlim" },
];

const HOUR_PRESETS = [
  { label: "1 Hour", val: 1, unit: "h" },
  { label: "2 Hours", val: 2, unit: "h" },
  { label: "6 Hours", val: 6, unit: "h" },
  { label: "12 Hours", val: 12, unit: "h" },
];

const PREFIX_OPTIONS = ["CARXMING", "CARX", "VIP"];

function formatExpiryTime(expiresAt: number | null | undefined): string {
  if (!expiresAt) return "NEVER (LIFETIME)";
  const now = Date.now() / 1000;
  const diff = expiresAt - now;
  if (diff <= 0) return "EXPIRED";
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const days = Math.floor(hours / 24);
  if (days >= 2) return `${days} DAYS LEFT (${new Date(expiresAt * 1000).toLocaleDateString()})`;
  if (hours >= 1) return `${hours}H ${minutes}M LEFT`;
  return `${minutes}M LEFT`;
}

function getDurationLabel(keyObj: any): string {
  if (keyObj.duration) return String(keyObj.duration).toUpperCase();
  if (keyObj.duration_unit === "unlim" || !keyObj.expires_at) return "LIFETIME";
  if (keyObj.duration_val && keyObj.duration_unit) {
    return `${keyObj.duration_val}${keyObj.duration_unit}`.toUpperCase();
  }
  return "CUSTOM";
}

function KeysTab({ adminToken }: { adminToken: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "active" | "claimed" | "expired" | "lifetime">("all");
  const [editingKey, setEditingKey] = useState<{ key: string; data: any } | null>(null);

  // Key Prefix selection
  const [selectedPrefix, setSelectedPrefix] = useState("CARXMING");

  // Duration configuration mode: 'days' | 'hours' | 'stepper' | 'custom'
  const [durationMode, setDurationMode] = useState<"days" | "hours" | "stepper" | "custom">("days");
  const [selectedDayIdx, setSelectedDayIdx] = useState(4); // Default to 7 Days
  const [selectedHourIdx, setSelectedHourIdx] = useState(0);
  const [customDaysVal, setCustomDaysVal] = useState<number>(7);
  const [customUnitVal, setCustomUnitVal] = useState("3");
  const [customUnit, setCustomUnit] = useState<"h" | "d" | "m" | "mo">("d");

  // Credits configuration (-1 = Infinite)
  const [isInfiniteCredits, setIsInfiniteCredits] = useState(false);
  const [credits, setCredits] = useState(50);
  const [maxClaims, setMaxClaims] = useState(1);

  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(ALL_FEATURES.map(f => f.id));
  const [customKey, setCustomKey] = useState("");
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<{ key: string; data: any; durationLabel?: string } | null>(null);

  const keysQuery = useListKeys({ adminToken });
  const generateKey = useGenerateKey({
    mutation: {
      onSuccess: (data: any) => {
        const computedDuration = data.duration || (durationMode === "days" ? (DAY_PRESETS[selectedDayIdx].val ? `${DAY_PRESETS[selectedDayIdx].val}d` : "lifetime") : `${customDaysVal}d`);
        setNewlyGeneratedKey({
          key: data.key,
          data: data.data || { credits: isInfiniteCredits ? -1 : credits, expires_at: data.expires_at },
          durationLabel: computedDuration
        });
        toast({ title: "🎉 Key Created Successfully!", description: data.key });
        keysQuery.refetch();
        qc.invalidateQueries({ queryKey: getListKeysQueryKey() });
        qc.invalidateQueries({ queryKey: ["/api/admin/keys"] });
        setCustomKey("");
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.message || err?.response?.data?.error || "Failed to generate key";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    },
  });

  const revokeKey = useRevokeKey({
    mutation: {
      onSuccess: () => {
        toast({ title: "Key Revoked" });
        keysQuery.refetch();
        qc.invalidateQueries({ queryKey: getListKeysQueryKey() });
      },
      onError: () => toast({ title: "Error", description: "Failed to revoke key", variant: "destructive" }),
    },
  });

  const updateKey = useUpdateKey({
    mutation: {
      onSuccess: () => {
        toast({ title: "✅ Key Updated" });
        keysQuery.refetch();
        qc.invalidateQueries({ queryKey: getListKeysQueryKey() });
        setEditingKey(null);
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.message || err?.response?.data?.error || "Failed to update key";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    },
  });

  let keysList: any[] = [];
  if (Array.isArray(keysQuery.data)) {
    keysList = keysQuery.data;
  } else if (keysQuery.data && typeof keysQuery.data === "object") {
    const rawObj = (keysQuery.data as any).keys || keysQuery.data;
    if (Array.isArray(rawObj)) {
      keysList = rawObj;
    } else if (typeof rawObj === "object" && rawObj !== null) {
      keysList = Object.entries(rawObj).map(([k, v]: [string, any]) => ({ key: k, ...(typeof v === "object" && v !== null ? v : {}) }));
    }
  }
  const keys: any[] = [...keysList].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  const nowSec = Date.now() / 1000;
  const filtered = keys.filter((k) => {
    const matchesSearch = !search || (k.key && String(k.key).toUpperCase().includes(search.toUpperCase()));
    if (!matchesSearch) return false;

    const isExpired = k.expires_at && nowSec > k.expires_at;
    const isLifetime = !k.expires_at;
    const isClaimed = (k.claimed_users && k.claimed_users.length > 0) || k.claimed_by;

    if (filterMode === "active") return !isExpired;
    if (filterMode === "claimed") return isClaimed;
    if (filterMode === "expired") return isExpired;
    if (filterMode === "lifetime") return isLifetime;
    return true;
  });

  // Calculate live preview expiry date
  const calculatePreviewExpiry = (): string => {
    if (durationMode === "days") {
      const preset = DAY_PRESETS[selectedDayIdx];
      if (preset.unit === "unlim") return "Never (Unlimited Lifetime)";
      const exp = new Date(Date.now() + (preset.val as number) * 86400 * 1000);
      return `${preset.val} Days (Expires ${exp.toLocaleDateString()} at ${exp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
    } else if (durationMode === "stepper") {
      const exp = new Date(Date.now() + Math.max(1, customDaysVal) * 86400 * 1000);
      return `${Math.max(1, customDaysVal)} Days (Expires ${exp.toLocaleDateString()} at ${exp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
    } else if (durationMode === "hours") {
      const preset = HOUR_PRESETS[selectedHourIdx];
      const exp = new Date(Date.now() + preset.val * 3600 * 1000);
      return `${preset.val} Hours (Expires ${exp.toLocaleDateString()} at ${exp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
    } else {
      const v = Math.max(1, parseInt(customUnitVal, 10) || 1);
      const mult = customUnit === "m" ? 60 : customUnit === "h" ? 3600 : customUnit === "d" ? 86400 : 30 * 86400;
      const exp = new Date(Date.now() + v * mult * 1000);
      return `${v} ${customUnit === "d" ? "Days" : customUnit === "h" ? "Hours" : customUnit === "m" ? "Minutes" : "Months"} (Expires ${exp.toLocaleDateString()})`;
    }
  };

  const handleGenerate = () => {
    let durationString = "lifetime";
    let durUnit = "unlim";
    let durVal = 0;

    if (durationMode === "days") {
      const preset = DAY_PRESETS[selectedDayIdx];
      if (preset.unit === "unlim") {
        durationString = "lifetime";
        durUnit = "unlim";
        durVal = 0;
      } else {
        durVal = preset.val as number;
        durUnit = "d";
        durationString = `${preset.val}d`;
      }
    } else if (durationMode === "stepper") {
      const v = Math.max(1, customDaysVal);
      durVal = v;
      durUnit = "d";
      durationString = `${v}d`;
    } else if (durationMode === "hours") {
      const preset = HOUR_PRESETS[selectedHourIdx];
      durVal = preset.val;
      durUnit = "h";
      durationString = `${preset.val}h`;
    } else if (durationMode === "custom") {
      const v = Math.max(1, parseInt(customUnitVal, 10) || 1);
      durVal = v;
      durUnit = customUnit;
      durationString = `${v}${customUnit}`;
    }

    generateKey.mutate({
      data: {
        adminToken,
        prefix: selectedPrefix,
        key_prefix: selectedPrefix,
        duration: durationString,
        duration_unit: durUnit,
        duration_val: durVal,
        days: durUnit === "d" ? durVal : undefined,
        credits: isInfiniteCredits ? -1 : credits,
        isUnlimited: isInfiniteCredits,
        infiniteCredits: isInfiniteCredits,
        features: selectedFeatures,
        enabled_features: selectedFeatures,
        custom_key: customKey.trim() || undefined,
        customKey: customKey.trim() || undefined,
        max_claims: maxClaims,
        maxClaims: maxClaims,
      } as any,
    });
  };

  const toggleFeature = (id: string) => {
    setSelectedFeatures(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6">
      {/* Edit Key Modal */}
      {editingKey && (
        <EditKeyModal
          licenseKey={editingKey.key}
          keyData={editingKey.data}
          onClose={() => setEditingKey(null)}
          onSave={async (updatedData) => {
            await updateKey.mutateAsync({
              data: {
                adminToken,
                key: editingKey.key,
                ...updatedData,
              },
            });
          }}
        />
      )}

      {/* Newly Created Key Prominent Display Banner */}
      {newlyGeneratedKey && (
        <div className="p-6 rounded-3xl bg-gradient-to-r from-emerald-950/80 via-zinc-950 to-black border-2 border-emerald-500 shadow-[0_0_40px_rgba(16,185,129,0.35)] space-y-4 animate-fade-in">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-emerald-400 font-gaming font-black text-sm uppercase tracking-wider">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 animate-pulse" />
              🎉 NEW LICENSE KEY CREATED & READY!
            </div>
            <button
              onClick={() => setNewlyGeneratedKey(null)}
              className="text-zinc-400 hover:text-white text-xs font-chakra font-bold cursor-pointer px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800"
            >
              ✕ DISMISS
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 bg-black/90 border border-emerald-500/50 p-4 sm:p-5 rounded-2xl flex-wrap">
            <div className="font-mono text-lg sm:text-2xl font-black text-amber-300 select-all tracking-wider break-all drop-shadow-[0_0_15px_rgba(245,158,11,0.5)]">
              {newlyGeneratedKey.key}
            </div>
            <CopyButton text={newlyGeneratedKey.key} label="📋 1-CLICK COPY KEY" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-chakra">
            <div className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-xl">
              <span className="text-zinc-500 block text-[10px] uppercase font-bold">DURATION</span>
              <span className="text-amber-400 font-mono font-bold text-sm">
                {newlyGeneratedKey.durationLabel ? newlyGeneratedKey.durationLabel.toUpperCase() : "ACTIVE"}
              </span>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-xl">
              <span className="text-zinc-500 block text-[10px] uppercase font-bold">EXPIRES</span>
              <span className="text-white font-mono font-bold text-xs truncate block">
                {formatExpiryTime(newlyGeneratedKey.data?.expires_at)}
              </span>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-xl">
              <span className="text-zinc-500 block text-[10px] uppercase font-bold">CREDITS</span>
              <span className="text-emerald-400 font-mono font-bold text-sm">
                {newlyGeneratedKey.data?.credits === -1 ? "♾️ INFINITE" : `${newlyGeneratedKey.data?.credits} TOKENS`}
              </span>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 p-2.5 rounded-xl">
              <span className="text-zinc-500 block text-[10px] uppercase font-bold">DEVICE LIMIT</span>
              <span className="text-purple-400 font-mono font-bold text-sm">
                {newlyGeneratedKey.data?.max_claims || 1} DEVICE(S)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Generate Key Box */}
      <div className="cyber-card rounded-3xl p-6 shadow-xl space-y-5 border border-amber-500/30">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3 flex-wrap gap-2">
          <h3 className="text-sm font-gaming font-bold text-amber-400 uppercase tracking-widest flex items-center gap-2">
            <Plus className="w-4 h-4" /> Mint & Configure License Key
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-chakra text-zinc-400 font-bold uppercase">PREFIX:</span>
            <div className="flex gap-1">
              {PREFIX_OPTIONS.map((pfx) => (
                <button
                  key={pfx}
                  type="button"
                  onClick={() => setSelectedPrefix(pfx)}
                  className={`px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold border transition-all ${
                    selectedPrefix === pfx
                      ? "bg-amber-500 text-black border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.4)]"
                      : "bg-black/60 text-zinc-400 border-zinc-800 hover:text-white"
                  }`}
                >
                  {pfx}-
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Custom Key Name */}
        <div>
          <label className="text-xs text-zinc-400 block mb-1.5 font-chakra font-bold">
            CUSTOM KEY NAME (OPTIONAL)
          </label>
          <input
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
            placeholder={`e.g. ${selectedPrefix}-VIP-01 (leave blank for auto ${selectedPrefix}-XXXX-XXXX-XXXX)`}
            className="w-full bg-black/60 border border-zinc-700/80 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-400 font-mono transition-all"
          />
        </div>

        {/* Duration / Day Selection Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="text-xs text-zinc-400 font-chakra font-bold flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              SELECT DURATION & DAYS
            </label>
            <div className="flex gap-1 bg-black/60 p-1 rounded-xl border border-zinc-800">
              <button
                type="button"
                onClick={() => setDurationMode("days")}
                className={`px-3 py-1 rounded-lg text-xs font-chakra font-bold transition-all ${
                  durationMode === "days" ? "bg-amber-500 text-black" : "text-zinc-400 hover:text-white"
                }`}
              >
                📅 Popular Days
              </button>
              <button
                type="button"
                onClick={() => setDurationMode("stepper")}
                className={`px-3 py-1 rounded-lg text-xs font-chakra font-bold transition-all ${
                  durationMode === "stepper" ? "bg-amber-500 text-black" : "text-zinc-400 hover:text-white"
                }`}
              >
                🔢 Exact Days
              </button>
              <button
                type="button"
                onClick={() => setDurationMode("hours")}
                className={`px-3 py-1 rounded-lg text-xs font-chakra font-bold transition-all ${
                  durationMode === "hours" ? "bg-amber-500 text-black" : "text-zinc-400 hover:text-white"
                }`}
              >
                ⏱️ Hours
              </button>
              <button
                type="button"
                onClick={() => setDurationMode("custom")}
                className={`px-3 py-1 rounded-lg text-xs font-chakra font-bold transition-all ${
                  durationMode === "custom" ? "bg-amber-500 text-black" : "text-zinc-400 hover:text-white"
                }`}
              >
                ⚙️ Custom Unit
              </button>
            </div>
          </div>

          {/* Mode 1: Popular Days Grid */}
          {durationMode === "days" && (
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {DAY_PRESETS.map((opt, i) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setSelectedDayIdx(i)}
                  className={`py-2 px-2 rounded-xl text-xs font-chakra font-bold transition-all border text-center ${
                    selectedDayIdx === i
                      ? "bg-amber-500 border-amber-400 text-black shadow-[0_0_15px_rgba(245,158,11,0.3)] font-black scale-[1.02]"
                      : "bg-black/40 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Mode 2: Direct Days Stepper & Inputs */}
          {durationMode === "stepper" && (
            <div className="p-4 rounded-2xl bg-black/60 border border-amber-500/30 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-zinc-400 font-chakra font-bold">Enter Number of Days:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCustomDaysVal(Math.max(1, customDaysVal - 1))}
                    className="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 font-mono font-bold flex items-center justify-center text-sm border border-zinc-700"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={customDaysVal}
                    onChange={(e) => setCustomDaysVal(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-24 bg-zinc-900 border border-amber-500/50 rounded-xl px-3 py-1.5 text-center text-amber-300 font-mono font-bold text-sm focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setCustomDaysVal(customDaysVal + 1)}
                    className="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 font-mono font-bold flex items-center justify-center text-sm border border-zinc-700"
                  >
                    +
                  </button>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {[1, 3, 7, 14, 30, 60, 90, 180, 365].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setCustomDaysVal(d)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono border transition-all ${
                        customDaysVal === d
                          ? "bg-amber-500 text-black border-amber-400 font-bold"
                          : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Mode 3: Hours Presets */}
          {durationMode === "hours" && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {HOUR_PRESETS.map((opt, i) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setSelectedHourIdx(i)}
                  className={`py-2 px-2 rounded-xl text-xs font-chakra font-bold transition-all border text-center ${
                    selectedHourIdx === i
                      ? "bg-amber-500 border-amber-400 text-black shadow-[0_0_15px_rgba(245,158,11,0.3)] font-black"
                      : "bg-black/40 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Mode 4: Custom Unit */}
          {durationMode === "custom" && (
            <div className="p-3 rounded-2xl bg-black/40 border border-amber-500/30 flex items-center gap-3 flex-wrap">
              <span className="text-xs text-zinc-400 font-chakra font-bold">Set Custom Duration:</span>
              <input
                type="number"
                min={1}
                value={customUnitVal}
                onChange={(e) => setCustomUnitVal(e.target.value)}
                className="w-24 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-white font-mono focus:border-amber-400 focus:outline-none"
              />
              <select
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value as any)}
                className="bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-amber-300 font-mono focus:border-amber-400 focus:outline-none cursor-pointer"
              >
                <option value="d">Days</option>
                <option value="h">Hours</option>
                <option value="m">Minutes</option>
                <option value="mo">Months</option>
              </select>
            </div>
          )}

          {/* Live Preview Expiry HUD */}
          <div className="px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs font-chakra text-amber-300 flex-wrap gap-2">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Calculated Expiration:</span>
            </span>
            <span className="font-mono font-bold text-white">{calculatePreviewExpiry()}</span>
          </div>
        </div>

        {/* Credits Configuration */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-zinc-400 font-chakra font-bold">INJECTION CREDITS / TOKENS</label>
            <button
              type="button"
              onClick={() => setIsInfiniteCredits(!isInfiniteCredits)}
              className={`text-xs px-2.5 py-0.5 rounded-full border transition-all font-chakra font-bold cursor-pointer ${
                isInfiniteCredits
                  ? "bg-amber-500 text-black border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                  : "bg-black/40 text-zinc-400 border-zinc-700 hover:border-amber-500/40"
              }`}
            >
              {isInfiniteCredits ? "✓ ♾️ INFINITE CREDITS ENABLED" : "ENABLE ♾️ INFINITE"}
            </button>
          </div>
          
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="text"
              value={isInfiniteCredits ? "♾️ Infinite" : credits}
              disabled={isInfiniteCredits}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setCredits(isNaN(val) ? 1 : Math.max(1, val));
              }}
              className={`w-36 bg-black/60 border rounded-xl px-4 py-2 text-xs font-mono focus:outline-none transition-all ${
                isInfiniteCredits
                  ? "border-amber-500 text-amber-400 font-bold bg-amber-500/10 cursor-not-allowed"
                  : "border-zinc-700 text-white focus:border-amber-400"
              }`}
            />
            <div className="flex gap-1.5 flex-wrap">
              {[10, 25, 50, 100, 250, 500, 1000].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setIsInfiniteCredits(false);
                    setCredits(n);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-mono border transition-all cursor-pointer ${
                    !isInfiniteCredits && credits === n
                      ? "bg-amber-500/20 border-amber-500 text-amber-400 font-bold"
                      : "bg-black/40 border-zinc-800 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setIsInfiniteCredits(true)}
                className={`px-3 py-1 rounded-lg text-xs font-mono border transition-all cursor-pointer ${
                  isInfiniteCredits
                    ? "bg-amber-500 border-amber-400 text-black font-bold"
                    : "bg-black/40 border-zinc-800 text-amber-400 hover:border-amber-500/40"
                }`}
              >
                ♾️ Unlimited
              </button>
            </div>
          </div>
        </div>

        {/* Max Claims / Device limit */}
        <div>
          <label className="text-xs text-zinc-400 font-chakra font-bold block mb-1.5">
            DEVICE CLAIMS LIMIT
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {[1, 2, 3, 5, 10].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => setMaxClaims(num)}
                className={`px-3 py-1.5 rounded-xl text-xs font-chakra font-bold border transition-all cursor-pointer ${
                  maxClaims === num
                    ? "bg-amber-500 text-black border-amber-400 font-black"
                    : "bg-black/40 border-zinc-800 text-zinc-400 hover:text-white"
                }`}
              >
                {num} {num === 1 ? "Device" : "Devices"}
              </button>
            ))}
          </div>
        </div>

        {/* Feature Permissions */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-zinc-400 font-chakra font-bold">ALLOWED INJECTION FEATURES</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelectedFeatures(ALL_FEATURES.map(f => f.id))}
                className="text-[10px] text-amber-400 hover:underline font-mono cursor-pointer"
              >
                Select All
              </button>
              <span className="text-zinc-600">|</span>
              <button
                type="button"
                onClick={() => setSelectedFeatures([])}
                className="text-[10px] text-zinc-500 hover:underline font-mono cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ALL_FEATURES.map(f => {
              const active = selectedFeatures.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => toggleFeature(f.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-chakra transition-all border text-left cursor-pointer ${
                    active
                      ? "bg-amber-500/10 border-amber-500/40 text-amber-300 font-bold"
                      : "bg-black/40 border-zinc-800/80 text-zinc-500 hover:text-zinc-400"
                  }`}
                >
                  <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border text-[10px] ${
                    active ? "bg-amber-500 border-amber-400 text-black font-bold" : "border-zinc-700"
                  }`}>
                    {active ? "✓" : ""}
                  </span>
                  <span>{f.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Mint Button */}
        <button
          onClick={handleGenerate}
          disabled={generateKey.isPending}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-black font-gaming font-black text-xs uppercase tracking-widest hover:from-amber-400 hover:to-yellow-300 active:scale-[0.98] disabled:opacity-50 transition-all shadow-[0_0_25px_rgba(245,158,11,0.4)] cursor-pointer"
        >
          {generateKey.isPending ? "GENERATING LICENSE KEY..." : "⚡ CREATE LICENSE KEY"}
        </button>
      </div>

      {/* Keys List Vault */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search keys by name or prefix..."
              className="w-full pl-10 pr-4 py-2.5 bg-black/60 border border-zinc-800 rounded-xl text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-400 font-mono transition-all"
            />
          </div>
          
          <div className="flex gap-1 bg-black/60 p-1 rounded-xl border border-zinc-800 flex-wrap">
            {[
              { id: "all", label: `All (${keys.length})` },
              { id: "active", label: "🟢 Active" },
              { id: "claimed", label: "🔵 Claimed" },
              { id: "lifetime", label: "♾️ Lifetime" },
              { id: "expired", label: "🔴 Expired" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterMode(f.id as any)}
                className={`px-3 py-1 rounded-lg text-xs font-chakra font-bold transition-all cursor-pointer ${
                  filterMode === f.id
                    ? "bg-amber-500 text-black font-black"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {keysQuery.isLoading && (
          <div className="text-center py-12 text-zinc-500 text-sm font-chakra">Loading keys...</div>
        )}

        {filtered.length === 0 && !keysQuery.isLoading && (
          <div className="cyber-card rounded-2xl p-8 text-center text-zinc-600 font-chakra text-sm">
            No keys match the selected filter
          </div>
        )}

        {filtered.map((k: any) => {
          const isExpired = k.expires_at && nowSec > k.expires_at;
          const isOwner = k.is_owner || k.key === "admin-mingfu" || k.type === "owner";
          const isInf = k.credits === -1 || k.tokens === -1;
          const creditsCount = isInf ? "♾️ INFINITE" : `${k.credits !== undefined ? k.credits : (k.tokens || 10)} CREDITS`;
          const isClaimed = (k.claimed_users && k.claimed_users.length > 0) || k.claimed_by;
          const durationBadge = getDurationLabel(k);

          return (
            <div
              key={k.key}
              className="cyber-card rounded-2xl overflow-hidden shadow-md border border-zinc-800/80 hover:border-zinc-700 transition-all"
            >
              <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  isOwner ? "bg-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.8)]" :
                  isExpired ? "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]" :
                  k.out_of_credits ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" :
                  "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                }`} />

                <span className="font-mono text-xs sm:text-sm text-white flex-1 tracking-wider font-bold truncate select-all">
                  {k.key}
                </span>

                {isOwner ? (
                  <span className="text-[10px] font-chakra font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
                    👑 OWNER
                  </span>
                ) : (
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                    durationBadge === "LIFETIME"
                      ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                      : "bg-blue-500/20 text-blue-300 border-blue-500/40"
                  }`}>
                    {durationBadge}
                  </span>
                )}

                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  isInf
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
                }`}>
                  {creditsCount}
                </span>

                <span className={`text-[10px] font-chakra font-bold px-2 py-0.5 rounded-full ${
                  isExpired
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : isClaimed
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                }`}>
                  {isExpired ? "EXPIRED" : isClaimed ? "CLAIMED" : "AVAILABLE"}
                </span>

                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800/60 text-zinc-400 hidden sm:inline-block">
                  {formatExpiryTime(k.expires_at)}
                </span>

                <CopyButton text={k.key} />

                <button
                  onClick={() => setEditingKey({ key: k.key, data: k })}
                  className="p-1.5 rounded-lg bg-zinc-800/60 hover:bg-amber-500/20 text-zinc-400 hover:text-amber-300 border border-zinc-700/60 transition-all cursor-pointer"
                  title="Customize Key"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => setExpandedKey(expandedKey === k.key ? null : k.key)}
                  className="p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  {expandedKey === k.key ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {!isOwner && (
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete key ${k.key}?`)) {
                        revokeKey.mutate({ data: { adminToken, key: k.key } });
                      }
                    }}
                    disabled={revokeKey.isPending}
                    className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/20 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {expandedKey === k.key && (
                <div className="border-t border-zinc-800/80 bg-black/40 px-5 py-3.5 text-xs font-chakra text-zinc-400 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <span className="text-zinc-500 block text-[10px] uppercase">CREATED</span>
                      <span className="font-mono">{k.created_at ? new Date(k.created_at * 1000).toLocaleString() : "—"}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[10px] uppercase">EXPIRES</span>
                      <span className="font-mono">{k.expires_at ? new Date(k.expires_at * 1000).toLocaleString() : "NEVER (LIFETIME)"}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[10px] uppercase">DURATION</span>
                      <span className="font-mono text-amber-400">{getDurationLabel(k)}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[10px] uppercase">MAX CLAIMS</span>
                      <span className="font-mono">{k.max_claims || 1} Device(s)</span>
                    </div>
                  </div>

                  {k.claimed_users && k.claimed_users.length > 0 && (
                    <div className="pt-2 border-t border-zinc-800/40">
                      <span className="text-zinc-500 block text-[10px] uppercase mb-1">CLAIMED SESSIONS ({k.claimed_users.length})</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {k.claimed_users.map((tok: string) => (
                          <span key={tok} className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-cyan-500/30 text-cyan-300">
                            {tok.slice(0, 8)}...
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {k.enabled_features && (
                    <div className="pt-2 border-t border-zinc-800/40">
                      <span className="text-zinc-500 block text-[10px] uppercase mb-1">ENABLED FEATURES ({k.enabled_features.length})</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {k.enabled_features.map((f: string) => (
                          <span key={f} className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CarsTab({ adminToken }: { adminToken: string }) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "template" | "base">("all");
  const [selectedCar, setSelectedCar] = useState<any | null>(null);
  const [editingCarJson, setEditingCarJson] = useState<string>("");
  const [isEditMode, setIsEditMode] = useState(false);
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);
  const [bulkJsonText, setBulkJsonText] = useState("");
  const [extractorModalOpen, setExtractorModalOpen] = useState(false);
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [jsonExplorerOpen, setJsonExplorerOpen] = useState(false);
  const [explorerSearch, setExplorerSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [jsonCopied, setJsonCopied] = useState(false);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch full cars JSON endpoint
  const carsJsonQuery = useQuery({
    queryKey: ["/api/admin/cars-json"],
    queryFn: async () => {
      const res = await fetch("/api/admin/cars-json");
      return res.json();
    },
    staleTime: 30_000,
  });

  const data = carsJsonQuery.data;
  const catalog: any[] = data?.catalog || [];
  const templateCars: Record<string, any> = data?.cars_items || {};
  const totalTemplateCars = data?.total_template_cars || Object.keys(templateCars).length;

  const filtered = catalog.filter((car) => {
    const matchesSearch =
      !search ||
      car.descId.toLowerCase().includes(search.toLowerCase()) ||
      (car.templateId && String(car.templateId).includes(search));

    if (!matchesSearch) return false;
    if (filterType === "template") return car.isConfiguredInTemplate;
    if (filterType === "base") return !car.isConfiguredInTemplate;
    return true;
  });

  const handleOpenSingleCar = (car: any, edit: boolean = false) => {
    setSelectedCar(car);
    setEditingCarJson(JSON.stringify(car.details, null, 2));
    setIsEditMode(edit);
  };

  const handleSaveSingleCar = async () => {
    if (!selectedCar) return;
    try {
      setSaving(true);
      const parsed = JSON.parse(editingCarJson);
      const res = await fetch("/api/admin/update-car-json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          car_id: selectedCar.templateId,
          desc_id: selectedCar.descId,
          car_data: parsed,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.message || "Failed to update car JSON");

      toast({
        title: "✅ Car JSON Updated!",
        description: `Successfully replaced configuration for ${selectedCar.descId}`,
      });
      setIsEditMode(false);
      setSelectedCar(null);
      carsJsonQuery.refetch();
    } catch (err: any) {
      toast({
        title: "JSON Error",
        description: err.message || "Invalid JSON syntax. Please check formatting.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBulkCars = async () => {
    try {
      setSaving(true);
      const parsed = JSON.parse(bulkJsonText);
      const res = await fetch("/api/admin/cars-json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          cars_items: parsed,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.message || "Failed to replace database");

      toast({
        title: "🎉 Entire Cars Database Replaced!",
        description: `Active cars database updated with ${d.total_cars || Object.keys(parsed).length} cars.`,
      });
      setBulkEditorOpen(false);
      carsJsonQuery.refetch();
    } catch (err: any) {
      toast({
        title: "JSON Replace Error",
        description: err.message || "Invalid JSON object. Must be { [carId]: carData } or full account JSON.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefault = async () => {
    if (!confirm("Are you sure you want to reset all cars to the original default template?")) return;
    try {
      setSaving(true);
      const res = await fetch("/api/admin/cars-json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ reset_to_default: true }),
      });
      const d = await res.json();
      toast({ title: "Reset Complete", description: "Cars database restored to default blueprint spec." });
      carsJsonQuery.refetch();
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedUploadFile(file);
    setExtractorModalOpen(true);
    e.target.value = "";
  };

  const handleCopyAllTemplateJson = () => {
    const fullJson = JSON.stringify(templateCars, null, 2);
    navigator.clipboard.writeText(fullJson);
    toast({
      title: "📋 All Cars JSON Copied!",
      description: `Copied complete dictionary of ${totalTemplateCars} blueprint cars to clipboard.`,
    });
  };

  const handleDownloadJson = () => {
    const jsonStr = JSON.stringify(templateCars, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `carx_street_cars_database_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "📥 Download Started", description: "Exported cars_database.json successfully." });
  };

  const handleCopySingleJson = (carObj: any) => {
    const formatted = JSON.stringify(carObj.details, null, 2);
    navigator.clipboard.writeText(formatted);
    setJsonCopied(true);
    setTimeout(() => setJsonCopied(false), 2000);
    toast({
      title: `Copied ${carObj.descId} JSON`,
      description: "Car configuration payload copied to clipboard.",
    });
  };

  return (
    <div className="space-y-6">
      {/* Telemetry & Action Hub */}
      <div className="cyber-card rounded-3xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-purple-400" />
              <h3 className="font-gaming font-bold text-sm text-white uppercase tracking-wider">
                VEHICLE FLEET & JSON REPLACEMENT HUB
              </h3>
            </div>
            <p className="text-xs font-chakra text-zinc-400 mt-1">
              View, edit, extract, inject, and replace full car JSON payloads with complete live persistence.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Acc JSON Extractor Quick Button */}
            <button
              onClick={() => setExtractorModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-gaming font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-[0_0_20px_rgba(245,158,11,0.35)] hover:from-amber-400 hover:to-yellow-300"
            >
              <Sparkles className="w-4 h-4" />
              ACC JSON EXTRACTOR
            </button>

            {/* Current JSON Explorer (Crash-Proof) */}
            <button
              onClick={() => setJsonExplorerOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-300 font-chakra font-bold text-xs transition-all cursor-pointer shadow-[0_0_15px_rgba(168,85,247,0.2)]"
            >
              <Eye className="w-4 h-4 text-purple-400" />
              EXPLORE CURRENT JSON
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-chakra font-bold text-xs transition-all cursor-pointer border border-zinc-700"
            >
              <Upload className="w-4 h-4 text-zinc-400" />
              UPLOAD & EXTRACT
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json,text/plain,text/*,*/*"
              className="hidden"
              onChange={handleFileUpload}
            />

            <button
              onClick={handleCopyAllTemplateJson}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-chakra font-bold text-xs transition-all cursor-pointer"
              title="Copy All Cars JSON to clipboard"
            >
              <Copy className="w-4 h-4 text-zinc-400" />
              COPY ALL
            </button>

            <button
              onClick={handleDownloadJson}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all cursor-pointer"
              title="Download JSON Database (.json)"
            >
              <Download className="w-4 h-4" />
            </button>

            {data?.is_customized && (
              <button
                onClick={handleResetToDefault}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-chakra font-bold transition-all cursor-pointer"
                title="Reset to original blueprint"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                RESET TO DEFAULT
              </button>
            )}

            <button
              onClick={() => carsJsonQuery.refetch()}
              className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all cursor-pointer"
              title="Refresh Fleet Telemetry"
            >
              <RefreshCw className={`w-4 h-4 ${carsJsonQuery.isFetching ? "animate-spin text-amber-400" : ""}`} />
            </button>
          </div>
        </div>

        {/* Fleet Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-2xl bg-black/40 border border-zinc-800 text-center">
            <span className="text-xl">🏎️</span>
            <div className="text-lg font-mono font-bold text-white mt-0.5">
              {data?.total_models || catalog.length || 189}
            </div>
            <div className="text-[10px] font-chakra text-zinc-500 uppercase tracking-wider">Game Models Available</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-center">
            <span className="text-xl">⚡</span>
            <div className="text-lg font-mono font-bold text-purple-300 mt-0.5">
              {totalTemplateCars}
            </div>
            <div className="text-[10px] font-chakra text-purple-400 uppercase tracking-wider">Active Configured Cars</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-center">
            <span className="text-xl">🛠️</span>
            <div className="text-lg font-mono font-bold text-cyan-300 mt-0.5">
              {data?.is_customized ? "CUSTOMIZED" : "BLUEPRINT"}
            </div>
            <div className="text-[10px] font-chakra text-cyan-400 uppercase tracking-wider">DB Status</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center">
            <span className="text-xl">🛡️</span>
            <div className="text-lg font-mono font-bold text-emerald-300 mt-0.5">
              REPLACEABLE
            </div>
            <div className="text-[10px] font-chakra text-emerald-400 uppercase tracking-wider">Hot-Swap Ready</div>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by model name (e.g. supra, gtr, m4, audi, lambo, bugatti, 1001)..."
              className="w-full pl-10 pr-4 py-2.5 bg-black/60 border border-zinc-800 rounded-xl text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-400 font-mono transition-all shadow-inner"
            />
          </div>

          <div className="flex gap-1.5 p-1 bg-black/40 border border-zinc-800 rounded-xl">
            {[
              { id: "all", label: `All (${catalog.length || 189})` },
              { id: "template", label: `Configured (${totalTemplateCars})` },
              { id: "base", label: `Stock Spec (${catalog.length - totalTemplateCars || 120})` },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-chakra font-bold transition-all ${
                  filterType === f.id
                    ? "bg-amber-500 text-black shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid of Cars */}
      {carsJsonQuery.isLoading ? (
        <div className="text-center py-16 text-zinc-500 font-chakra text-sm">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-purple-400" />
          PARSING CARS DATABASE...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filtered.map((car) => {
            const hasTuning = car.isConfiguredInTemplate;
            return (
              <div
                key={car.descId}
                className={`cyber-card rounded-2xl p-4 transition-all duration-200 border ${
                  hasTuning ? "border-purple-500/30 hover:border-purple-500/60" : "border-zinc-800/80 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 border ${
                      hasTuning ? "bg-purple-500/20 border-purple-500/40 text-purple-300" : "bg-zinc-900 border-zinc-800 text-zinc-500"
                    }`}>
                      🏎️
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-mono font-bold text-white truncate tracking-wide">
                        {car.descId}
                      </h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        {car.templateId && (
                          <span className="text-[10px] font-mono text-zinc-500">
                            ID: #{car.templateId}
                          </span>
                        )}
                        <span
                          className={`text-[9px] font-chakra font-bold px-2 py-0.5 rounded-full border ${
                            hasTuning
                              ? "bg-purple-500/15 border-purple-500/30 text-purple-300"
                              : "bg-zinc-800 border-zinc-700 text-zinc-500"
                          }`}
                        >
                          {hasTuning ? "⭐ BLUEPRINT TUNED" : "STOCK SPEC"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleOpenSingleCar(car, false)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-purple-500/20 text-zinc-300 hover:text-purple-300 border border-zinc-700/60 hover:border-purple-500/40 transition-all text-xs font-chakra font-bold cursor-pointer"
                      title="Inspect JSON"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      VIEW
                    </button>
                    <button
                      onClick={() => handleOpenSingleCar(car, true)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all text-xs font-chakra font-bold cursor-pointer"
                      title="Edit / Replace JSON"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      EDIT
                    </button>
                    <button
                      onClick={() => handleCopySingleJson(car)}
                      className="p-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white border border-zinc-700/60 transition-all cursor-pointer"
                      title="Copy JSON Payload"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {hasTuning && (
                  <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center gap-3 text-[10px] font-mono text-zinc-400 flex-wrap">
                    {car.details.mileage !== undefined && <span>Mileage: {car.details.mileage} km</span>}
                    {car.details.paint && <span>Paint: {car.details.paint.color || "Preset"}</span>}
                    {car.details.upgrades && <span>Upgrades: Custom</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal 1: Acc JSON Extractor Modal */}
      {extractorModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
          <div className="max-w-4xl w-full my-auto">
            <AccJsonExtractor
              adminToken={adminToken}
              currentFleet={templateCars}
              initialFile={selectedUploadFile}
              onAppliedSuccessfully={() => {
                carsJsonQuery.refetch();
                setExtractorModalOpen(false);
                setSelectedUploadFile(null);
              }}
              onClose={() => {
                setExtractorModalOpen(false);
                setSelectedUploadFile(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Modal 2: Crash-Proof Current JSON Explorer Modal */}
      {jsonExplorerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="cyber-card rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-purple-500/40 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/90">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔍</span>
                <div>
                  <h3 className="text-sm font-gaming font-bold text-purple-300 tracking-wide">
                    CURRENT ACTIVE FLEET JSON EXPLORER
                  </h3>
                  <p className="text-[11px] font-mono text-zinc-400 mt-0.5">
                    {totalTemplateCars} active cars • Crash-proof structured view with instant copy & export.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyAllTemplateJson}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-300 font-chakra font-bold text-xs transition-all cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  COPY ALL JSON
                </button>
                <button
                  onClick={handleDownloadJson}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-chakra font-bold text-xs transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  DOWNLOAD
                </button>
                <button
                  onClick={() => setJsonExplorerOpen(false)}
                  className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer text-sm ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Explorer Search */}
            <div className="p-4 border-b border-zinc-800 bg-black/50">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={explorerSearch}
                  onChange={(e) => setExplorerSearch(e.target.value)}
                  placeholder="Filter explorer by car model or slot ID..."
                  className="w-full pl-10 pr-4 py-2 bg-black/80 border border-zinc-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-purple-400"
                />
              </div>
            </div>

            {/* Explorer Body: List of Car JSON blocks safely rendered */}
            <div className="p-6 overflow-y-auto flex-1 bg-black/90 space-y-4">
              {Object.entries(templateCars)
                .filter(([id, c]) => {
                  if (!explorerSearch) return true;
                  const d = String(c.__desc_id || c.descId || "");
                  return d.toLowerCase().includes(explorerSearch.toLowerCase()) || id.includes(explorerSearch);
                })
                .slice(0, 50)
                .map(([id, carObj]) => (
                  <div key={id} className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-bold text-amber-400">#{id}</span>
                        <span className="text-xs font-mono font-bold text-white">{carObj.__desc_id || "Car"}</span>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(carObj, null, 2));
                          toast({ title: `Copied #${id} JSON` });
                        }}
                        className="flex items-center gap-1 text-[11px] font-chakra font-bold text-purple-400 hover:text-purple-300"
                      >
                        <Copy className="w-3 h-3" /> COPY CAR
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-zinc-400 bg-black/80 p-3 rounded-xl overflow-x-auto max-h-48">
                      {JSON.stringify(carObj, null, 2)}
                    </pre>
                  </div>
                ))}
            </div>

            <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-900/80 flex items-center justify-between text-[11px] font-chakra text-zinc-500">
              <span>Showing active blueprint configurations safely.</span>
              <button
                onClick={() => setJsonExplorerOpen(false)}
                className="text-purple-400 hover:text-purple-300 font-bold uppercase cursor-pointer"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Single Car View / Replace Modal */}
      {selectedCar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="cyber-card rounded-3xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-purple-500/40 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/80">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🏎️</span>
                <div>
                  <h3 className="text-sm font-gaming font-bold text-white tracking-wide">
                    {selectedCar.descId}
                  </h3>
                  <p className="text-[11px] font-mono text-purple-400">
                    {selectedCar.templateId ? `Slot #${selectedCar.templateId}` : "Base Model Spec"} • {isEditMode ? "EDIT & REPLACE MODE" : "INSPECTOR VIEW"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!isEditMode ? (
                  <>
                    <button
                      onClick={() => setIsEditMode(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-chakra font-bold text-xs transition-all cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      EDIT / REPLACE
                    </button>
                    <button
                      onClick={() => handleCopySingleJson(selectedCar)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-300 font-chakra font-bold text-xs transition-all cursor-pointer"
                    >
                      {jsonCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      COPY
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleSaveSingleCar}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-500 text-black font-chakra font-bold text-xs transition-all cursor-pointer hover:bg-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving ? "SAVING..." : "SAVE & REPLACE"}
                  </button>
                )}
                <button
                  onClick={() => setSelectedCar(null)}
                  className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer text-sm ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 bg-black/90 text-xs font-mono text-zinc-300">
              {isEditMode ? (
                <textarea
                  value={editingCarJson}
                  onChange={(e) => setEditingCarJson(e.target.value)}
                  className="w-full h-[400px] bg-black/80 border border-purple-500/30 focus:border-amber-400 rounded-2xl p-4 text-xs font-mono text-purple-200 focus:outline-none resize-none leading-relaxed"
                  placeholder="Paste modified car JSON payload here..."
                />
              ) : (
                <pre className="whitespace-pre-wrap break-all text-purple-200 select-text">
                  {JSON.stringify(selectedCar.details, null, 2)}
                </pre>
              )}
            </div>

            <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between text-[11px] font-chakra text-zinc-500">
              <span>{isEditMode ? "Paste any custom tuning/upgrades JSON and click Save & Replace." : "Standard CarX protobuf/json format."}</span>
              <button
                onClick={() => setSelectedCar(null)}
                className="text-amber-400 hover:text-amber-300 font-bold uppercase"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 4: Bulk Database Replace Modal */}
      {bulkEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="cyber-card rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-amber-500/40 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/80">
              <div>
                <h3 className="text-sm font-gaming font-bold text-amber-400 tracking-wide flex items-center gap-2">
                  <Database className="w-4 h-4" /> REPLACE ENTIRE CARS DATABASE (.JSON)
                </h3>
                <p className="text-[11px] font-chakra text-zinc-400 mt-0.5">
                  Paste complete dictionary or account save to hot-swap all injected cars instantly.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveBulkCars}
                  disabled={saving || !bulkJsonText.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-gaming font-bold text-xs uppercase tracking-wider cursor-pointer hover:from-amber-400 hover:to-yellow-300 shadow-[0_0_20px_rgba(245,158,11,0.3)] disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? "APPLYING..." : "APPLY & REPLACE ALL"}
                </button>
                <button
                  onClick={() => setBulkEditorOpen(false)}
                  className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer text-sm ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 flex-1 overflow-y-auto bg-black/90 space-y-3">
              <textarea
                value={bulkJsonText}
                onChange={(e) => setBulkJsonText(e.target.value)}
                className="w-full h-[400px] bg-black/90 border border-zinc-700/80 focus:border-amber-400 rounded-2xl p-4 text-xs font-mono text-zinc-200 focus:outline-none resize-none leading-relaxed"
                placeholder="Paste complete { [carId]: carObject } or Account Save JSON here..."
              />
            </div>

            <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between text-[11px] font-chakra text-zinc-500">
              <span>All injections of 'All Cars' will instantly use this new custom database.</span>
              <button
                onClick={() => setBulkEditorOpen(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPanel() {
  const { token, clearAuth } = useAuth();
  const [tab, setTab] = useState("cars");
  const adminToken = token || "";

  return (
    <div className="min-h-screen bg-[#05060a] text-zinc-100 relative overflow-hidden select-none pb-16">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-48 -left-48 w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-[130px] animate-pulse-glow" />
        <div className="absolute -bottom-48 -right-48 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[130px]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-zinc-800/80">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl overflow-hidden border border-amber-500/40 flex items-center justify-center shadow-[0_0_20px_rgba(245,158,11,0.25)] bg-black shrink-0">
              <img src="/logo.jpg" alt="Logo" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-gaming font-extrabold tracking-tight">
                <span className="text-white">COMMAND </span>
                <span className="bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 bg-clip-text text-transparent">
                  CONSOLE
                </span>
              </h1>
              <p className="text-[11px] font-chakra text-zinc-400 tracking-wider">
                CARX STREET MANAGEMENT HUB • <span className="text-amber-400 font-semibold">KING MINGFU</span>
              </p>
            </div>
          </div>

          <button
            data-testid="button-logout"
            onClick={clearAuth}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-900/80 hover:bg-red-500/20 border border-zinc-800 hover:border-red-500/40 text-zinc-400 hover:text-red-300 transition-all text-xs font-chakra font-bold cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            LOGOUT
          </button>
        </div>

        <div className="flex gap-2 p-1.5 bg-black/60 border border-zinc-800 rounded-2xl mb-6">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              data-testid={`tab-${id}`}
              className={`flex items-center gap-2 flex-1 justify-center py-3 rounded-xl text-xs font-gaming font-bold tracking-wider transition-all duration-300 cursor-pointer ${
                tab === id
                  ? "bg-gradient-to-r from-amber-500 to-yellow-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.4)]"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <div>
          {tab === "cars" && <CarsTab adminToken={adminToken} />}
          {tab === "extractor" && (
            <AccJsonExtractor
              adminToken={adminToken}
              onAppliedSuccessfully={() => setTab("cars")}
            />
          )}
          {tab === "injector" && <InjectSite adminOverrideToken={adminToken} hideHeader />}
          {tab === "keys" && <KeysTab adminToken={adminToken} />}
        </div>
      </div>
    </div>
  );
}
