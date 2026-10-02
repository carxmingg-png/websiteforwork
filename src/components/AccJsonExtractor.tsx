import { useState, useRef, useEffect } from "react";
import {
  Upload, FileCode, CheckCircle2, AlertCircle, Car, DollarSign, Sparkles,
  Download, Copy, Save, Search, RefreshCw, Eye, Layers, ShieldCheck, ChevronRight, X, ArrowRight, Database, Clipboard, Info, LogIn, Lock, Mail, Check
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PARTS_METADATA: Record<string, { desc: string; icon: string; path: string }> = {
  cars: { desc: "All cars in garage", icon: "🚗", path: "cars.items" },
  resources: { desc: "Silver, gold, XP & Level", icon: "💰", path: "resources" },
  maps: { desc: "Unlocked world map parts", icon: "🗺️", path: "game_world_parts" },
  premium: { desc: "Street Pass VIP status", icon: "⭐", path: "has_premium" },
  tuning: { desc: "Installed & inventory tuning parts", icon: "🛠️", path: "tuning" },
  styling: { desc: "Visual customization & body kits", icon: "🎨", path: "styling" },
  real_estates: { desc: "Purchased properties & garages", icon: "🏢", path: "real_estates" },
  slots: { desc: "Garage vehicle slots mapping", icon: "📦", path: "real_estate_slots" },
  clubs: { desc: "Joined & completed clubs", icon: "🎯", path: "clubs" },
  battle_pass: { desc: "Battle pass rewards & progress", icon: "🎟️", path: "battle_pass_event_rewards" },
  stats: { desc: "Player career statistics", icon: "📊", path: "statistics" },
  quests: { desc: "Main & side quests progress", icon: "📜", path: "quests" },
  achievements: { desc: "Unlocked achievements", icon: "🏆", path: "achievements" },
  business: { desc: "Business deliveries completed", icon: "💼", path: "business_car_deliveries_completed" },
  locations: { desc: "Discovered spots & points of interest", icon: "📍", path: "locations" },
  shop_packs: { desc: "Owned shop packs & bundles", icon: "🛍️", path: "shop_owned_packs" },
  unlocks: { desc: "Unlocked content flags", icon: "🔓", path: "unlocks" },
  friends: { desc: "Social friends list", icon: "👥", path: "friends" },
  races: { desc: "Race generators & records", icon: "🏁", path: "race_generators" }
};

interface ExtractedCar {
  id: string;
  descId: string;
  isTuned: boolean;
  mileage?: number;
  paintColor?: string;
  paintType?: string;
  hasUpgrades?: boolean;
  details: any;
}

interface ExtractedPartInfo {
  key: string;
  desc: string;
  icon: string;
  hasData: boolean;
  count: number;
  data: any;
}

interface ExtractedAccountData {
  nickname: string;
  carxId: string;
  rawCarsCount: number;
  uniqueModelsCount: number;
  carsDict: Record<string, any>;
  carsList: ExtractedCar[];
  resources?: {
    cash?: number;
    gold?: number;
    silver?: number;
    exp?: number;
    level?: number;
  };
  hasPremium?: boolean;
  realEstatesCount?: number;
  clubsCount?: number;
  compressedString?: string;
  fullProfile: any;
  parts: Record<string, ExtractedPartInfo>;
  fileName?: string;
  sourceType: "cloud_login" | "compressed_string" | "file_upload" | "json_paste";
}

function calculateLevelFromExp(exp: number): number {
  if (exp <= 0) return 1;
  if (exp >= 93060) return 50;
  const lvl = Math.floor(Math.sqrt(exp / 37.224));
  return Math.max(1, Math.min(50, lvl));
}

function getNestedValue(data: any, path: string): any {
  if (!data || typeof data !== "object") return null;
  const keys = path.split(".");
  let val: any = data;
  for (const k of keys) {
    if (val && typeof val === "object" && k in val) {
      val = val[k];
    } else {
      return null;
    }
  }
  return val;
}

function parseCarXProfileToExtractedData(
  profile: any,
  compressedString = "",
  sourceType: "cloud_login" | "compressed_string" | "file_upload" | "json_paste" = "file_upload",
  fileName = "account.json",
  carxId = ""
): ExtractedAccountData {
  const carsObj = getNestedValue(profile, "cars.items") || profile.cars || profile.custom_cars_json || {};
  const carsDict: Record<string, any> = {};
  const carsList: ExtractedCar[] = [];
  const uniqueModels = new Set<string>();

  if (carsObj && typeof carsObj === "object") {
    for (const [id, val] of Object.entries(carsObj)) {
      if (!val || typeof val !== "object") continue;
      const car = val as any;
      const descId = String(car.__desc_id || car.descId || car.desc_id || car.model_id || id);
      const hasPaint = !!(car.paint && (car.paint.color || car.paint.type));
      const hasUpgrades = !!((car.upgrades && Object.keys(car.upgrades).length > 0) || (car.parts && Object.keys(car.parts).length > 0));
      const isTuned = hasPaint || hasUpgrades || (car.mileage && car.mileage > 0);

      carsDict[id] = car;
      carsList.push({
        id,
        descId,
        isTuned,
        mileage: car.mileage,
        paintColor: car.paint?.color,
        paintType: car.paint?.type,
        hasUpgrades,
        details: car
      });
      uniqueModels.add(descId.toLowerCase());
    }
  }

  // Parse resources
  let resources: any = undefined;
  const resObj = profile.resources || profile.profile?.resources;
  if (resObj && typeof resObj === "object") {
    const expVal = resObj.exp !== undefined ? Number(resObj.exp) : undefined;
    const lvlVal = resObj.level !== undefined ? Number(resObj.level) : (expVal !== undefined ? calculateLevelFromExp(expVal) : undefined);
    resources = {
      cash: resObj.cash !== undefined ? Number(resObj.cash) : undefined,
      gold: resObj.gold !== undefined ? Number(resObj.gold) : undefined,
      silver: resObj.silver !== undefined ? Number(resObj.silver) : undefined,
      exp: expVal,
      level: lvlVal
    };
  }

  // Parse 19 parts
  const parts: Record<string, ExtractedPartInfo> = {};
  for (const [key, meta] of Object.entries(PARTS_METADATA)) {
    const data = getNestedValue(profile, meta.path);
    const hasData = data !== null && data !== undefined;
    let count = 0;
    if (hasData) {
      if (Array.isArray(data)) count = data.length;
      else if (typeof data === "object") count = Object.keys(data).length;
      else count = 1;
    }
    parts[key] = {
      key,
      desc: meta.desc,
      icon: meta.icon,
      hasData,
      count,
      data
    };
  }

  return {
    nickname: profile.nickname || fileName.replace(/\.[^/.]+$/, "") || "player",
    carxId: carxId || profile.carx_id || "unknown",
    rawCarsCount: Object.keys(carsDict).length,
    uniqueModelsCount: uniqueModels.size,
    carsDict,
    carsList,
    resources,
    hasPremium: !!profile.has_premium,
    realEstatesCount: Object.keys(profile.real_estates || {}).length,
    clubsCount: Object.keys(profile.clubs || {}).length,
    compressedString,
    fullProfile: profile,
    parts,
    fileName,
    sourceType
  };
}

interface AccJsonExtractorProps {
  adminToken: string;
  currentFleet?: Record<string, any>;
  initialFile?: File | null;
  onAppliedSuccessfully?: () => void;
  onClose?: () => void;
}

export default function AccJsonExtractor({
  adminToken,
  currentFleet = {},
  initialFile,
  onAppliedSuccessfully,
  onClose
}: AccJsonExtractorProps) {
  const [activeTab, setActiveTab] = useState<"login" | "compressed" | "upload" | "paste">("login");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [extractedData, setExtractedData] = useState<ExtractedAccountData | null>(null);
  const [activePartView, setActivePartView] = useState<string>("cars");
  const [inspectingPartModal, setInspectingPartModal] = useState<ExtractedPartInfo | null>(null);
  const [inspectingCar, setInspectingCar] = useState<ExtractedCar | null>(null);
  const [carSearch, setCarSearch] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const compressedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Cloud login & extract
  const handleCloudLoginExtract = async () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      toast({ title: "Credentials Required", description: "Please enter your CarX Email and Password.", variant: "destructive" });
      return;
    }

    try {
      setIsProcessing(true);
      setProcessingStatus(`Connecting to CarX ID servers for ${loginEmail}...`);

      const res = await fetch("/api/carx/extract-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword.trim() })
      });

      const d = await res.json();
      if (!res.ok || !d.success) {
        throw new Error(d.message || "Failed to log in to CarX ID server.");
      }

      setProcessingStatus("Decompressing & organizing 19 account parts...");
      await new Promise(r => setTimeout(r, 40));

      const extracted = parseCarXProfileToExtractedData(
        d.profile,
        d.compressed_string,
        "cloud_login",
        `${d.nickname}_cloud.json`,
        d.carx_id
      );

      setExtractedData(extracted);
      toast({
        title: "🎉 Cloud Account Extracted!",
        description: `Successfully downloaded ${extracted.nickname}'s profile with ${extracted.rawCarsCount} cars and full garage!`
      });
    } catch (err: any) {
      toast({
        title: "Extraction Error",
        description: err.message || "Could not extract account from CarX.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  };

  // Compressed string extract
  const handleExtractFromCompressedString = async () => {
    const rawStr = compressedTextareaRef.current?.value.trim();
    if (!rawStr) {
      toast({ title: "Empty Payload", description: "Please paste your base64 compressed string.", variant: "destructive" });
      return;
    }

    try {
      setIsProcessing(true);
      setProcessingStatus("Decompressing base64 payload via server...");

      const res = await fetch("/api/carx/extract-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compressed_string: rawStr })
      });

      const d = await res.json();
      if (!res.ok || !d.success) {
        throw new Error(d.message || "Failed to decompress CarX payload.");
      }

      const extracted = parseCarXProfileToExtractedData(
        d.profile,
        rawStr,
        "compressed_string",
        `${d.nickname}_compressed.json`,
        d.carx_id
      );

      setExtractedData(extracted);
      toast({
        title: "⚡ Decompressed & Extracted!",
        description: `Extracted ${extracted.rawCarsCount} cars and complete account profile successfully.`
      });
    } catch (err: any) {
      toast({
        title: "Decompress Error",
        description: err.message || "Invalid CarX compressed string format.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  };

  // File Upload
  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setIsProcessing(true);
    setProcessingStatus(`Reading ${(file.size / 1024 / 1024).toFixed(2)} MB file...`);

    try {
      const text = await file.text();
      const trimmed = text.trim();

      // Check if it's a raw base64 compressed string
      if (trimmed.startsWith("kFUg") || trimmed.startsWith("eJw") || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
        setProcessingStatus("Detected compressed string file. Decompressing...");
        const res = await fetch("/api/carx/extract-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ compressed_string: trimmed })
        });
        const d = await res.json();
        if (res.ok && d.success) {
          const extracted = parseCarXProfileToExtractedData(d.profile, trimmed, "file_upload", file.name, d.carx_id);
          setExtractedData(extracted);
          toast({ title: "📂 Extracted Compressed Save", description: `Loaded ${extracted.rawCarsCount} cars from ${file.name}` });
          return;
        }
      }

      // JSON parse
      setProcessingStatus("Parsing JSON data...");
      const parsed = JSON.parse(text);
      const extracted = parseCarXProfileToExtractedData(parsed, "", "file_upload", file.name);
      setExtractedData(extracted);
      toast({ title: "📂 File Extracted", description: `Extracted ${extracted.rawCarsCount} cars from ${file.name}` });
    } catch (err: any) {
      toast({
        title: "File Parse Error",
        description: err.message || "Failed to process file.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  };

  useEffect(() => {
    if (initialFile) handleFileUpload(initialFile);
  }, [initialFile]);

  // Apply to live DB
  const handleApplyToLiveDb = async (mode: "replace" | "merge" = "replace") => {
    if (!extractedData) return;
    try {
      setIsApplying(true);
      let payloadToSave: Record<string, any> = {};

      if (extractedData.rawCarsCount > 0) {
        if (mode === "merge") {
          payloadToSave = { ...currentFleet, ...extractedData.carsDict };
        } else {
          payloadToSave = extractedData.carsDict;
        }
      } else {
        payloadToSave = extractedData.fullProfile;
      }

      const res = await fetch("/api/admin/cars-json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ cars_items: payloadToSave })
      });

      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.message || "Failed to update fleet");

      toast({
        title: mode === "merge" ? "🎉 Fleet Merged & Applied!" : "🎉 Full Fleet Replaced!",
        description: `Active server database updated with ${d.total_cars || Object.keys(payloadToSave).length} cars.`
      });

      if (onAppliedSuccessfully) onAppliedSuccessfully();
    } catch (err: any) {
      toast({ title: "Apply Error", description: err.message, variant: "destructive" });
    } finally {
      setIsApplying(false);
    }
  };

  // Download Whole Account JSON
  const handleDownloadFullJson = () => {
    if (!extractedData) return;
    const jsonStr = JSON.stringify(extractedData.fullProfile, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${extractedData.nickname}_full_account_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "📥 Download Complete", description: "Saved full account JSON file." });
  };

  // Download Raw Compressed String (.TXT)
  const handleDownloadCompressedTxt = () => {
    if (!extractedData?.compressedString) return;
    const blob = new Blob([extractedData.compressedString], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${extractedData.nickname}_compressed_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "📥 Download Complete", description: "Saved compressed string file (.txt)." });
  };

  // Download Individual Part JSON
  const handleDownloadPartJson = (partInfo: ExtractedPartInfo) => {
    const payload = {
      part_type: partInfo.key,
      extracted_at: new Date().toISOString(),
      source_nickname: extractedData?.nickname,
      source_carx_id: extractedData?.carxId,
      data: partInfo.data
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${partInfo.key}_${extractedData?.nickname}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `📥 Downloaded ${partInfo.key.toUpperCase()} JSON` });
  };

  const copyToClipboard = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2000);
    toast({ title: "📋 Copied to Clipboard" });
  };

  const filteredCars = (extractedData?.carsList || []).filter(c => {
    if (!carSearch) return true;
    return c.descId.toLowerCase().includes(carSearch.toLowerCase()) || c.id.includes(carSearch);
  });

  return (
    <div className="space-y-6">
      {/* Main Panel Card */}
      <div className="cyber-card rounded-3xl p-6 shadow-2xl border border-amber-500/30 bg-gradient-to-b from-amber-500/5 via-black/50 to-black/90">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-2xl shadow-[0_0_20px_rgba(245,158,11,0.25)]">
              ⚡
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-gaming font-bold text-base text-white uppercase tracking-wider">
                  CARX STREET ACCOUNT EXTRACTOR
                </h3>
                <span className="text-[10px] font-chakra font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  LIVE CLOUD & 19 PARTS
                </span>
              </div>
              <p className="text-xs font-chakra text-zinc-400 mt-0.5">
                Directly extract from live CarX account, compressed string, or save files. Export whole account or 19 individual parts.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onClose && (
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer text-sm"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Processing Spinner */}
        {isProcessing && (
          <div className="py-12 text-center space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-amber-400 shadow-glow" />
            <h4 className="text-sm font-gaming font-bold text-white uppercase tracking-wider">
              {processingStatus || "EXTRACTING CARX DATA..."}
            </h4>
            <p className="text-xs font-chakra text-zinc-400">
              Connecting securely to CarX API endpoints...
            </p>
          </div>
        )}

        {/* Input Methods Tabs */}
        {!isProcessing && !extractedData && (
          <div className="pt-4 space-y-4">
            <div className="flex flex-wrap gap-2 p-1 bg-black/60 border border-zinc-800 rounded-2xl">
              {[
                { id: "login", label: "🔑 Direct CarX Login", icon: LogIn },
                { id: "compressed", label: "📦 Compressed String", icon: FileCode },
                { id: "upload", label: "📁 Upload .JSON / .TXT", icon: Upload },
                { id: "paste", label: "📋 Paste Raw JSON", icon: Clipboard }
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as any)}
                  className={`px-4 py-2 rounded-xl text-xs font-chakra font-bold flex items-center gap-2 transition-all cursor-pointer ${
                    activeTab === t.id ? "bg-amber-500 text-black shadow-md" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  <t.icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab 1: Live Cloud Account Login */}
            {activeTab === "login" && (
              <div className="p-6 rounded-2xl bg-black/40 border border-zinc-800 space-y-4">
                <div className="flex items-center gap-2 text-xs font-gaming font-bold text-amber-400 uppercase tracking-wider">
                  <Mail className="w-4 h-4" /> Direct CarX Account Login (1-Click Cloud Extract)
                </div>
                <p className="text-xs font-chakra text-zinc-400">
                  Enter credentials to log in, download raw compressed profile from CarX servers, and decompress all 19 subsystems automatically.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-chakra text-zinc-400 mb-1 block">CarX Account Email</label>
                    <input
                      value={loginEmail}
                      onChange={e => setLoginEmail(e.target.value)}
                      placeholder="e.g. user@gmail.com"
                      className="w-full px-4 py-2.5 bg-black/80 border border-zinc-800 focus:border-amber-400 rounded-xl text-xs text-white font-mono focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-chakra text-zinc-400 mb-1 block">CarX Account Password</label>
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={e => setLoginPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full px-4 py-2.5 bg-black/80 border border-zinc-800 focus:border-amber-400 rounded-xl text-xs text-white font-mono focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleCloudLoginExtract}
                    disabled={!loginEmail.trim() || !loginPassword.trim()}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-gaming font-bold text-xs uppercase tracking-wider cursor-pointer hover:from-amber-400 hover:to-yellow-300 shadow-[0_0_20px_rgba(245,158,11,0.3)] disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    LOGIN & EXTRACT FROM CARX CLOUD
                  </button>
                </div>
              </div>
            )}

            {/* Tab 2: Compressed String */}
            {activeTab === "compressed" && (
              <div className="p-6 rounded-2xl bg-black/40 border border-zinc-800 space-y-4">
                <div className="flex items-center gap-2 text-xs font-gaming font-bold text-purple-400 uppercase tracking-wider">
                  <FileCode className="w-4 h-4" /> Paste CarX Compressed String (base64)
                </div>
                <p className="text-xs font-chakra text-zinc-400">
                  Paste raw `compressed_data` (starts with `kFUg...` or gzip base64) to decompress to full JSON and 19 parts.
                </p>
                <textarea
                  ref={compressedTextareaRef}
                  placeholder="Paste base64 compressed data here (e.g. kFUgAB+LCADzA1VqAv...)"
                  className="w-full h-36 bg-black/80 border border-zinc-800 focus:border-purple-400 rounded-2xl p-4 text-xs font-mono text-purple-200 focus:outline-none resize-none leading-relaxed"
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleExtractFromCompressedString}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-purple-500 hover:bg-purple-400 text-black font-gaming font-bold text-xs uppercase tracking-wider cursor-pointer shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                  >
                    <Sparkles className="w-4 h-4" />
                    DECOMPRESS & EXTRACT ALL
                  </button>
                </div>
              </div>
            )}

            {/* Tab 3: Upload File */}
            {activeTab === "upload" && (
              <div className="border-2 border-dashed border-zinc-800 rounded-3xl p-10 text-center flex flex-col items-center justify-center bg-black/40">
                <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-700 flex items-center justify-center text-3xl mb-3 shadow-inner">
                  📁
                </div>
                <h4 className="text-sm font-gaming font-bold text-white uppercase tracking-wider">
                  Select Save File (.JSON or .TXT)
                </h4>
                <p className="text-xs font-chakra text-zinc-400 mt-1 max-w-md">
                  Supports full CarX account dumps, compressed string files, or vehicle dictionaries up to 50MB.
                </p>
                <label className="mt-4 px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-gaming font-bold text-xs uppercase tracking-wider cursor-pointer shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all inline-flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  CHOOSE FILE
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.txt,.save,application/json,text/plain,*/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            )}

            {/* Tab 4: Paste Raw JSON */}
            {activeTab === "paste" && (
              <div className="space-y-3">
                <textarea
                  ref={textareaRef}
                  placeholder="Paste complete uncompressed CarX profile or vehicle JSON here..."
                  className="w-full h-48 bg-black/90 border border-zinc-800 focus:border-amber-400 rounded-2xl p-4 text-xs font-mono text-zinc-300 focus:outline-none resize-none leading-relaxed"
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      const text = textareaRef.current?.value;
                      if (text) {
                        try {
                          const parsed = JSON.parse(text);
                          const extracted = parseCarXProfileToExtractedData(parsed, "", "json_paste", "pasted_data.json");
                          setExtractedData(extracted);
                          toast({ title: "⚡ Parsed JSON", description: `Extracted ${extracted.rawCarsCount} cars` });
                        } catch (err: any) {
                          toast({ title: "Invalid JSON", description: err.message, variant: "destructive" });
                        }
                      }
                    }}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-gaming font-bold text-xs uppercase tracking-wider cursor-pointer shadow-[0_0_20px_rgba(245,158,11,0.3)]"
                  >
                    <Sparkles className="w-4 h-4" />
                    EXTRACT FROM JSON
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Extracted Account Results Dashboard */}
        {!isProcessing && extractedData && (
          <div className="pt-4 space-y-6">
            {/* Account Banner */}
            <div className="p-4 rounded-2xl bg-black/60 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl">
                  👤
                </div>
                <div>
                  <div className="text-sm font-gaming font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    {extractedData.nickname} • <span className="text-amber-400 font-mono text-xs">ID: {extractedData.carxId}</span>
                  </div>
                  <div className="text-[11px] font-chakra text-zinc-400 mt-0.5">
                    Extracted via {extractedData.sourceType.replace("_", " ").toUpperCase()} • {extractedData.rawCarsCount} Cars in Garage
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setExtractedData(null)}
                  className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-chakra font-bold text-xs transition-all cursor-pointer"
                >
                  EXTRACT ANOTHER
                </button>
              </div>
            </div>

            {/* Metrics Overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-center">
                <span className="text-2xl">🏎️</span>
                <div className="text-xl font-mono font-bold text-amber-300 mt-0.5">
                  {extractedData.rawCarsCount}
                </div>
                <div className="text-[10px] font-chakra text-amber-400 uppercase tracking-wider">
                  Cars ({extractedData.uniqueModelsCount} Models)
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center">
                <span className="text-2xl">💵</span>
                <div className="text-base font-mono font-bold text-emerald-300 mt-0.5 truncate">
                  {extractedData.resources?.cash !== undefined ? `$${extractedData.resources.cash.toLocaleString()}` : "N/A"}
                </div>
                <div className="text-[10px] font-chakra text-emerald-400 uppercase tracking-wider">Silver / Cash</div>
              </div>

              <div className="p-3.5 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 text-center">
                <span className="text-2xl">🪙</span>
                <div className="text-base font-mono font-bold text-yellow-300 mt-0.5 truncate">
                  {extractedData.resources?.gold !== undefined ? `${extractedData.resources.gold.toLocaleString()} G` : "N/A"}
                </div>
                <div className="text-[10px] font-chakra text-yellow-400 uppercase tracking-wider">Gold Coins</div>
              </div>

              <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-center">
                <span className="text-2xl">⭐</span>
                <div className="text-xl font-mono font-bold text-purple-300 mt-0.5">
                  {extractedData.hasPremium ? "ACTIVE" : "INACTIVE"}
                </div>
                <div className="text-[10px] font-chakra text-purple-400 uppercase tracking-wider">Street Pass VIP</div>
              </div>
            </div>

            {/* Whole Account Actions */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/20 via-zinc-900 to-purple-500/20 border border-amber-500/40 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl">
              <div>
                <h4 className="text-sm font-gaming font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Database className="w-4 h-4 text-amber-400" /> FULL ACCOUNT ACTIONS
                </h4>
                <p className="text-xs font-chakra text-zinc-400 mt-0.5">
                  Apply whole garage to server or download full JSON & compressed backups.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
                <button
                  onClick={() => handleApplyToLiveDb("replace")}
                  disabled={isApplying}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 text-black font-gaming font-bold text-xs uppercase tracking-wider cursor-pointer hover:from-emerald-400 hover:to-teal-300 shadow-[0_0_20px_rgba(16,185,129,0.3)] disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {isApplying ? "APPLYING..." : "APPLY CARS TO LIVE FLEET"}
                </button>

                <button
                  onClick={handleDownloadFullJson}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 text-xs font-chakra font-bold cursor-pointer"
                  title="Download full account JSON"
                >
                  <Download className="w-4 h-4" />
                  FULL JSON
                </button>

                {extractedData.compressedString && (
                  <button
                    onClick={handleDownloadCompressedTxt}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-purple-300 hover:text-white border border-purple-500/40 text-xs font-chakra font-bold cursor-pointer"
                    title="Download compressed string .txt"
                  >
                    <Download className="w-4 h-4 text-purple-400" />
                    COMPRESSED (.TXT)
                  </button>
                )}
              </div>
            </div>

            {/* 19 Parts Extractor Grid */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-gaming font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-4 h-4" /> 19 INDIVIDUAL ACCOUNT SUBSYSTEMS (PARTS)
                </h4>
                <span className="text-[11px] font-chakra text-zinc-400">
                  Inspect & download any individual part independently
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.values(extractedData.parts).map(part => (
                  <div
                    key={part.key}
                    className={`p-3.5 rounded-2xl border transition-all ${
                      part.hasData ? "bg-black/60 border-zinc-800 hover:border-amber-500/40" : "bg-black/30 border-zinc-900 opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{part.icon}</span>
                          <h5 className="text-xs font-gaming font-bold text-white uppercase">{part.key}</h5>
                          {part.hasData ? (
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              {part.count} items
                            </span>
                          ) : (
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-500">Empty</span>
                          )}
                        </div>
                        <p className="text-[11px] font-chakra text-zinc-400 mt-1">{part.desc}</p>
                      </div>

                      {part.hasData && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setInspectingPartModal(part)}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all cursor-pointer"
                            title={`Inspect ${part.key} JSON`}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDownloadPartJson(part)}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all cursor-pointer"
                            title={`Download ${part.key}.json`}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Extracted Garage Cars Section */}
            {extractedData.rawCarsCount > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                  <h4 className="text-xs font-gaming font-bold text-purple-400 uppercase tracking-wider flex items-center gap-2">
                    <Car className="w-4 h-4" /> EXTRACTED GARAGE VEHICLES ({extractedData.rawCarsCount})
                  </h4>
                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={carSearch}
                      onChange={e => setCarSearch(e.target.value)}
                      placeholder="Search model or ID..."
                      className="w-full pl-8 pr-3 py-1.5 bg-black/60 border border-zinc-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-purple-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[380px] overflow-y-auto pr-1">
                  {filteredCars.map(car => (
                    <div
                      key={car.id}
                      className={`cyber-card rounded-2xl p-3.5 border transition-all ${
                        car.isTuned ? "border-purple-500/30 bg-purple-500/5" : "border-zinc-800 bg-black/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-base">🏎️</span>
                            <h5 className="text-xs font-mono font-bold text-white truncate">{car.descId}</h5>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-mono text-zinc-500">#{car.id}</span>
                            <span
                              className={`text-[9px] font-chakra font-bold px-1.5 py-0.2 rounded border ${
                                car.isTuned ? "bg-purple-500/20 text-purple-300 border-purple-500/40" : "bg-zinc-800 text-zinc-500 border-zinc-700"
                              }`}
                            >
                              {car.isTuned ? "TUNED / UPGRADED" : "STOCK"}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => setInspectingCar(car)}
                          className="p-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all cursor-pointer shrink-0"
                          title="View Individual JSON"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Part Inspection Modal */}
      {inspectingPartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="cyber-card rounded-3xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-amber-500/40 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/90">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{inspectingPartModal.icon}</span>
                <div>
                  <h4 className="text-sm font-gaming font-bold text-white tracking-wide uppercase">
                    {inspectingPartModal.key} SUBSYSTEM
                  </h4>
                  <p className="text-[11px] font-chakra text-zinc-400">{inspectingPartModal.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownloadPartJson(inspectingPartModal)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-chakra font-bold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> DOWNLOAD
                </button>
                <button
                  onClick={() => copyToClipboard(JSON.stringify(inspectingPartModal.data, null, 2), inspectingPartModal.key)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-chakra font-bold cursor-pointer"
                >
                  {copiedKey === inspectingPartModal.key ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />} COPY
                </button>
                <button
                  onClick={() => setInspectingPartModal(null)}
                  className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer text-sm ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1 bg-black/90 text-xs font-mono text-zinc-300">
              <pre className="whitespace-pre-wrap break-all select-text">
                {JSON.stringify(inspectingPartModal.data, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Car Inspection Modal */}
      {inspectingCar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="cyber-card rounded-3xl max-w-2xl w-full max-h-[80vh] flex flex-col shadow-2xl border border-purple-500/40 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/90">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🏎️</span>
                <div>
                  <h4 className="text-sm font-gaming font-bold text-white tracking-wide">{inspectingCar.descId}</h4>
                  <p className="text-[11px] font-mono text-purple-400">Slot ID: #{inspectingCar.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(JSON.stringify(inspectingCar.details, null, 2), inspectingCar.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/40 font-chakra font-bold text-xs cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" /> COPY
                </button>
                <button
                  onClick={() => setInspectingCar(null)}
                  className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer text-sm ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1 bg-black/90 text-xs font-mono text-purple-200">
              <pre className="whitespace-pre-wrap break-all select-text">
                {JSON.stringify(inspectingCar.details, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
