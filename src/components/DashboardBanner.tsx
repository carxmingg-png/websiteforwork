import React, { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";

interface BannerSlide {
  image: string;
  title: string;
  subtitle: string;
  badge: string;
}

const SLIDES: BannerSlide[] = [
  {
    image: "https://image.api.playstation.com/vulcan/ap/rnd/202504/0212/4ae246f4acce632ee477520042a69e67357685132600f50e.jpg",
    title: "RYOMEN X CARX STREET",
    subtitle: "The Ultimate Cloud Save Injection Suite",
    badge: "v1.2 ACTIVE",
  },
  {
    image: "https://traxion.gg/wp-content/uploads/2024/08/CarX-Street-PC-2024-1024x576.jpg",
    title: "DOMINATE THE STREETS",
    subtitle: "Instant Cash, Gold & Level Modifications",
    badge: "120 FPS SUPREME",
  },
  {
    image: "https://i.pinimg.com/1200x/f5/c1/7b/f5c17b1c7634dfef25157246f95941a5.jpg",
    title: "NEON SPEED DEMON",
    subtitle: "Unlock Premium Clubs, Houses and Elite Supercars",
    badge: "SAFE SYNC PROTOCOL",
  },
];

export const DashboardBanner: React.FC = () => {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % SLIDES.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  const handlePrev = () => {
    setCurrent((prev) => (prev - 1 + SLIDES.length) % SLIDES.length);
  };

  const handleNext = () => {
    setCurrent((prev) => (prev + 1) % SLIDES.length);
  };

  return (
    <div className="relative h-[220px] md:h-[300px] w-full rounded-xl overflow-hidden border border-purple-500/20 bg-black/40 group shadow-[0_0_20px_rgba(139,92,246,0.15)] select-none">
      {/* Slides Container */}
      {SLIDES.map((slide, idx) => {
        const isActive = idx === current;
        return (
          <div
            key={idx}
            className={`absolute inset-0 w-full h-full transition-opacity duration-1000 ${
              isActive ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
            }`}
          >
            {/* Background Zooming Image */}
            <div className="absolute inset-0 overflow-hidden">
              <img
                src={slide.image}
                alt={slide.title}
                className={`w-full h-full object-cover origin-center ${
                  isActive ? "animate-ken-burns scale-[1.08]" : "scale-100"
                }`}
                style={{ transition: "transform 6s ease-out" }}
              />
              {/* Dark Overlay Gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-slate-950/80 via-transparent to-slate-950/40" />
            </div>

            {/* Slide Content Overlay */}
            <div className="absolute bottom-5 left-5 right-5 md:bottom-8 md:left-8 md:right-8 z-20 space-y-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black font-mono tracking-widest bg-purple-500 text-black border border-purple-400/40 shadow-[0_0_8px_rgba(168,85,247,0.4)] uppercase">
                <Play className="h-2 w-2 fill-current" /> {slide.badge}
              </span>
              <div className="space-y-1">
                <h1 className="text-xl md:text-3xl font-black font-sans text-white tracking-wide uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                  {slide.title}
                </h1>
                <p className="text-xs md:text-sm font-mono text-slate-300 font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                  {slide.subtitle}
                </p>
              </div>
            </div>
          </div>
        );
      })}

      {/* Slide Navigation Arrows */}
      <button
        onClick={handlePrev}
        className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2 bg-slate-950/40 border border-white/10 hover:border-purple-500/50 hover:bg-slate-950/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-sm cursor-pointer"
        title="Previous Slide"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        onClick={handleNext}
        className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-2 bg-slate-950/40 border border-white/10 hover:border-purple-500/50 hover:bg-slate-950/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-sm cursor-pointer"
        title="Next Slide"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      {/* Bottom Dash/Pagination Indicators */}
      <div className="absolute bottom-4 right-6 z-20 flex gap-2">
        {SLIDES.map((_, idx) => (
          <button
            key={idx}
            onClick={() => setCurrent(idx)}
            className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
              idx === current
                ? "w-6 bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.6)]"
                : "w-2.5 bg-white/20 hover:bg-white/40"
            }`}
            title={`Go to slide ${idx + 1}`}
          />
        ))}
      </div>
    </div>
  );
};
