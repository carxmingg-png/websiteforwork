import React, { useEffect, useRef, useState } from "react";

interface TerminalConsoleProps {
  logs: string[];
  title?: string;
  className?: string;
  id?: string;
}

// Robust sanitization function to mask Device IDs and Unique IDs
const sanitizeLogLine = (line: string): string => {
  if (!line) return "";
  let clean = line;

  // Mask explicit labels (e.g. Device ID: xyz, DEVICE: xyz, Unip (Unique) ID: xyz) including truncated versions (e.g. xyz...)
  clean = clean.replace(/(device[-_\s]*id\s*[:=]?\s*)[0-9a-fA-F]+(\.{3})?/gi, "$1••••••••");
  clean = clean.replace(/(unique[-_\s]*id\s*[:=]?\s*)[0-9a-fA-F]+(\.{3})?/gi, "$1••••••••");
  clean = clean.replace(/(unip[-_\s]*id\s*[:=]?\s*)[0-9a-fA-F]+(\.{3})?/gi, "$1••••••••");
  clean = clean.replace(/(DEVICE\s*:\s*)[0-9a-fA-F]+(\.{3})?/gi, "$1••••••••");
  clean = clean.replace(/(UNIP_ID\s*:\s*)[0-9a-fA-F]+(\.{3})?/gi, "$1••••••••");

  // Mask standalone 32 or 64 character hex strings
  clean = clean.replace(/\b[0-9a-fA-F]{32}\b/g, "••••••••••••••••••••••••••••••••");
  clean = clean.replace(/\b[0-9a-fA-F]{64}\b/g, "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••");

  return clean;
};

export const TerminalConsole: React.FC<TerminalConsoleProps> = ({
  logs,
  title = "SYSTEM LOGS",
  className = "",
  id,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);

  // Rain animation inside terminal background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    let width = (canvas.width = canvas.clientWidth);
    let height = (canvas.height = canvas.clientHeight);
    
    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.clientWidth;
      height = canvas.height = canvas.clientHeight;
    };
    window.addEventListener("resize", handleResize);

    const rain: { x: number; y: number; len: number; speed: number }[] = [];
    for (let i = 0; i < 20; i++) {
      rain.push({
        x: Math.random() * width,
        y: Math.random() * height,
        len: Math.random() * 8 + 4,
        speed: Math.random() * 4 + 3,
      });
    }

    let active = true;
    let lastTime = performance.now();
    const draw = (time: number) => {
      if (!active) return;

      const delta = Math.min(3.0, (time - lastTime) / 16.666);
      lastTime = time;

      ctx.clearRect(0, 0, width, height);
      const isLight = document.querySelector(".light-mode") !== null;
      ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 0.6;
      
      rain.forEach((p) => {
        p.y += p.speed * delta;
        p.x += p.speed * -0.12 * delta; // slanted drop angle
        
        if (p.y > height) {
          p.y = -p.len;
          p.x = Math.random() * width;
        }
        
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.len * -0.12, p.y + p.len);
        ctx.stroke();
      });
      
      requestAnimationFrame(draw);
    };

    requestAnimationFrame((t) => {
      lastTime = t;
      requestAnimationFrame(draw);
    });

    return () => {
      active = false;
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Monitor user scroll events to detect if they scroll up
  const handleScroll = () => {
    if (containerRef.current) {
      const container = containerRef.current;
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      
      if (distanceToBottom > 50) {
        setUserHasScrolledUp(true);
      } else if (distanceToBottom < 15) {
        setUserHasScrolledUp(false);
      }
    }
  };

  useEffect(() => {
    if (containerRef.current) {
      if (!userHasScrolledUp) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }
  }, [logs, userHasScrolledUp]);

  return (
    <div
      id={id}
      className={`flex flex-col border border-white/10 bg-[#040408]/90 p-4 font-mono text-sm rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.02)] relative overflow-hidden transition-all duration-300 hover:border-white/20 ${className}`}
    >
      {/* Light rain canvas inside terminal log background */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-0 opacity-25" />

      {/* Cool animated multi-color white/slate laser scanner line */}
      <div className="pointer-events-none absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-slate-400 via-white to-slate-500 opacity-30 animate-scanline" />

      {/* Title bar */}
      <div className="mb-3 flex items-center justify-between border-b border-white/5 pb-2 text-xs select-none">
        <span className="flex items-center gap-2 text-slate-300 font-bold tracking-wider">
          <span className="h-2 w-2 rounded-full bg-white animate-pulse shadow-[0_0_8px_rgba(255,255,255,1)]" />
          {title}
        </span>
        <div className="flex items-center gap-4 text-slate-400">
          {userHasScrolledUp && (
            <button
              onClick={() => {
                setUserHasScrolledUp(false);
                if (containerRef.current) {
                  containerRef.current.scrollTop = containerRef.current.scrollHeight;
                }
              }}
              className="text-[10px] bg-white/5 hover:bg-white/10 text-white px-2 py-0.5 rounded border border-white/20 cursor-pointer animate-pulse font-sans"
            >
              ⬇️ Auto Scroll Locked [Resume]
            </button>
          )}
          <span className="text-[10px] bg-white/5 border border-white/10 px-2 py-0.5 rounded text-slate-300 font-bold tracking-widest">
            ACTIVE
          </span>
        </div>
      </div>

      {/* Logs View */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto max-h-[300px] space-y-1.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent pr-1"
      >
        {logs.length === 0 ? (
          <div className="text-white/25 italic select-none py-2 text-center text-xs">
            Awaiting telemetry data stream...
          </div>
        ) : (
          logs.map((rawLog, index) => {
            const log = sanitizeLogLine(rawLog);
            
            // Determine log entry type for coloring
            const isError = log.includes("[AUTH FAILED]") || 
                            log.includes("[INJECT FAILED]") || 
                            log.includes("[INJECT ERROR]") || 
                            log.toLowerCase().includes("failed") ||
                            log.toLowerCase().includes("error") ||
                            log.includes("❌");
                            
            const isSuccess = log.includes("[AUTH OK]") || 
                              log.includes("[INJECT OK]") || 
                              log.includes("✅") || 
                              log.toLowerCase().includes("success") ||
                              log.includes("🎉");
                              
            const isWarning = log.includes("⚠️") || 
                              log.toLowerCase().includes("warning");
                              
            const isProcess = log.includes("[AUTH]") || 
                              log.includes("[INJECT]") || 
                              log.includes("⚙️") ||
                              log.toLowerCase().includes("preparing") ||
                              log.toLowerCase().includes("initiating");

            let textColor = "text-slate-300"; // default
            if (isError) textColor = "text-red-400 font-bold drop-shadow-[0_0_4px_rgba(239,68,68,0.25)]";
            else if (isSuccess) textColor = "text-emerald-400 font-bold drop-shadow-[0_0_4px_rgba(52,211,153,0.2)]";
            else if (isWarning) textColor = "text-yellow-400";
            else if (isProcess) textColor = "text-cyan-400";

            return (
              <div key={index} className={`leading-relaxed break-all select-all text-xs transition-all duration-150 hover:bg-white/5 px-1 rounded py-0.5 ${textColor}`}>
                <span className="opacity-40 select-none mr-2 font-bold text-white/40">&gt;&gt;</span>
                {log}
              </div>
            );
          })
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
};
