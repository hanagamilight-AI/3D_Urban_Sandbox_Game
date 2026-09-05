import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { buildCity, type CityHandles, type Zone } from "./city";
import { Player } from "./player";
import { PedManager, DIALOGUE, type Ped } from "./peds";
import { sfx } from "./audio";

export interface ZoneInfo {
  name: string;
  sub: string;
  accent: string;
}
export interface SayInfo {
  name: string;
  text: string;
  accent: string;
  key: number;
}
export interface GameCallbacks {
  onReady: () => void;
  onLockChange: (locked: boolean) => void;
  onZone: (zone: ZoneInfo | null) => void;
  onPrompt: (show: boolean) => void;
  onSay: (info: SayInfo) => void;
  onBubblePos: (x: number, y: number, visible: boolean) => void;
  onMarker: (x: number, y: number, visible: boolean) => void;
  onClock: (text: string) => void;
}

const STEP = 1 / 60;
const SPAWN = new THREE.Vector3(12, 1.4, 7);

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private world!: RAPIER.World;
  private city!: CityHandles;
  private player!: Player;
  private peds!: PedManager;

  private keys = new Set<string>();
  private locked = false;
  private ready = false;
  private disposed = false;
  private raf = 0;
  private lastT = 0;
  private acc = 0;
  private simT = 0;
  private zoneTimer = 0;
  private clockTimer = 0;
  private gameMinutes = 10 * 60 + 7;
  private currentZone: Zone | null = null;
  private sayKey = 0;
  private bubble: { ped: Ped; ttl: number } | null = null;
  private markerPed: Ped | null = null;
  private promptShown = false;
  private lastClock = "";
  private proj = new THREE.Vector3();
  private simWarned = false;
  readonly touch: boolean;
  private tMove = { x: 0, z: 0 };
  private tLook = { x: 0, y: 0 };
  private tSprint = false;

  constructor(
    private container: HTMLElement,
    private minimap: HTMLCanvasElement,
    private cb: GameCallbacks
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = "none";
    this.touch = window.matchMedia("(pointer: coarse)").matches;

    this.camera = new THREE.PerspectiveCamera(62, container.clientWidth / container.clientHeight, 0.1, 500);
    this.scene.background = new THREE.Color("#a9d9ec");
    this.scene.fog = new THREE.Fog(new THREE.Color("#a9d9ec").getHex(), 90, 260);

    const hemi = new THREE.HemisphereLight("#d8f0fa", "#5e8c4a", 0.95);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight("#fff1d6", 2.4);
    sun.position.set(48, 72, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -75;
    sun.shadow.camera.right = 75;
    sun.shadow.camera.top = 75;
    sun.shadow.camera.bottom = -75;
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    window.addEventListener("resize", this.onResize);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onLockChanged);
    document.addEventListener("visibilitychange", this.onVis);
  }

  async start() {
    await RAPIER.init();
    try {
      // sign textures are painted with the display font — make sure it's ready
      await document.fonts.load("120px Bungee");
      await document.fonts.load("500 44px 'Space Grotesk'");
    } catch {
      /* canvas falls back gracefully */
    }
    if (this.disposed) return;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;

    this.city = buildCity(this.scene, this.world);
    this.player = new Player(this.scene, this.world, this.camera, SPAWN.clone());
    this.player.onJump = () => sfx.jump();
    this.player.onLand = () => sfx.land();
    this.player.onStep = () => sfx.step();
    this.peds = new PedManager(this.scene, this.world, this.city.pedLoops);
    this.peds.spawn(8);

    this.ready = true;
    this.cb.onReady();
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  lock() {
    sfx.unlock();
    if (this.touch) {
      this.setPlaying(true);
      return;
    }
    this.renderer.domElement.requestPointerLock();
  }

  pause() {
    if (this.touch && this.locked) this.setPlaying(false);
  }

  private setPlaying(on: boolean) {
    if (on === this.locked) return;
    this.locked = on;
    if (on) {
      this.acc = 0;
      this.lastT = performance.now();
      this.keys.clear();
    } else {
      this.cb.onBubblePos(0, 0, false);
      this.bubble = null;
      this.setPrompt(false);
      this.tMove.x = 0;
      this.tMove.z = 0;
      this.tLook.x = 0;
      this.tLook.y = 0;
      this.tSprint = false;
    }
    this.cb.onLockChange(on);
  }

  /* -------- touch input API -------- */
  setMove(x: number, z: number) {
    this.tMove.x = x;
    this.tMove.z = z;
  }
  look(dx: number, dy: number) {
    this.tLook.x += dx;
    this.tLook.y += dy;
  }
  setSprint(on: boolean) {
    this.tSprint = on;
  }
  jump() {
    if (this.locked && this.ready) this.player.queueJump();
  }
  talk() {
    if (this.locked && this.ready) this.interact();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onLockChanged);
    document.removeEventListener("visibilitychange", this.onVis);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container)
      this.container.removeChild(this.renderer.domElement);
  }

  /* ---------------- input ---------------- */
  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space") e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (!this.locked || !this.ready) return;
    if (e.code === "Space") this.player.queueJump();
    if (e.code === "KeyE") this.interact();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked || !this.ready) return;
    this.player.rotate(e.movementX, e.movementY);
  };

  private onLockChanged = () => {
    if (this.touch) return;
    this.setPlaying(document.pointerLockElement === this.renderer.domElement);
  };

  private onVis = () => {
    if (document.hidden && this.touch && this.locked) this.setPlaying(false);
  };

  /* ---------------- interaction ---------------- */
  private interact() {
    const ped = this.peds.nearest(this.player.pos, 3.0);
    if (!ped) return;
    this.peds.engage(ped, this.player.pos);
    const text = DIALOGUE[Math.floor(Math.random() * DIALOGUE.length)];
    this.sayKey++;
    this.cb.onSay({ name: ped.name, text, accent: ped.accent, key: this.sayKey });
    this.bubble = { ped, ttl: 4.2 };
    sfx.talk();
  }

  private setPrompt(show: boolean) {
    if (show !== this.promptShown) {
      this.promptShown = show;
      this.cb.onPrompt(show);
    }
  }

  private project(worldPos: THREE.Vector3, yOffset: number) {
    this.proj.copy(worldPos);
    this.proj.y += yOffset;
    this.proj.project(this.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return {
      x: (this.proj.x * 0.5 + 0.5) * w,
      y: (-this.proj.y * 0.5 + 0.5) * h,
      visible: this.proj.z < 1,
    };
  }

  /* ---------------- main loop ---------------- */
  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;

    if (this.locked && this.ready) {
      try {
        this.simulate(dt);
      } catch (e) {
        // physics must never freeze the game — log once, keep rendering
        if (!this.simWarned) {
          this.simWarned = true;
          console.error("[sunnyside] simulation error (recovered):", e);
        }
      }
    }

    if (this.ready) {
      this.player.updateCamera(this.locked ? dt : 0.0001);
      this.updateBubbleAndMarker();
      this.drawMinimap();
      this.renderer.render(this.scene, this.camera);
    }
  };

  private simulate(dt: number) {
    this.simT += dt;
    this.acc = Math.min(this.acc + dt, STEP * 5);
    let iters = 0;
    while (this.acc >= STEP && iters < 5) {
      this.world.step();
      this.acc -= STEP;
      iters++;
    }

    if (this.touch) {
      this.player.rotate(this.tLook.x, this.tLook.y);
      this.tLook.x = 0;
      this.tLook.y = 0;
    }
    const k = this.keys;
    const cl = (v: number) => Math.max(-1, Math.min(1, v));
    const moveZ = cl((k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + this.tMove.z);
    const moveX = cl((k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + this.tMove.x);
    this.player.update(dt, {
      moveX,
      moveZ,
      sprint: k.has("ShiftLeft") || k.has("ShiftRight") || this.tSprint,
    });
    this.peds.update(dt, this.player.pos);
    this.city.animate(this.simT, dt);

    // fell off the world? drop them back at the corner
    if (this.player.pos.y < -6) {
      this.player.body.setNextKinematicTranslation({ x: SPAWN.x, y: SPAWN.y + 1, z: SPAWN.z });
    }

    this.updateZones(dt);
    this.updateInteraction();
    this.updateClock(dt);
  }

  private updateZones(dt: number) {
    this.zoneTimer -= dt;
    if (this.zoneTimer > 0) return;
    this.zoneTimer = 0.15;
    let found: Zone | null = null;
    const ph = this.player.collider.handle;
    for (const z of this.city.zones) {
      let inside = false;
      this.world.intersectionPairsWith(z.sensor, (other) => {
        if (other.handle === ph) inside = true;
      });
      if (inside) {
        found = z;
        break;
      }
    }
    if (found !== this.currentZone) {
      this.currentZone = found;
      sfx.zone();
      this.cb.onZone(found ? { name: found.name, sub: found.sub, accent: found.accent } : null);
    }
  }

  private updateInteraction() {
    this.markerPed = this.peds.nearest(this.player.pos, 3.0);
    this.setPrompt(!!this.markerPed);
    if (this.bubble) {
      this.bubble.ttl -= 1 / 60;
      if (this.bubble.ttl <= 0) this.bubble = null;
    }
  }

  private updateBubbleAndMarker() {
    if (this.markerPed && this.locked) {
      const t = this.markerPed.body.translation();
      const p = this.project(new THREE.Vector3(t.x, t.y, t.z), 1.25);
      this.cb.onMarker(p.x, p.y, p.visible);
    } else {
      this.cb.onMarker(0, 0, false);
    }
    if (this.bubble && this.locked) {
      const t = this.bubble.ped.body.translation();
      const p = this.project(new THREE.Vector3(t.x, t.y, t.z), 1.45);
      this.cb.onBubblePos(p.x, p.y, p.visible);
    }
  }

  private updateClock(dt: number) {
    this.gameMinutes += dt * 0.55; // ~1 game minute per 2 real seconds
    if (this.gameMinutes >= 24 * 60) this.gameMinutes -= 24 * 60;
    this.clockTimer -= dt;
    if (this.clockTimer > 0) return;
    this.clockTimer = 1;
    const total = Math.floor(this.gameMinutes);
    let h = Math.floor(total / 60);
    const m = total % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const text = `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
    if (text !== this.lastClock) {
      this.lastClock = text;
      this.cb.onClock(text);
    }
  }

  /* ---------------- minimap ---------------- */
  private drawMinimap() {
    const c = this.minimap;
    const g = c.getContext("2d");
    if (!g) return;
    const S = c.width;
    const scale = S / 152;
    const px = (x: number) => (x + 76) * scale;
    const pz = (z: number) => (z + 76) * scale;

    g.fillStyle = "#31502f";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#575d66";
    for (const r of this.city.mapSidewalks)
      g.fillRect(px(r.x - r.w / 2), pz(r.z - r.d / 2), r.w * scale, r.d * scale);
    g.fillStyle = "#2b2f36";
    for (const r of this.city.mapRoads)
      g.fillRect(px(r.x - r.w / 2), pz(r.z - r.d / 2), r.w * scale, r.d * scale);
    for (const b of this.city.mapBuildings) {
      g.fillStyle = b.color;
      g.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * scale, b.d * scale);
    }
    // pedestrians
    g.fillStyle = "#ffd257";
    for (const p of this.peds.peds) {
      const t = p.body.translation();
      g.beginPath();
      g.arc(px(t.x), pz(t.z), 2.1, 0, Math.PI * 2);
      g.fill();
    }
    // player arrow
    const pp = this.player.pos;
    g.save();
    g.translate(px(pp.x), pz(pp.z));
    g.rotate(-this.player.yaw);
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(4.4, 5);
    g.lineTo(0, 2.6);
    g.lineTo(-4.4, 5);
    g.closePath();
    g.fill();
    g.restore();
    g.strokeStyle = "rgba(255,255,255,0.25)";
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, S - 1, S - 1);
  }
}
