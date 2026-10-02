import React, { useEffect, useRef } from "react";

interface CyberEffectCanvasProps {
  opacity?: number;
  className?: string;
}

export const CyberEffectCanvas: React.FC<CyberEffectCanvasProps> = ({
  opacity = 0.55,
  className = "",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const stateRef = useRef({
    snow: [] as { x: number; y: number; r: number; speed: number; wind: number }[],
    time: 0,
  });

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

    const state = stateRef.current;

    // Initialize snow particles for a cold air breeze snowfall scene
    if (state.snow.length === 0) {
      for (let i = 0; i < 120; i++) {
        state.snow.push({
          x: Math.random() * width,
          y: Math.random() * height,
          r: Math.random() * 2.2 + 0.8,
          speed: Math.random() * 0.7 + 0.3,
          wind: Math.random() * 0.4 - 0.2, // subtle horizontal wind drift
        });
      }
    }

    let lastTime = performance.now();
    const render = (time: number) => {
      if (!canvas || !ctx) return;

      const delta = Math.min(3.0, (time - lastTime) / 16.666);
      lastTime = time;

      state.time += delta;

      const isLight = document.querySelector(".light-mode") !== null;

      // Fill background based on theme mode
      ctx.fillStyle = isLight ? "#f8fafc" : "#000000";
      ctx.fillRect(0, 0, width, height);

      // Draw soft drifting snow (air wind style) - dark snow for light mode, white snow for dark mode
      ctx.fillStyle = isLight ? "rgba(15, 23, 42, 0.22)" : "rgba(255, 255, 255, 0.65)";
      state.snow.forEach((flake) => {
        // Move snow flakes downward with a natural air sway
        flake.y += flake.speed * delta;
        flake.x += (flake.wind + Math.sin(flake.y / 25) * 0.2) * delta;

        // Reset when snow flake goes below the screen bounds
        if (flake.y > height) {
          flake.y = -flake.r;
          flake.x = Math.random() * width;
        }

        ctx.beginPath();
        ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
        ctx.fill();
      });

      requestRef.current = requestAnimationFrame(render);
    };

    requestRef.current = requestAnimationFrame((t) => {
      lastTime = t;
      requestRef.current = requestAnimationFrame(render);
    });

    return () => {
      cancelAnimationFrame(requestRef.current);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ opacity }}
      className={`fixed inset-0 w-full h-full pointer-events-none z-0 block ${className}`}
    />
  );
};
