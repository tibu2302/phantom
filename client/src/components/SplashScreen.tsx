import { useEffect, useState } from "react";

export default function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [phase, setPhase] = useState<"logo" | "text" | "fade">("logo");

  useEffect(() => {
    // Phase 1: Logo appears (already showing)
    const t1 = setTimeout(() => setPhase("text"), 600);
    // Phase 2: Text appears
    const t2 = setTimeout(() => setPhase("fade"), 1800);
    // Phase 3: Fade out and finish
    const t3 = setTimeout(() => onFinish(), 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onFinish]);

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background transition-opacity duration-500 ${
        phase === "fade" ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Ambient glow behind logo */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className={`w-64 h-64 rounded-full transition-all duration-1000 ${
            phase === "logo" ? "opacity-0 scale-50" : "opacity-100 scale-100"
          }`}
          style={{
            background: "radial-gradient(circle, oklch(0.72 0.19 160 / 0.15) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
      </div>

      {/* Logo */}
      <div
        className={`relative transition-all duration-700 ease-out ${
          phase === "logo" ? "scale-75 opacity-0" : "scale-100 opacity-100"
        }`}
      >
        <img
          src="/manus-storage/phantom-pwa-icon_c8d2a920.png"
          alt="PHANTOM"
          className="h-24 w-24 md:h-32 md:w-32 rounded-2xl"
          style={{
            filter: "drop-shadow(0 0 20px oklch(0.72 0.19 160 / 0.4))",
          }}
        />
      </div>

      {/* Text */}
      <div
        className={`mt-6 flex flex-col items-center gap-2 transition-all duration-500 ${
          phase === "text" || phase === "fade"
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4"
        }`}
      >
        <h1
          className="text-3xl md:text-4xl font-extrabold tracking-tight"
          style={{ color: "oklch(0.72 0.19 160)" }}
        >
          PHANTOM
        </h1>
        <p className="text-sm text-muted-foreground tracking-widest uppercase">
          Trading Intelligence
        </p>
      </div>

      {/* Loading dots */}
      <div
        className={`mt-8 flex gap-1.5 transition-opacity duration-500 ${
          phase === "text" ? "opacity-100" : "opacity-0"
        }`}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: "oklch(0.72 0.19 160)",
              animation: `splash-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes splash-dot {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}
