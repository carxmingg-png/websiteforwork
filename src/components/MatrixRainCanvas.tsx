import React, { useEffect, useRef } from "react";

interface MatrixRainCanvasProps {
  opacity?: number;
  className?: string;
  color?: string;
}

export const MatrixRainCanvas: React.FC<MatrixRainCanvasProps> = ({
  opacity = 0.2,
  className = "",
  color = "#a855f7" // Neon Purple
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = (canvas.width = canvas.offsetWidth || canvas.clientWidth || 300);
    let height = (canvas.height = canvas.offsetHeight || canvas.clientHeight || 200);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth || canvas.clientWidth || 300;
      height = canvas.height = canvas.offsetHeight || canvas.clientHeight || 200;
    };
    window.addEventListener("resize", handleResize);

    const fontSize = 10;
    const columns = Math.floor(width / fontSize) + 1;
    const yPositions = Array(columns).fill(0).map(() => Math.random() * -100);

    let animationFrameId: number;
    let lastTime = performance.now();
    const interval = 45; // Milliseconds between rain drop steps
    let accum = 0;

    const render = (time: number) => {
      const elapsed = time - lastTime;
      lastTime = time;
      
      // Cap elapsed to avoid massive jumps when tab is inactive
      accum += Math.min(300, elapsed);

      const isLight = document.querySelector(".light-mode") !== null;
      ctx.fillStyle = isLight ? "rgba(248, 250, 252, 0.12)" : "rgba(10, 10, 18, 0.12)"; // Light fade trail in light mode, dark fade trail in dark mode
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = isLight ? "#6d28d9" : color;
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < yPositions.length; i++) {
        const text = Math.random() > 0.5 ? "1" : "0";
        const x = i * fontSize;
        const y = yPositions[i];
        ctx.fillText(text, x, y);
      }

      // Update positions at throttled interval
      if (accum >= interval) {
        const steps = Math.floor(accum / interval);
        accum = accum % interval;

        for (let i = 0; i < yPositions.length; i++) {
          yPositions[i] += fontSize * steps;
          if (yPositions[i] > height && Math.random() > 0.975) {
            yPositions[i] = 0;
          }
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame((t) => {
      lastTime = t;
      animationFrameId = requestAnimationFrame(render);
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
    };
  }, [color]);

  return (
    <canvas
      ref={canvasRef}
      style={{ opacity }}
      className={`absolute inset-0 w-full h-full pointer-events-none z-0 rounded-lg ${className}`}
    />
  );
};
