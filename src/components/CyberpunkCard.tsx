import React from "react";

interface CyberpunkCardProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export const CyberpunkCard: React.FC<CyberpunkCardProps> = ({
  title,
  subtitle,
  children,
  className = "",
  id,
}) => {
  return (
    <div
      id={id}
      className={`relative border border-white/8 bg-[#08080e]/65 p-6 backdrop-blur-xl transition-all duration-300 hover:border-white/20 hover:shadow-[0_8px_32px_rgba(255,255,255,0.03)] rounded-xl ${className}`}
    >
      {/* Cybersecurity corner brackets - soft white colored */}
      <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-white/30 rounded-tl" />
      <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-white/30 rounded-tr" />
      <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-white/30 rounded-bl" />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-white/30 rounded-br" />

      {/* Grid Pattern overlay */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:14px_24px] rounded-xl" />

      {title && (
        <div className="mb-4 border-b border-white/5 pb-3">
          <div className="flex items-baseline justify-between">
            {/* Title with banner glow blur effect */}
            <div className="relative">
              {/* Glow blur layer behind the title */}
              <div className="absolute inset-0 rounded-md blur-md opacity-40 bg-gradient-to-r from-fuchsia-500/30 via-cyan-500/20 to-transparent -mx-2 -my-1" />
              <h3 className="relative font-sans text-lg font-bold tracking-wider text-white uppercase select-none drop-shadow-[0_0_12px_rgba(255,255,255,0.5)]">
                {title}
              </h3>
            </div>
            {subtitle && (
              <span className="font-mono text-[10px] text-slate-400 uppercase select-none tracking-widest">
                {subtitle}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="relative z-10">{children}</div>
    </div>
  );
};
