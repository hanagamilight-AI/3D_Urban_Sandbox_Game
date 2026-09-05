import { useEffect, useRef, useState } from "react";
import { Game, type SayInfo, type ZoneInfo } from "./game/engine";

type Status = "loading" | "ready";

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const sayRef = useRef<SayInfo | null>(null);
  const timers = useRef<number[]>([]);

  const [status, setStatus] = useState<Status>("loading");
  const [locked, setLocked] = useState(false);
  const [visited, setVisited] = useState(false);
  const [zone, setZone] = useState<ZoneInfo | null>(null);
  const [prompt, setPrompt] = useState(false);
  const [say, setSay] = useState<SayInfo | null>(null);
  const [exiting, setExiting] = useState(false);
  const [clock, setClock] = useState("10:07 AM");

  useEffect(() => {
    if (!containerRef.current || !minimapRef.current) return;
    const game = new Game(containerRef.current, minimapRef.current, {
      onReady: () => setStatus("ready"),
      onLockChange: (l) => {
        setLocked(l);
        if (l) setVisited(true);
      },
      onZone: setZone,
      onPrompt: setPrompt,
      onSay: (info) => {
        sayRef.current = info;
        setSay(info);
        setExiting(false);
        timers.current.forEach(clearTimeout);
        timers.current = [
          window.setTimeout(() => setExiting(true), 3650),
          window.setTimeout(() => setSay(null), 4150),
        ];
      },
      onBubblePos: (x, y, v) => {
        const el = bubbleRef.current;
        if (!el) return;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.opacity = v && sayRef.current ? "1" : "0";
      },
      onMarker: (x, y, v) => {
        const el = markerRef.current;
        if (!el) return;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.opacity = v ? "1" : "0";
      },
      onClock: setClock,
    });
    gameRef.current = game;
    void game.start();
    const t = timers.current;
    return () => {
      t.forEach(clearTimeout);
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const showHud = status === "ready";

  return (
    <div className="relative h-full w-full overflow-hidden bg-asphalt font-ui text-chalk">
      {/* 3D viewport */}
      <div ref={containerRef} className="absolute inset-0" />
      <div className="vignette pointer-events-none absolute inset-0" />

      {/* ============ floating layers (positioned by the engine) ============ */}
      {say && locked && (
        <div
          key={say.key}
          ref={bubbleRef}
          className={`bubble ${exiting ? "bubble-exit" : ""}`}
          style={{ opacity: 0 }}
        >
          <div
            className="font-sign mb-1 text-[11px] tracking-wide"
            style={{ color: say.accent }}
          >
            {say.name.toUpperCase()}
          </div>
          <div className="text-[14px] leading-snug font-medium text-[#17130a]">
            “{say.text}”
          </div>
        </div>
      )}
      <div
        ref={markerRef}
        className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-[130%] transition-opacity duration-150"
        style={{ opacity: 0 }}
      >
        <div className="prompt-bob flex flex-col items-center gap-1">
          <span className="keycap keycap-wide !bg-[linear-gradient(180deg,#ffd257_0%,#ffc42e_55%,#eda912_100%)] !text-[#17130a] !border-[#8a6a10]">
            E
          </span>
          <span className="h-2 w-2 rotate-45 bg-sunyellow shadow-md" />
        </div>
      </div>

      {/* minimap + clock — always mounted so the engine owns the canvas ref */}
      <div className="drop-in pointer-events-none absolute top-4 right-4">
        <div className="sign sign-dark bolt px-3 pt-3.5 pb-2.5">
          <canvas ref={minimapRef} width={148} height={148} className="block rounded-sm" />
          <div className="mt-2 flex items-center justify-between gap-4 text-[10px] font-bold tracking-[0.14em] text-white/70">
            <span className="flex items-center gap-1.5">
              <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-sunyellow" />
              LOCALS · 8
            </span>
            <span className="text-sunyellow">{clock}</span>
          </div>
        </div>
      </div>

      {/* ============ HUD ============ */}
      {showHud && (
        <div className="pointer-events-none absolute inset-0">
          {/* street blade — top left */}
          <div className="drop-in absolute top-4 left-4">
            <div className="sign sign-green bolt -rotate-1 px-6 pt-3.5 pb-3">
              <div className="font-sign text-xl leading-none tracking-wide text-white [text-shadow:0_2px_0_rgba(0,0,0,0.35)]">
                SUNNYSIDE BLOCK
              </div>
              <div className="mt-1.5 text-[10px] font-bold tracking-[0.22em] text-white/75">
                MAPLE AVE × 5TH ST
              </div>
            </div>
          </div>

          {/* crosshair */}
          {locked && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="crosshair" />
            </div>
          )}

          {/* zone banner — bottom center */}
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2">
            {zone ? (
              <div key={zone.name} className="drop-in">
                <div className="sign sign-green bolt flex items-center gap-4 px-7 pt-3.5 pb-3">
                  <span
                    className="h-9 w-2 rounded-full border border-white/50"
                    style={{ background: zone.accent }}
                  />
                  <div>
                    <div className="font-sign text-lg leading-none text-white [text-shadow:0_2px_0_rgba(0,0,0,0.3)]">
                      ENTERED · {zone.name}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold tracking-wide text-white/80">
                      {zone.sub}
                    </div>
                  </div>
                </div>
              </div>
            ) : locked ? (
              <div className="sign sign-dark px-5 py-2 text-[11px] font-bold tracking-[0.2em] text-white/60">
                MAPLE AVE × 5TH ST — OPEN AIR
              </div>
            ) : null}
          </div>

          {/* talk prompt — bottom left */}
          <div className="absolute bottom-16 left-4">
            {prompt && locked && (
              <div className="rise-in">
                <div className="sign sign-yellow bolt flex items-center gap-3 px-5 pt-3 pb-2.5">
                  <span className="keycap !bg-[linear-gradient(180deg,#3a4250,#2a303b)] !text-white">E</span>
                  <span className="font-sign text-sm">SAY HELLO</span>
                </div>
              </div>
            )}
          </div>

          {/* control legend — bottom right */}
          <div className="absolute right-4 bottom-4">
            <div className="sign sign-dark px-4 py-3">
              <div className="flex flex-col gap-1.5 text-[10px] font-bold tracking-[0.14em] text-white/65">
                <span className="flex items-center gap-2">
                  <span className="flex gap-0.5">
                    <span className="keycap">W</span>
                    <span className="keycap">A</span>
                    <span className="keycap">S</span>
                    <span className="keycap">D</span>
                  </span>
                  MOVE
                </span>
                <span className="flex items-center gap-2">
                  <span className="keycap keycap-wide">SPACE</span> JUMP
                  <span className="keycap keycap-wide ml-2">SHIFT</span> SPRINT
                </span>
                <span className="flex items-center gap-2">
                  <span className="keycap">E</span> TALK
                  <span className="keycap ml-2">ESC</span> PAUSE
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ loading ============ */}
      {status === "loading" && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-asphalt">
          <div className="spin-slow h-14 w-14 rounded-full border-4 border-white/10 border-t-sunyellow" />
          <div className="font-sign text-lg tracking-wide text-white/85">PAVING THE STREETS…</div>
          <div className="text-[11px] font-semibold tracking-[0.25em] text-white/40">
            RAPIER PHYSICS · WARMING UP
          </div>
        </div>
      )}

      {/* ============ start / pause overlay ============ */}
      {status === "ready" && !locked && (
        <div
          className="absolute inset-0 z-40 flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-[#14171c]/88 backdrop-blur-[3px]"
          onClick={() => gameRef.current?.lock()}
        >
          {/* ambient layers */}
          <div className="hazard absolute top-0 right-0 left-0 h-2.5 opacity-90" />
          <div className="crosswalk stripes-slide absolute bottom-0 left-0 h-16 w-[200%] -translate-x-1/4 opacity-[0.13]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(9,11,16,0.75)_100%)]" />

          <div className="relative flex flex-col items-center px-6">
            <div className="rise-in mb-7 flex items-center gap-2 text-[10px] font-bold tracking-[0.3em] text-white/45">
              <span className="h-px w-10 bg-white/25" />
              SANDBOX BUILD 1.0 · THREE.JS + RAPIER3D
              <span className="h-px w-10 bg-white/25" />
            </div>

            {/* street blades */}
            <div className="rise-in relative" style={{ animationDelay: "0.06s" }}>
              <div className="sign sign-green bolt -rotate-2 px-10 pt-6 pb-5 sm:px-14">
                <div className="font-sign text-4xl leading-none text-white [text-shadow:0_3px_0_rgba(0,0,0,0.35)] sm:text-6xl">
                  SUNNYSIDE
                </div>
                <div className="font-sign mt-2 text-2xl leading-none text-sunyellow [text-shadow:0_2px_0_rgba(0,0,0,0.35)] sm:text-4xl">
                  BLOCK
                </div>
              </div>
              <div className="sign sign-yellow bolt absolute -bottom-5 left-1/2 -translate-x-1/2 rotate-1 whitespace-nowrap px-5 pt-2.5 pb-2">
                <span className="font-sign text-[11px] tracking-wide sm:text-xs">
                  MAPLE AVE × 5TH ST · POP. 8
                </span>
              </div>
            </div>

            <p
              className="rise-in mt-12 max-w-md text-center text-sm leading-relaxed font-medium text-white/70"
              style={{ animationDelay: "0.12s" }}
            >
              A pocket open world with real physics. Stroll the sidewalks, duck into the
              <span className="text-[#4fbf7d]"> grocery</span>, the
              <span className="text-[#e8b84b]"> clothing shop</span> and the
              <span className="text-[#ff8a70]"> café</span> — and chat up the locals on your way past.
            </p>

            <button
              className="rise-in group pointer-events-auto mt-9"
              style={{ animationDelay: "0.18s" }}
            >
              <div className="sign sign-yellow bolt cursor-pointer px-10 pt-4 pb-3.5 transition-transform duration-200 ease-out group-hover:-translate-y-1 group-hover:rotate-1 group-active:translate-y-0.5 group-active:scale-[0.98]">
                <div className="font-sign text-xl tracking-wide sm:text-2xl">
                  {visited ? "CLICK TO RESUME" : "CLICK TO EXPLORE"}
                </div>
              </div>
            </button>

            {/* keycap row */}
            <div
              className="rise-in mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-[10px] font-bold tracking-[0.18em] text-white/55"
              style={{ animationDelay: "0.24s" }}
            >
              <span className="flex items-center gap-2">
                <span className="flex gap-0.5">
                  <span className="keycap">W</span>
                  <span className="keycap">A</span>
                  <span className="keycap">S</span>
                  <span className="keycap">D</span>
                </span>
                MOVE
              </span>
              <span className="flex items-center gap-2">
                <span className="keycap keycap-wide">SPACE</span> JUMP
              </span>
              <span className="flex items-center gap-2">
                <span className="keycap keycap-wide">SHIFT</span> SPRINT
              </span>
              <span className="flex items-center gap-2">
                <span className="keycap">E</span> TALK TO LOCALS
              </span>
              <span className="flex items-center gap-2">
                <span className="keycap">MOUSE</span> LOOK
              </span>
            </div>

            <div
              className="rise-in mt-8 text-[10px] font-semibold tracking-[0.25em] text-white/35"
              style={{ animationDelay: "0.3s" }}
            >
              3 SHOPS OPEN · SIDEWALKS PATROLLED · GRAVITY −9.81
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
