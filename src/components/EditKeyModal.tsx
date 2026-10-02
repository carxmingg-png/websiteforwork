import React, { useState, useEffect } from "react";
import { X, Save, ShieldAlert, Cpu } from "lucide-react";
import { KeyData, resolveKeyCredits } from "../types";

interface EditKeyModalProps {
  licenseKey: string;
  keyData: KeyData;
  onClose: () => void;
  onSave: (updatedData: {
    credits: number;
    enabled_features: string[];
    max_claims: number;
    expires_at: number | null;
  }) => Promise<void>;
}

const AVAILABLE_FEATURES = [
  { id: "cash_gold", name: "💵 Cash & Gold Injection" },
  { id: "level_xp", name: "📈 Level & EXP Boost" },
  { id: "unlock_clubs", name: "🏆 Unlock All 20 Clubs" },
  { id: "get_all_cars", name: "🚗 Inject All 97 Cars" },
  { id: "safe_repair", name: "🩹 Safe Profile Repair" },
  { id: "battlepass", name: "🎟 StreetPass BattlePass" },
  { id: "streetpass_ep", name: "🏁 StreetPass EP (90K) [UNDER DEV]" },
  { id: "bulk_generate", name: "⚙️ Bulk Account Generator" },
  { id: "premium", name: "💎 Unlock Premium Account [UNDER DEV]" },
];

export const EditKeyModal: React.FC<EditKeyModalProps> = ({
  licenseKey,
  keyData,
  onClose,
  onSave,
}) => {
  const initialCredits = resolveKeyCredits(keyData);
  const [credits, setCredits] = useState<number>(initialCredits === -1 ? 10 : initialCredits);
  const [isUnlimited, setIsUnlimited] = useState<boolean>(initialCredits === -1);

  // Expiration states
  const [hasExpiry, setHasExpiry] = useState<boolean>(keyData.expires_at !== null);
  const [expiryDate, setExpiryDate] = useState<string>(() => {
    if (keyData.expires_at) {
      const d = new Date(keyData.expires_at * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    // Default to 1 day from now
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  useEffect(() => {
    const val = resolveKeyCredits(keyData);
    if (val === -1) {
      setIsUnlimited(true);
      setCredits(10);
    } else {
      setIsUnlimited(false);
      setCredits(val);
    }
    setHasExpiry(keyData.expires_at !== null);
    if (keyData.expires_at) {
      const d = new Date(keyData.expires_at * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      setExpiryDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
  }, [keyData]);

  const [enabledFeatures, setEnabledFeatures] = useState<string[]>(
    keyData.enabled_features || AVAILABLE_FEATURES.map((f) => f.id)
  );
  const [maxClaims, setMaxClaims] = useState<number>(keyData.max_claims || 1);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleToggleFeature = (id: string) => {
    if (enabledFeatures.includes(id)) {
      setEnabledFeatures(enabledFeatures.filter((f) => f !== id));
    } else {
      setEnabledFeatures([...enabledFeatures, id]);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMsg("");
    try {
      await onSave({
        credits: isUnlimited ? -1 : credits,
        enabled_features: enabledFeatures,
        max_claims: maxClaims,
        expires_at: hasExpiry ? Math.floor(new Date(expiryDate).getTime() / 1000) : null,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update license key.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg border border-cyan-500/50 bg-slate-950/95 p-6 rounded shadow-[0_0_30px_rgba(6,182,212,0.25)]">
        {/* Cyberpunk corner brackets */}
        <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-cyan-400" />
        <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-cyan-400" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-cyan-400" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-cyan-400" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-cyan-500/20 pb-3 mb-4">
          <div>
            <h3 className="font-sans text-lg font-bold tracking-wider text-cyan-400 uppercase flex items-center gap-2">
              <Cpu className="h-5 w-5 text-cyan-400" /> CUSTOMIZE LICENSE KEY
            </h3>
            <div className="font-mono text-[10px] text-slate-500 mt-1 select-all break-all bg-black/40 px-2 py-0.5 border border-cyan-500/10 rounded">
              {licenseKey}
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1 text-slate-400 hover:text-cyan-400 transition-all cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/30 border border-red-500/20 p-3 rounded mb-4">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Modal Form */}
        <form onSubmit={handleSave} className="space-y-4">
          {/* Tokens Input */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div>
              <label className="block font-mono text-xs text-slate-400 uppercase mb-2">Credit Balance</label>
              <input
                type="number"
                min={0}
                value={isUnlimited ? "" : credits}
                onChange={(e) => setCredits(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className={`w-full bg-slate-900 border border-cyan-500/30 rounded p-2 text-sm text-cyan-300 focus:outline-none transition-all duration-150 ${
                  isUnlimited ? "opacity-35 cursor-not-allowed border-slate-700 text-slate-500" : ""
                }`}
                disabled={isUnlimited}
                placeholder="Infinite"
                required={!isUnlimited}
              />
            </div>
            <div className="flex items-center h-10">
              <label className="flex items-center gap-2.5 font-mono text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isUnlimited}
                  onChange={(e) => setIsUnlimited(e.target.checked)}
                  className="rounded border-cyan-500/30 text-cyan-500 focus:ring-cyan-500/20 bg-slate-900 h-4.5 w-4.5 cursor-pointer accent-cyan-500"
                />
                <span className="font-bold text-amber-400">♾️ Unlimited (Infinite Credits)</span>
              </label>
            </div>
          </div>

          {/* Expiration Input & Day Selection */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <div>
                <label className="block font-mono text-xs text-slate-400 uppercase mb-2">Expiration Date & Time</label>
                <input
                  type="datetime-local"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className={`w-full bg-slate-900 border border-cyan-500/30 rounded p-2 text-sm text-cyan-300 focus:outline-none transition-all duration-150 ${
                    !hasExpiry ? "opacity-35 cursor-not-allowed border-slate-700 text-slate-500" : ""
                  }`}
                  disabled={!hasExpiry}
                  required={hasExpiry}
                />
              </div>
              <div className="flex items-center h-10">
                <label className="flex items-center gap-2.5 font-mono text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hasExpiry}
                    onChange={(e) => setHasExpiry(e.target.checked)}
                    className="rounded border-cyan-500/30 text-cyan-500 focus:ring-cyan-500/20 bg-slate-900 h-4.5 w-4.5 cursor-pointer accent-cyan-500"
                  />
                  <span>Set Expiration Date</span>
                </label>
              </div>
            </div>

            {/* Quick Day Selection Presets */}
            {hasExpiry && (
              <div className="p-2.5 rounded bg-slate-900/60 border border-cyan-500/20 space-y-1.5">
                <span className="text-[11px] font-mono text-cyan-400 uppercase block">Quick Select Days from Now:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "+1 Day", days: 1 },
                    { label: "+3 Days", days: 3 },
                    { label: "+7 Days (1 Wk)", days: 7 },
                    { label: "+14 Days (2 Wks)", days: 14 },
                    { label: "+30 Days (1 Mo)", days: 30 },
                    { label: "+90 Days", days: 90 },
                    { label: "+365 Days (1 Yr)", days: 365 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() + preset.days);
                        const pad = (n: number) => String(n).padStart(2, "0");
                        setExpiryDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                        setHasExpiry(true);
                      }}
                      className="px-2 py-1 text-[11px] font-mono bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-500/30 rounded transition-all cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setHasExpiry(false)}
                    className="px-2 py-1 text-[11px] font-mono bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-500/30 rounded transition-all cursor-pointer"
                  >
                    ♾️ Lifetime
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Max Claims */}
          <div>
            <label className="block font-mono text-xs text-slate-400 uppercase mb-2">Device Limit (Max Claims)</label>
            <input
              type="number"
              min={1}
              value={maxClaims}
              onChange={(e) => setMaxClaims(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full bg-slate-900 border border-cyan-500/30 rounded p-2 text-sm text-cyan-300 focus:outline-none"
              required
            />
          </div>

          {/* Feature Permissions */}
          <div>
            <label className="block font-mono text-xs text-slate-400 uppercase mb-2">Feature Gates Permissions</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[170px] overflow-y-auto bg-slate-900/40 border border-cyan-500/10 p-3 rounded scrollbar-thin scrollbar-thumb-cyan-500/20">
              {AVAILABLE_FEATURES.map((feat) => {
                const checked = enabledFeatures.includes(feat.id);
                return (
                  <label
                    key={feat.id}
                    className="flex items-center gap-2.5 p-1.5 rounded hover:bg-slate-900/60 font-sans text-xs text-slate-300 cursor-pointer select-none transition-all duration-100"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggleFeature(feat.id)}
                      className="rounded border-cyan-500/30 text-cyan-500 focus:ring-cyan-500/20 bg-slate-900 h-4 w-4 cursor-pointer accent-cyan-500"
                    />
                    <span>{feat.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 justify-end border-t border-cyan-500/10 pt-4 mt-5">
            <button
              onClick={onClose}
              type="button"
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono rounded cursor-pointer transition-all duration-150"
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-black text-xs font-sans font-bold tracking-wider rounded uppercase cursor-pointer transition-all duration-150 shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:shadow-[0_0_25px_rgba(6,182,212,0.85)] border border-cyan-400/50"
            >
              <Save className="h-4 w-4" />
              {isSaving ? "SAVING..." : "SAVE CHANGES"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
