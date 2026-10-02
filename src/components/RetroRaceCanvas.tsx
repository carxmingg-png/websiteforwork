import React, { useEffect, useRef } from "react";

interface RetroRaceCanvasProps {
  speed?: "normal" | "fast" | "slow";
  opacity?: number;
  className?: string;
}

export const RetroRaceCanvas: React.FC<RetroRaceCanvasProps> = ({
  speed = "normal",
  opacity = 1,
  className = "",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const stateRef = useRef({
    position: 0,
    currentSpeed: 5,
    curvePhase: 0,
    curves: [] as number[],
    stars: [] as { x: number; y: number; r: number }[],
    speedLines: [] as { x: number; y: number; z: number; len: number; speed: number }[],
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

    // Initialize stars
    if (state.stars.length === 0) {
      for (let i = 0; i < 80; i++) {
        state.stars.push({
          x: Math.random() * 2000 - 1000,
          y: Math.random() * 400 - 200,
          r: Math.random() * 1.5 + 0.5,
        });
      }
    }

    // Initialize speed lines
    if (state.speedLines.length === 0) {
      for (let i = 0; i < 40; i++) {
        state.speedLines.push({
          x: (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 800 + 300),
          y: Math.random() * 300 - 100,
          z: Math.random() * 1500 + 100,
          len: Math.random() * 60 + 20,
          speed: Math.random() * 10 + 5,
        });
      }
    }

    // Pre-calculate curves
    if (state.curves.length === 0) {
      const segmentCount = 2000;
      for (let i = 0; i < segmentCount; i++) {
        state.curves.push(
          Math.sin(i / 120) * 180 + Math.cos(i / 300) * 220
        );
      }
    }

    let lastTime = performance.now();
    const render = (time: number) => {
      if (!canvas || !ctx) return;

      const delta = Math.min(3.0, (time - lastTime) / 16.666);
      lastTime = time;

      const isLight = document.querySelector(".light-mode") !== null;

      ctx.fillStyle = isLight ? "#f8fafc" : "#02020a";
      ctx.fillRect(0, 0, width, height);

      const targetSpeed = speed === "fast" ? 65 : speed === "slow" ? 1.5 : 6;
      state.currentSpeed = state.currentSpeed * 0.94 + targetSpeed * 0.06;

      state.position += state.currentSpeed * delta;
      state.curvePhase += state.currentSpeed * 0.0003 * delta;

      const horizon = height * 0.45;

      ctx.fillStyle = isLight ? "rgba(15, 23, 42, 0.2)" : "rgba(255, 255, 255, 0.85)";
      const starOffset = (state.position * 0.05) % width;
      state.stars.forEach((star) => {
        let sx = (star.x - starOffset + width * 2) % (width * 2) - width;
        let sy = star.y + horizon * 0.6;
        if (sy > horizon) sy = horizon - 5;
        ctx.beginPath();
        ctx.arc(sx + width / 2, sy, star.r, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.strokeStyle = "rgba(217, 70, 239, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      ctx.lineTo(width, horizon);
      ctx.stroke();

      const segmentLength = 20;
      const viewDistance = 160;
      const roadWidth = 450;
      const cameraHeight = 900;
      const cameraDepth = 0.8;

      const startSegment = Math.floor(state.position / segmentLength);
      const segmentPercent = (state.position % segmentLength) / segmentLength;

      let lastX = 0;
      let lastY = 0;
      let lastW = 0;

      for (let i = viewDistance; i > 0; i--) {
        const index = (startSegment + i) % state.curves.length;
        const segmentZ = i * segmentLength - segmentPercent * segmentLength;
        const scale = cameraDepth * (height / (segmentZ || 1));

        const curveX = state.curves[index];
        const projectedY = horizon + (cameraHeight / segmentZ) * scale * 0.15;
        const projectedWidth = roadWidth * scale;

        if (i === viewDistance) {
          lastX = curveX;
          lastY = projectedY;
          lastW = projectedWidth;
          continue;
        }

        const currentSegmentIndex = startSegment + i;
        const isDarkSegment = Math.floor(currentSegmentIndex / 4) % 2 === 0;

        const roadColor = isLight 
          ? (isDarkSegment ? "#cbd5e1" : "#cbd5e1")
          : (isDarkSegment ? "#090912" : "#0d0d1a");
        const rumbleColor = isLight
          ? (isDarkSegment ? "#c084fc" : "#22d3ee")
          : (isDarkSegment ? "#d946ef" : "#06b6d4");
        const laneColor = isDarkSegment
          ? (isLight ? "rgba(15, 23, 42, 0.4)" : "rgba(255,255,255,0.7)")
          : "transparent";

        const py1 = lastY;
        const py2 = projectedY;
        const px1 = width / 2 + (state.curves[index - 1] - state.curves[startSegment]) * (cameraDepth * (height / ((i - 1) * segmentLength - segmentPercent * segmentLength)));
        const px2 = width / 2 + (state.curves[index] - state.curves[startSegment]) * scale;

        const pw1 = lastW;
        const pw2 = projectedWidth;

        ctx.fillStyle = isLight
          ? (isDarkSegment ? "#f1f5f9" : "#cbd5e1")
          : (isDarkSegment ? "#030308" : "#05050e");
        ctx.beginPath();
        ctx.moveTo(0, py1);
        ctx.lineTo(width, py1);
        ctx.lineTo(width, py2);
        ctx.lineTo(0, py2);
        ctx.fill();

        ctx.fillStyle = roadColor;
        ctx.beginPath();
        ctx.moveTo(px1 - pw1, py1);
        ctx.lineTo(px1 + pw1, py1);
        ctx.lineTo(px2 + pw2, py2);
        ctx.lineTo(px2 - pw2, py2);
        ctx.fill();

        const rumbleWidth1 = pw1 * 0.08;
        const rumbleWidth2 = pw2 * 0.08;

        ctx.fillStyle = rumbleColor;
        ctx.beginPath();
        ctx.moveTo(px1 - pw1 - rumbleWidth1, py1);
        ctx.lineTo(px1 - pw1, py1);
        ctx.lineTo(px2 - pw2, py2);
        ctx.lineTo(px2 - pw2 - rumbleWidth2, py2);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(px1 + pw1, py1);
        ctx.lineTo(px1 + pw1 + rumbleWidth1, py1);
        ctx.lineTo(px2 + pw2 + rumbleWidth2, py2);
        ctx.lineTo(px2 + pw2, py2);
        ctx.fill();

        if (laneColor !== "transparent") {
          const laneWidth1 = pw1 * 0.03;
          const laneWidth2 = pw2 * 0.03;
          ctx.fillStyle = laneColor;
          ctx.beginPath();
          ctx.moveTo(px1 - laneWidth1, py1);
          ctx.lineTo(px1 + laneWidth1, py1);
          ctx.lineTo(px2 + laneWidth2, py2);
          ctx.lineTo(px2 - laneWidth2, py2);
          ctx.fill();
        }

        lastX = curveX;
        lastY = projectedY;
        lastW = projectedWidth;
      }

      ctx.strokeStyle = isLight
        ? (speed === "fast" ? "rgba(15, 23, 42, 0.35)" : "rgba(139, 92, 246, 0.22)")
        : (speed === "fast" ? "rgba(255, 255, 255, 0.7)" : "rgba(34, 211, 238, 0.4)");
      ctx.lineWidth = speed === "fast" ? 2.5 : 1.2;

      state.speedLines.forEach((line) => {
        line.z -= state.currentSpeed * line.speed * 0.15 * delta;
        if (line.z <= 0) {
          line.z = 1500;
          line.x = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 800 + 350);
          line.y = Math.random() * 300 - 100;
        }

        const scale = cameraDepth * (height / (line.z || 1));
        const px = width / 2 + line.x * scale;
        const py = horizon + (cameraHeight / line.z) * scale * 0.2 + line.y * scale * 0.05;

        const scaleEnd = cameraDepth * (height / (line.z + line.len || 1));
        const pxEnd = width / 2 + line.x * scaleEnd;
        const pyEnd = horizon + (cameraHeight / (line.z + line.len)) * scaleEnd * 0.2 + line.y * scaleEnd * 0.05;

        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(pxEnd, pyEnd);
        ctx.stroke();
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
  }, [speed]);

  return (
    <canvas
      ref={canvasRef}
      style={{ opacity }}
      className={`absolute inset-0 w-full h-full pointer-events-none z-0 block ${className}`}
    />
  );
};
