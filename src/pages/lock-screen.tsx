import React, { useState } from "react";
import { useVerifyKey } from "@/lib/api-client";
import { useAuth } from "@/context/AuthContext";
import { Key, ExternalLink, AlertCircle, Shield, Flame } from "lucide-react";

export default function LockScreen() {
  const { setAuth } = useAuth();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showTelegram, setShowTelegram] = useState(false);

  const verify = useVerifyKey({
    mutation: {
      onSuccess: (data: any) => {
        if (data.role && data.token) {
          setAuth(data.role as "admin" | "user", data.token);
        } else if (data.success && (data.role || data.type)) {
          setAuth((data.role || data.type) as "admin" | "user", data.token || key);
        }
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error || err?.response?.data?.message || err.message;
        if (msg === "Invalid key" || msg?.includes("Invalid")) {
          setShowTelegram(true);
          setError("Invalid license key. Please check or get a key.");
        } else if (msg === "Key expired" || msg?.includes("expired")) {
          setError("Your license key has expired.");
          setShowTelegram(true);
        } else {
          setError(msg || "Verification failed. Try again.");
        }
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    setError(null);
    setShowTelegram(false);
    verify.mutate({ data: { key: key.trim() } });
  };

  return (
    <div className="min-h-screen bg-[#05060a] text-zinc-100 flex items-center justify-center relative overflow-hidden px-4 py-8 select-none">
      {/* Dynamic ambient cyber neon glow background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-[120px] animate-pulse-glow" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-purple-600/15 rounded-full blur-[140px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-amber-500/5 rounded-full blur-[150px]" />
      </div>

      <div className="relative z-10 w-full max-w-lg">
        {/* Header HUD */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-5 rounded-3xl overflow-hidden border border-amber-500/40 flex items-center justify-center shadow-[0_0_40px_rgba(245,158,11,0.35)] ring-1 ring-amber-500/20 bg-black">
            <img src="/logo.jpg" alt="Logo" className="w-full h-full object-cover" />
          </div>

          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-chakra text-[11px] uppercase tracking-widest mb-3">
            <Flame className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span>MYANMAR CARX STREET SYSTEM</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-gaming font-black tracking-tight">
            <span className="text-white">MYANMAR </span>
            <span className="bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_20px_rgba(245,158,11,0.5)]">
              ᴄᴀʀ𝕏 sᴛʀᴇᴇᴛ
            </span>
          </h1>
          <p className="mt-2 text-zinc-400 font-chakra text-xs tracking-widest uppercase">
            TOOL BY <span className="text-amber-400 font-bold">KING MINGFU</span>
          </p>
        </div>

        {/* Lock Card HUD */}
        <div className="cyber-card rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-amber-500/30">
          <div className="flex items-center justify-between gap-2 mb-6 pb-4 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-gaming font-bold text-zinc-300 uppercase tracking-widest">
                AUTHENTICATION GATEWAY
              </span>
            </div>
            <span className="flex items-center gap-1.5 text-[10px] font-chakra text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              SYSTEM READY
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="text-[11px] font-chakra font-bold text-zinc-400 block mb-2 tracking-wider uppercase">
                ENTER ACCESS LICENSE KEY
              </label>
              <div className="relative">
                <input
                  data-testid="input-access-key"
                  type="text"
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setError(null);
                    setShowTelegram(false);
                  }}
                  placeholder="CARX-XXXX-XXXX-XXXX"
                  className="w-full bg-black/80 border border-zinc-700/80 focus:border-amber-400 rounded-2xl px-4 py-3.5 text-white placeholder:text-zinc-600 focus:outline-none font-mono text-sm tracking-widest transition-all shadow-inner focus:shadow-[0_0_20px_rgba(245,158,11,0.2)]"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Key className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500" />
              </div>
            </div>

            <button
              data-testid="button-verify-key"
              type="submit"
              disabled={verify.isPending || !key.trim()}
              className="w-full py-4 rounded-2xl font-gaming font-extrabold text-xs tracking-widest uppercase transition-all duration-300 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-black hover:from-amber-400 hover:to-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_30px_rgba(245,158,11,0.35)] hover:shadow-[0_0_40px_rgba(245,158,11,0.6)] cursor-pointer active:scale-[0.98]"
            >
              {verify.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-black/40 border-t-black rounded-full animate-spin" />
                  AUTHENTICATING...
                </span>
              ) : (
                "⚡ UNLOCK SYSTEM ACCESS"
              )}
            </button>
          </form>

          {/* Error Message */}
          {error && (
            <div className="mt-4 p-3.5 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-start gap-2.5 text-xs text-red-300 font-chakra">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Telegram Purchase link */}
          {showTelegram && (
            <div className="mt-4">
              <a
                href="https://t.me/King_mingfu"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-telegram"
                className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-all text-xs font-gaming font-bold tracking-wider shadow-[0_0_20px_rgba(6,182,212,0.2)]"
              >
                <ExternalLink className="w-4 h-4" />
                GET INSTANT KEY ON TELEGRAM
              </a>
            </div>
          )}
        </div>

        {/* Footer Contact */}
        <p className="text-center text-xs font-chakra text-zinc-500 mt-6 tracking-wide">
          Need a license key or technical assistance?{" "}
          <a
            href="https://t.me/King_mingfu"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:text-amber-300 font-bold underline ml-1 transition-colors"
          >
            Telegram: @King_mingfu
          </a>
        </p>
      </div>
    </div>
  );
}
