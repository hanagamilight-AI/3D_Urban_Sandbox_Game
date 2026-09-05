import { useEffect, useRef, useState } from "react";
import { Game, type SayInfo, type ZoneInfo, type InteractKind } from "./game/engine";

type Status = "loading" | "ready";

const IS_TOUCH =
  typeof window !== "undefined" &&
  window.matchMedia("(pointer: coarse)").matches;

/* ================= tiny inline icons ================= */
const IconJump = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
const IconRun = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 5l7 7-7 7M12 5l7 7-7 7" />
  </svg>
);
const IconChat = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
    <path d="M3 4h18v13h-9.5L6 21.5V17H3z" />
  </svg>
);
const IconCar = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15l1.5-5h13L20 15M4 15h16v4h-2.5M4 15v4h2.5M6.5 19h11" />
    <circle cx="7" cy="17" r="0.5" fill="currentColor" />
    <circle cx="17" cy="17" r="0.5" fill="currentColor" />
  </svg>
);
const IconGun = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M2 8h20v3h-3l-1 3h-4l1-3H9v2H6l-1 6H2l1.5-6H2z" />
  </svg>
);
const IconStar = ({ active }: { active: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    width="17"
    height="17"
    fill={active ? "#ffc42e" : "rgba(255,255,255,0.14)"}
    stroke={active ? "#8a6a10" : "rgba(255,255,255,0.2)"}
    strokeWidth="1.4"
    className={active ? "drop-in" : ""}
  >
    <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" />
  </svg>
);
const IconPause = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
    <rect x="5" y="4" width="5" height="16" rx="1" />
    <rect x="14" y="4" width="5" height="16" rx="1" />
  </svg>
);
const IconStick = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2">
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
  </svg>
);
const IconDrag = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18M3 12h18M12 3L9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" />
  </svg>
);

/* ================= touch controls ================= */
function TouchControls({
  active,
  promptKind,
  getGame,
}: {
  active: boolean;
  promptKind: InteractKind;
  getGame: () => Game | null;
}) {
  const joyBase = useRef<HTMLDivElement>(null);
  const joyKnob = useRef<HTMLDivElement>(null);
  const joyId = useRef<number | null>(null);
  const camId = useRef<number | null>(null);
  const camLast = useRef({ x: 0, y: 0 });
  const [sprint, setSprint] = useState(false);

  /* drop sprint when we pause / unmount-active */
  useEffect(() => {
    if (!active) {
      setSprint(false);
      getGame()?.setSprint(false);
      getGame()?.setMove(0, 0);
    }
  }, [active, getGame]);

  const setKnob = (dx: number, dy: number) => {
    if (joyKnob.current)
      joyKnob.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const joyDown = (e: React.PointerEvent) => {
    if (joyId.current !== null) return;
    joyId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    joyMove(e);
  };
  const joyMove = (e: React.PointerEvent) => {
    if (e.pointerId !== joyId.current || !joyBase.current) return;
    const r = joyBase.current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = r.width / 2 - 16;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    setKnob(dx, dy);
    let nx = dx / max;
    let ny = dy / max;
    if (Math.hypot(nx, ny) < 0.14) {
      nx = 0;
      ny = 0;
    }
    getGame()?.setMove(nx, -ny); // stick-up = forward
  };
  const joyUp = (e: React.PointerEvent) => {
    if (e.pointerId !== joyId.current) return;
    joyId.current = null;
    setKnob(0, 0);
    getGame()?.setMove(0, 0);
  };

  const camDown = (e: React.PointerEvent) => {
    if (camId.current !== null) return;
    camId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    camLast.current = { x: e.clientX, y: e.clientY };
  };
  const camMove = (e: React.PointerEvent) => {
    if (e.pointerId !== camId.current) return;
    const dx = e.clientX - camLast.current.x;
    const dy = e.clientY - camLast.current.y;
    camLast.current = { x: e.clientX, y: e.clientY };
    getGame()?.look(dx * 2.5, dy * 2.1);
  };
  const camUp = (e: React.PointerEvent) => {
    if (e.pointerId !== camId.current) return;
    camId.current = null;
  };

  if (!active) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* drag-to-look zone (right side, sits under the button cluster) */}
      <div
        className="pointer-events-auto absolute top-0 right-0 h-full w-[58%]"
        style={{ touchAction: "none" }}
        onPointerDown={camDown}
        onPointerMove={camMove}
        onPointerUp={camUp}
        onPointerCancel={camUp}
      />

      {/* joystick zone (bottom-left) */}
      <div
        className="pointer-events-auto absolute bottom-0 left-0 h-[62%] w-[46%]"
        style={{ touchAction: "none" }}
        onPointerDown={joyDown}
        onPointerMove={joyMove}
        onPointerUp={joyUp}
        onPointerCancel={joyUp}
      >
        <div
          ref={joyBase}
          className="absolute bottom-8 left-6 h-32 w-32 rounded-full border-[3px] border-white/30 bg-black/25 shadow-[inset_0_3px_12px_rgba(0,0,0,0.45)]"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="absolute top-1/2 right-2.5 left-2.5 h-px bg-white/15" />
          <div className="absolute top-2.5 bottom-2.5 left-1/2 w-px bg-white/15" />
          <div
            ref={joyKnob}
            className="absolute top-1/2 left-1/2 -mt-7 -ml-7 h-14 w-14 rounded-full border-2 border-white/75 bg-[linear-gradient(180deg,#ffd257_0%,#ffc42e_55%,#eda912_100%)] shadow-[0_4px_10px_rgba(0,0,0,0.45)]"
          />
        </div>
      </div>

      {/* thumb button cluster */}
      <div
        className="absolute right-4 flex flex-col items-end gap-3"
        style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      >
        {/* context action: talk / drive / exit */}
        {promptKind && (
          <button
            className="rise-in pointer-events-auto flex h-12 items-center gap-2.5 rounded-full border-[3px] border-[#8a6a10] bg-[linear-gradient(180deg,#ffd257_0%,#ffc42e_55%,#eda912_100%)] px-5 text-[#17130a] shadow-[0_5px_0_rgba(0,0,0,0.35),0_10px_18px_rgba(0,0,0,0.3)] active:translate-y-0.5 active:shadow-[0_2px_0_rgba(0,0,0,0.35)]"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              getGame()?.action();
            }}
          >
            {promptKind === "drive" || promptKind === "exit" ? <IconCar /> : <IconChat />}
            <span className="font-sign text-sm leading-none">
              {promptKind === "drive" ? "DRIVE" : promptKind === "exit" ? "EXIT" : "TALK"}
            </span>
            <span className="pulse-dot h-2 w-2 rounded-full bg-[#d8452e]" />
          </button>
        )}
        {/* hold-to-fire */}
        <button
          className="pointer-events-auto flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-full border-[3px] border-[#7a1d14] bg-[linear-gradient(180deg,#e86a5e_0%,#d8452e_55%,#a8301e_100%)] text-white shadow-[0_6px_0_rgba(0,0,0,0.35),0_12px_20px_rgba(0,0,0,0.35)] active:translate-y-1 active:shadow-[0_2px_0_rgba(0,0,0,0.35)]"
          style={{ touchAction: "none" }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            getGame()?.setFire(true);
          }}
          onPointerUp={() => getGame()?.setFire(false)}
          onPointerLeave={() => getGame()?.setFire(false)}
          onPointerCancel={() => getGame()?.setFire(false)}
        >
          <IconGun />
          <span className="font-sign text-[10px] leading-none">FIRE</span>
        </button>
        <div className="flex items-end gap-3">
          <button
            className={`pointer-events-auto flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-full border-[3px] shadow-[0_5px_0_rgba(0,0,0,0.35),0_10px_18px_rgba(0,0,0,0.3)] transition-colors active:translate-y-0.5 active:shadow-[0_2px_0_rgba(0,0,0,0.35)] ${
              sprint
                ? "border-[#0e3f22] bg-[linear-gradient(180deg,#2fa05f_0%,#1e7a44_55%,#175f35_100%)] text-white"
                : "border-white/25 bg-[linear-gradient(180deg,#2b323d_0%,#1d222b_60%,#171b22_100%)] text-white/75"
            }`}
            style={{ touchAction: "none" }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSprint((s) => {
                const n = !s;
                getGame()?.setSprint(n);
                return n;
              });
            }}
          >
            <IconRun />
            <span className="font-sign text-[9px] leading-none">RUN</span>
          </button>
          <button
            className="pointer-events-auto flex h-20 w-20 flex-col items-center justify-center gap-0.5 rounded-full border-[3px] border-[#8a6a10] bg-[linear-gradient(180deg,#ffd257_0%,#ffc42e_55%,#eda912_100%)] text-[#17130a] shadow-[0_6px_0_rgba(0,0,0,0.35),0_12px_20px_rgba(0,0,0,0.35)] active:translate-y-1 active:shadow-[0_2px_0_rgba(0,0,0,0.35)]"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              getGame()?.jump();
            }}
          >
            <IconJump />
            <span className="font-sign text-[11px] leading-none">JUMP</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= app ================= */
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
  const [promptKind, setPromptKind] = useState<InteractKind>(null);
  const [health, setHealth] = useState(100);
  const [wanted, setWanted] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
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
      onPrompt: setPromptKind,
      onHealth: setHealth,
      onWanted: setWanted,
      onToast: setToast,
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
  const getGame = () => gameRef.current;

  return (
    <div
      className="relative h-full w-full touch-none overflow-hidden bg-asphalt font-ui text-chalk select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
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
          {!IS_TOUCH && (
            <span className="keycap keycap-wide !bg-[linear-gradient(180deg,#ffd257_0%,#ffc42e_55%,#eda912_100%)] !text-[#17130a] !border-[#8a6a10]">
              E
            </span>
          )}
          <span className="h-2 w-2 rotate-45 bg-sunyellow shadow-md" />
        </div>
      </div>

      {/* ============ HUD ============ */}
      {showHud && (
        <div className="pointer-events-none absolute inset-0">
          {/* street blade — top left */}
          <div className="drop-in absolute top-3 left-3 sm:top-4 sm:left-4">
            <div className="sign sign-green bolt -rotate-1 px-4 pt-2.5 pb-2 sm:px-6 sm:pt-3.5 sm:pb-3">
              <div className="font-sign text-base leading-none tracking-wide text-white [text-shadow:0_2px_0_rgba(0,0,0,0.35)] sm:text-xl">
                SUNNYSIDE BLOCK
              </div>
              <div className="mt-1 text-[8px] font-bold tracking-[0.22em] text-white/75 sm:mt-1.5 sm:text-[10px]">
                MAPLE AVE × 5TH ST
              </div>
            </div>
          </div>

          {/* vitals — wanted stars + health bar (top center) */}
          {locked && (
            <div className="absolute top-3 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5 sm:top-4">
              <div className="flex items-center gap-0.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <IconStar key={i} active={i < wanted} />
                ))}
              </div>
              <div className="sign sign-dark flex items-center gap-2 px-3 py-1.5">
                <span className="text-[9px] font-bold tracking-widest text-white/55">HP</span>
                <div className="h-3 w-32 overflow-hidden rounded-full border border-white/15 bg-black/45 sm:w-44">
                  <div
                    className="h-full rounded-full transition-all duration-200"
                    style={{
                      width: `${health}%`,
                      background:
                        health > 50
                          ? "linear-gradient(90deg,#2fa05f,#4fbf7d)"
                          : health > 25
                            ? "linear-gradient(90deg,#e3b23c,#ffc42e)"
                            : "linear-gradient(90deg,#c0392b,#e86a5e)",
                    }}
                  />
                </div>
                <span className="w-7 text-right text-[10px] font-bold text-white/80">
                  {Math.round(health)}
                </span>
              </div>
            </div>
          )}

          {/* toast — dispatch messages */}
          {toast && locked && (
            <div className={`absolute left-1/2 -translate-x-1/2 ${IS_TOUCH ? "top-28" : "top-24"}`}>
              <div className="drop-in sign sign-yellow bolt px-5 pt-2.5 pb-2">
                <span className="font-sign text-xs whitespace-nowrap">{toast}</span>
              </div>
            </div>
          )}

          {/* crosshair */}
          {locked && !IS_TOUCH && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="crosshair" />
            </div>
          )}

          {/* zone banner — bottom center */}
          <div
            className={`absolute left-1/2 max-w-[92vw] -translate-x-1/2 ${
              IS_TOUCH ? "bottom-40" : "bottom-16"
            }`}
          >
            {zone ? (
              <div key={zone.name} className="drop-in">
                <div className="sign sign-green bolt flex items-center gap-3 px-5 pt-2.5 pb-2 sm:gap-4 sm:px-7 sm:pt-3.5 sm:pb-3">
                  <span
                    className="h-7 w-1.5 rounded-full border border-white/50 sm:h-9 sm:w-2"
                    style={{ background: zone.accent }}
                  />
                  <div>
                    <div className="font-sign text-sm leading-none text-white [text-shadow:0_2px_0_rgba(0,0,0,0.3)] sm:text-lg">
                      ENTERED · {zone.name}
                    </div>
                    <div className="mt-1 text-[10px] font-semibold tracking-wide text-white/80 sm:text-[11px]">
                      {zone.sub}
                    </div>
                  </div>
                </div>
              </div>
            ) : locked ? (
              <div className="sign sign-dark px-4 py-1.5 text-[10px] font-bold tracking-[0.2em] whitespace-nowrap text-white/60 sm:px-5 sm:py-2 sm:text-[11px]">
                MAPLE AVE × 5TH ST — OPEN AIR
              </div>
            ) : null}
          </div>

          {/* talk prompt — bottom left (keyboard players only) */}
          {!IS_TOUCH && (
            <div className="absolute bottom-16 left-4">
              {promptKind && locked && (
                <div className="rise-in">
                  <div className="sign sign-yellow bolt flex items-center gap-3 px-5 pt-3 pb-2.5">
                    <span className="keycap !bg-[linear-gradient(180deg,#3a4250,#2a303b)] !text-white">
                      E
                    </span>
                    <span className="font-sign text-sm">
                      {promptKind === "drive" ? "DRIVE CAR" : promptKind === "exit" ? "EXIT CAR" : "SAY HELLO"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* control legend — bottom right (keyboard players only) */}
          {!IS_TOUCH && (
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
                    <span className="keycap">E</span> TALK / DRIVE
                    <span className="keycap keycap-wide ml-2">CLICK</span> SHOOT
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="keycap ml-0.5">ESC</span> PAUSE
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* minimap + clock — always mounted so the engine owns the canvas ref.
          Rendered before the touch layer: its wrapper is pointer-events-none so
          the drag zone underneath still receives touches, while the PAUSE
          button (pointer-events-auto) stays tappable on top. */}
      <div className="drop-in pointer-events-none absolute top-3 right-3 z-40 flex origin-top-right flex-col items-end scale-[0.82] sm:top-4 sm:right-4 sm:scale-100">
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
        {IS_TOUCH && locked && (
          <button
            onClick={() => gameRef.current?.pause()}
            className="pointer-events-auto mt-2 flex items-center gap-1.5 rounded-md border border-white/20 bg-[#1d222b] px-3 py-1.5 text-[10px] font-bold tracking-[0.2em] text-white/75 shadow-lg active:scale-95"
          >
            <IconPause /> PAUSE
          </button>
        )}
      </div>

      {/* ============ touch controls (above the map, below the overlay) ============ */}
      <TouchControls
        active={showHud && locked}
        promptKind={promptKind}
        getGame={getGame}
      />

      {/* ============ loading ============ */}
      {status === "loading" && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-asphalt px-6">
          <div className="spin-slow h-14 w-14 rounded-full border-4 border-white/10 border-t-sunyellow" />
          <div className="font-sign text-center text-lg tracking-wide text-white/85">
            PAVING THE STREETS…
          </div>
          <div className="text-center text-[11px] font-semibold tracking-[0.25em] text-white/40">
            RAPIER PHYSICS · WARMING UP
          </div>
        </div>
      )}

      {/* ============ start / pause overlay ============ */}
      {status === "ready" && !locked && (
        <div
          className="absolute inset-0 z-40 flex cursor-pointer flex-col items-center justify-center overflow-y-auto bg-[#14171c]/88 backdrop-blur-[3px]"
          onClick={() => gameRef.current?.lock()}
        >
          {/* ambient layers */}
          <div className="hazard absolute top-0 right-0 left-0 h-2.5 opacity-90" />
          <div className="crosswalk stripes-slide absolute bottom-0 left-0 h-16 w-[200%] -translate-x-1/4 opacity-[0.13]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(9,11,16,0.75)_100%)]" />

          <div className="relative flex flex-col items-center px-6 py-10">
            <div className="rise-in mb-7 flex items-center gap-2 text-center text-[10px] font-bold tracking-[0.3em] text-white/45">
              <span className="hidden h-px w-10 bg-white/25 sm:block" />
              SANDBOX BUILD 1.0 · THREE.JS + RAPIER3D
              <span className="hidden h-px w-10 bg-white/25 sm:block" />
            </div>

            {/* street blades */}
            <div className="rise-in relative" style={{ animationDelay: "0.06s" }}>
              <div className="sign sign-green bolt -rotate-2 px-8 pt-5 pb-4 sm:px-14 sm:pt-6 sm:pb-5">
                <div className="font-sign text-3xl leading-none text-white [text-shadow:0_3px_0_rgba(0,0,0,0.35)] sm:text-6xl">
                  SUNNYSIDE
                </div>
                <div className="font-sign mt-2 text-xl leading-none text-sunyellow [text-shadow:0_2px_0_rgba(0,0,0,0.35)] sm:text-4xl">
                  BLOCK
                </div>
              </div>
              <div className="sign sign-yellow bolt absolute -bottom-5 left-1/2 -translate-x-1/2 rotate-1 px-4 pt-2.5 pb-2 whitespace-nowrap">
                <span className="font-sign text-[10px] tracking-wide sm:text-xs">
                  MAPLE AVE × 5TH ST · POP. 8
                </span>
              </div>
            </div>

            <p
              className="rise-in mt-12 max-w-md text-center text-sm leading-relaxed font-medium text-white/70"
              style={{ animationDelay: "0.12s" }}
            >
              A pocket open world with real physics. Chat up locals, borrow a
              <span className="text-[#9fc2ff]"> car</span>, cool off at the
              <span className="text-[#6fc2e8]"> lake</span> — and if you start trouble with your
              <span className="text-[#e86a5e]"> sidearm</span>, the precinct will come looking. Heal up at the
              <span className="text-[#e86a5e]"> hospital</span>.
            </p>

            <button
              className="rise-in group pointer-events-auto mt-9"
              style={{ animationDelay: "0.18s" }}
            >
              <div className="sign sign-yellow bolt cursor-pointer px-8 pt-4 pb-3.5 transition-transform duration-200 ease-out group-hover:-translate-y-1 group-hover:rotate-1 group-active:translate-y-0.5 group-active:scale-[0.98] sm:px-10">
                <div className="font-sign text-lg tracking-wide sm:text-2xl">
                  {visited
                    ? IS_TOUCH
                      ? "TAP TO RESUME"
                      : "CLICK TO RESUME"
                    : IS_TOUCH
                      ? "TAP TO EXPLORE"
                      : "CLICK TO EXPLORE"}
                </div>
              </div>
            </button>

            {/* controls — keycaps on desktop, gesture chips on touch */}
            {IS_TOUCH ? (
              <div
                className="rise-in mt-10 flex max-w-sm flex-wrap items-center justify-center gap-2.5"
                style={{ animationDelay: "0.24s" }}
              >
                <span className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[10px] font-bold tracking-[0.16em] text-white/65">
                  <span className="text-sunyellow"><IconStick /></span> LEFT STICK · MOVE
                </span>
                <span className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[10px] font-bold tracking-[0.16em] text-white/65">
                  <span className="text-sunyellow"><IconDrag /></span> DRAG · LOOK
                </span>
                <span className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[10px] font-bold tracking-[0.16em] text-white/65">
                  <span className="text-sunyellow"><IconJump /></span> BUTTONS · JUMP &amp; RUN
                </span>
                <span className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[10px] font-bold tracking-[0.16em] text-white/65">
                  <span className="text-sunyellow"><IconGun /></span> HOLD FIRE · SHOOT
                </span>
                <span className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[10px] font-bold tracking-[0.16em] text-white/65">
                  <span className="text-sunyellow"><IconCar /></span> ACTION · TALK &amp; DRIVE
                </span>
              </div>
            ) : (
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
                  <span className="keycap">E</span> TALK / DRIVE
                </span>
                <span className="flex items-center gap-2">
                  <span className="keycap keycap-wide">CLICK</span> SHOOT
                </span>
                <span className="flex items-center gap-2">
                  <span className="keycap">MOUSE</span> LOOK
                </span>
              </div>
            )}

            <div
              className="rise-in mt-8 text-center text-[10px] font-semibold tracking-[0.25em] text-white/35"
              style={{ animationDelay: "0.3s" }}
            >
              HOSPITAL · POLICE · MALL · LAKE &amp; BEACH · DRIVABLE CARS · GRAVITY −9.81
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
