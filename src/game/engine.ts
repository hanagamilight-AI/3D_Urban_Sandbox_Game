import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { buildCity, type CityHandles, type Zone } from "./city";
import { Player } from "./player";
import { PedManager, DIALOGUE, type Ped } from "./peds";
import { CarManager, type Car } from "./cars";
import { RAY_IGNORE_LIMBS } from "./rig";
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
export type InteractKind = null | "talk" | "drive" | "exit";

export interface GameCallbacks {
  onReady: () => void;
  onLockChange: (locked: boolean) => void;
  onZone: (zone: ZoneInfo | null) => void;
  onPrompt: (kind: InteractKind) => void;
  onSay: (info: SayInfo) => void;
  onBubblePos: (x: number, y: number, visible: boolean) => void;
  onMarker: (x: number, y: number, visible: boolean) => void;
  onClock: (text: string) => void;
  onHealth: (hp: number) => void;
  onWanted: (stars: number) => void;
  onToast: (text: string | null) => void;
}

const STEP = 1 / 60;
const SPAWN = new THREE.Vector3(12, 1.4, 7);
const MAX_HEALTH = 100;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private world!: RAPIER.World;
  private city!: CityHandles;
  private player!: Player;
  private peds!: PedManager;
  private cars!: CarManager;

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
  private promptKind: InteractKind = null;
  private lastClock = "";
  private proj = new THREE.Vector3();
  private simWarned = false;

  readonly touch: boolean;
  private tMove = { x: 0, z: 0 };
  private tLook = { x: 0, y: 0 };
  private tSprint = false;
  private tFire = false;

  /* ---- new state: cars / gun / wanted / health ---- */
  private inCar: Car | null = null;
  private carCamPos = new THREE.Vector3();
  private fireHeld = false;
  private wanted = 0; // 0..5 (float, decays)
  private lastCrimeT = -999;
  private policeTimer = 0;
  private topUpTimer = 0;
  private health = MAX_HEALTH;
  private needsRespawn = false;
  private toastTimer = 0;

  /* ---- adaptive quality: back off pixel ratio / shadows when frames sag ---- */
  private sun!: THREE.DirectionalLight;
  private readonly maxPixelRatio = 1.75;
  private readonly prSteps = [1.75, 1.5, 1.25, 1];
  private prLevel = 0;
  private frameAcc = 0;
  private frameN = 0;
  private slowStreak = 0;
  private minimapTick = 0;

  constructor(
    private container: HTMLElement,
    private minimap: HTMLCanvasElement,
    private cb: GameCallbacks
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = "none";
    this.touch = window.matchMedia("(pointer: coarse)").matches;

    this.camera = new THREE.PerspectiveCamera(62, container.clientWidth / container.clientHeight, 0.1, 600);
    this.scene.background = new THREE.Color("#a9d9ec");
    this.scene.fog = new THREE.Fog(new THREE.Color("#a9d9ec").getHex(), 120, 420);

    // Soft ambient fill replaces the expensive per-pixel PointLights, so interiors
    // stay readable without any per-fragment point-light cost.
    const hemi = new THREE.HemisphereLight("#d8f0fa", "#5e8c4a", 1.15);
    this.scene.add(hemi);
    this.scene.add(new THREE.AmbientLight("#fff3e0", 0.55));
    const sun = new THREE.DirectionalLight("#fff1d6", 2.4);
    sun.position.set(60, 90, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 320;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.sun = sun;

    window.addEventListener("resize", this.onResize);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("pointerlockchange", this.onLockChanged);
    document.addEventListener("visibilitychange", this.onVis);
  }

  async start() {
    await RAPIER.init();
    try {
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
    this.cars = new CarManager();
    this.cars.spawn(this.world, this.scene, this.city.carSpawns);

    this.ready = true;
    this.cb.onReady();
    this.cb.onHealth(this.health);
    this.cb.onWanted(0);
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
      this.setPrompt(null);
      this.tMove.x = 0;
      this.tMove.z = 0;
      this.tLook.x = 0;
      this.tLook.y = 0;
      this.tSprint = false;
      this.tFire = false;
      this.fireHeld = false;
    }
    this.cb.onLockChange(on);
  }

  /* -------- touch / external input API -------- */
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
  setFire(on: boolean) {
    this.tFire = on;
  }
  jump() {
    if (this.locked && this.ready && !this.inCar) this.player.queueJump();
  }
  /** Context action: talk to a ped / enter a car / exit a car. */
  action() {
    if (!this.locked || !this.ready) return;
    if (this.inCar) {
      this.exitCar();
      return;
    }
    const ped = this.peds.nearest(this.player.pos, 3.0, "wander");
    if (ped) {
      this.talkTo(ped);
      return;
    }
    const car = this.cars.nearestCar(this.player.pos, 3.6);
    if (car) this.enterCar(car);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("pointerlockchange", this.onLockChanged);
    document.removeEventListener("visibilitychange", this.onVis);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container)
      this.container.removeChild(this.renderer.domElement);
  }

  /* ---------------- input handlers ---------------- */
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
    if (e.code === "Space") this.jump();
    if (e.code === "KeyE") this.action();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked || !this.ready || this.touch) return;
    this.player.rotate(e.movementX, e.movementY);
  };
  private onMouseDown = (e: MouseEvent) => {
    if (this.touch || !this.locked || !this.ready || e.button !== 0) return;
    this.fireHeld = true;
  };
  private onMouseUp = () => {
    this.fireHeld = false;
  };
  private onLockChanged = () => {
    if (this.touch) return;
    this.setPlaying(document.pointerLockElement === this.renderer.domElement);
  };
  private onVis = () => {
    if (document.hidden && this.touch && this.locked) this.setPlaying(false);
  };

  /* ---------------- cars ---------------- */
  private enterCar(car: Car) {
    this.inCar = car;
    this.player.setVisible(false);
    const t = car.pos;
    this.carCamPos.set(t.x, t.y + 4, t.z + 9);
    sfx.zone();
    this.toast("Hold W to drive · E to exit");
  }
  private exitCar() {
    if (!this.inCar) return;
    const c = this.inCar;
    this.inCar = null;
    const t = c.pos;
    // step out to the side of the car
    const q = c.rotY;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    const out = new THREE.Vector3(t.x + right.x * 2.6, Math.max(1.4, t.y), t.z + right.z * 2.6);
    this.player.body.setNextKinematicTranslation({ x: out.x, y: out.y, z: out.z });
    this.player.setVisible(true);
    sfx.zone();
  }

  /* ---------------- gun / crime ---------------- */
  private shoot() {
    if (this.inCar) return;
    if (!this.player.tryFire()) return;
    sfx.shoot();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const o = this.camera.position;
    const ray = new RAPIER.Ray({ x: o.x, y: o.y, z: o.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRay(ray, 130, true, undefined, RAY_IGNORE_LIMBS, undefined, this.player.body);
    if (!hit) return;
    const body = hit.collider.parent();
    const ped = body ? this.peds.bodyMap.get(body.handle) : undefined;
    if (!ped || ped.dead) return;
    const died = this.peds.damage(ped, 20);
    this.registerCrime(died ? 1.6 : 0.8);
    if (died && ped.mode === "police") this.toast("You downed an officer!");
  }

  private registerCrime(amount: number) {
    this.wanted = Math.min(5, this.wanted + amount);
    this.lastCrimeT = this.simT;
    this.cb.onWanted(Math.round(this.wanted));
    if (this.wanted >= 1) sfx.siren();
  }

  /* ---------------- health ---------------- */
  private damagePlayer(d: number) {
    if (this.health <= 0 || this.needsRespawn) return;
    this.health = Math.max(0, this.health - d);
    sfx.hurt();
    this.cb.onHealth(this.health);
    // Don't respawn inline: we're inside peds.update() mid-iteration, and
    // removing police bodies there corrupts the physics step. Defer it to the
    // end of the frame instead.
    if (this.health <= 0) this.needsRespawn = true;
  }
  private respawn() {
    this.health = MAX_HEALTH;
    this.wanted = 0;
    this.cb.onHealth(this.health);
    this.cb.onWanted(0);
    this.peds.clearPolice();
    if (this.inCar) this.exitCar();
    const h = this.city.hospitalSpawn;
    this.player.body.setNextKinematicTranslation({ x: h.x, y: h.y + 1, z: h.z });
    this.toast("Patched up at St. Sunnyside Hospital");
  }
  private toast(text: string) {
    this.cb.onToast(text);
    this.toastTimer = 3.2;
  }

  private setPrompt(kind: InteractKind) {
    if (kind !== this.promptKind) {
      this.promptKind = kind;
      this.cb.onPrompt(kind);
    }
  }

  private talkTo(ped: Ped) {
    this.peds.engage(ped, this.player.pos);
    const text = DIALOGUE[Math.floor(Math.random() * DIALOGUE.length)];
    this.sayKey++;
    this.cb.onSay({ name: ped.name, text, accent: ped.accent, key: this.sayKey });
    this.bubble = { ped, ttl: 4.2 };
    sfx.talk();
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
    const rawDt = (now - this.lastT) / 1000;
    const dt = Math.min(0.05, rawDt);
    this.lastT = now;

    if (this.locked && this.ready) {
      try {
        this.simulate(dt);
      } catch (e) {
        if (!this.simWarned) {
          this.simWarned = true;
          console.error("[sunnyside] simulation error (recovered):", e);
        }
      }
    }

    if (this.ready) {
      if (this.inCar) this.updateCarCamera(dt);
      else this.player.updateCamera(this.locked ? dt : 0.0001);
      this.updateBubbleAndMarker();
      // redraw the minimap every 3rd frame — it's a 2D canvas pass and
      // doesn't need 60fps to read clearly
      if (++this.minimapTick % 3 === 0) this.drawMinimap();
      this.renderer.render(this.scene, this.camera);
      this.governQuality(rawDt);
    }
  };

  /** Watch the average frame time and shed load before it turns into stutter. */
  private governQuality(rawDt: number) {
    this.frameAcc += rawDt;
    this.frameN++;
    if (this.frameN < 90) return; // evaluate once every ~90 frames
    const avg = this.frameAcc / this.frameN;
    this.frameAcc = 0;
    this.frameN = 0;
    if (avg > 0.024) {
      this.slowStreak++;
      if (this.slowStreak >= 2 && this.prLevel < this.prSteps.length) {
        this.slowStreak = 0;
        const next = Math.min(this.prLevel + 1, this.prSteps.length - 1);
        if (next !== this.prLevel) {
          this.prLevel = next;
          this.renderer.setPixelRatio(
            Math.min(window.devicePixelRatio, this.prSteps[this.prLevel])
          );
        } else {
          // already at the floor on resolution — drop real-time shadows entirely
          this.sun.castShadow = false;
        }
      }
    } else if (avg < 0.013) {
      this.slowStreak = 0;
    }
  }

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

    /* ---- driving ---- */
    if (this.inCar) {
      this.cars.update(dt, this.inCar, { throttle: moveZ, steer: moveX });
      // carry the (hidden) player with the car so zones/minimap track it
      const t = this.inCar.pos;
      this.player.body.setNextKinematicTranslation({ x: t.x, y: t.y + 1.2, z: t.z });
      // keep the minimap arrow + exit camera aligned with the car's heading
      const q = this.inCar.rotY;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
      this.player.yaw = Math.atan2(-fwd.x, -fwd.z);
    } else {
      this.cars.update(dt, null, { throttle: 0, steer: 0 });
      this.player.update(dt, {
        moveX,
        moveZ,
        sprint: k.has("ShiftLeft") || k.has("ShiftRight") || this.tSprint,
      });
    }

    /* ---- firing ---- */
    if ((this.fireHeld || this.tFire) && !this.inCar) this.shoot();

    /* ---- peds + police ---- */
    this.peds.update(dt, this.player.pos, (dmg) => this.damagePlayer(dmg));
    this.city.animate(this.simT, dt);

    /* ---- car vs ped run-overs ---- */
    if (this.inCar && this.inCar.speed > 6) {
      const ct = this.inCar.pos;
      for (const p of [...this.peds.peds]) {
        if (p.dead) continue;
        const t = p.body.translation();
        if (Math.hypot(t.x - ct.x, t.z - ct.z) < 2.2) {
          const died = this.peds.damage(p, 999);
          if (died) this.registerCrime(1.6);
        }
      }
    }

    /* ---- fell off the world? ---- */
    if (this.player.pos.y < -8 && !this.inCar) {
      this.player.body.setNextKinematicTranslation({ x: SPAWN.x, y: SPAWN.y + 1, z: SPAWN.z });
    }

    /* ---- wanted level & police reinforcements ---- */
    if (this.simT - this.lastCrimeT > 15 && this.wanted > 0) {
      this.wanted = Math.max(0, this.wanted - dt * 0.25);
      this.cb.onWanted(Math.round(this.wanted));
      if (this.wanted <= 0) this.peds.clearPolice();
    }
    const desiredPolice = Math.min(5, Math.round(this.wanted));
    const currentPolice = this.peds.peds.filter((p) => p.mode === "police" && !p.dead).length;
    this.policeTimer -= dt;
    if (desiredPolice > currentPolice && this.policeTimer <= 0) {
      this.policeTimer = 1.4;
      this.peds.spawnPolice(this.city.policeSpawn, 1);
    }

    /* ---- keep the town populated ---- */
    this.topUpTimer -= dt;
    const civilians = this.peds.peds.filter((p) => p.mode === "wander" && !p.dead).length;
    if (civilians < 6 && this.topUpTimer <= 0) {
      this.topUpTimer = 4;
      this.peds.spawn(1);
    }

    /* ---- hospital heals ---- */
    if (this.currentZone && this.currentZone.name.includes("HOSPITAL") && this.health < MAX_HEALTH) {
      this.health = Math.min(MAX_HEALTH, this.health + 9 * dt);
      this.cb.onHealth(Math.round(this.health));
    }

    /* ---- toast expiry ---- */
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.cb.onToast(null);
    }

    this.updateZones(dt);
    this.updateInteraction();
    this.updateClock(dt);

    /* ---- deferred respawn (safe point: physics step + ped iteration are done) ---- */
    if (this.needsRespawn) {
      this.needsRespawn = false;
      this.respawn();
    }
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
    if (this.inCar) {
      this.markerPed = null;
      this.setPrompt("exit");
    } else {
      const ped = this.peds.nearest(this.player.pos, 3.0, "wander");
      const car = this.cars.nearestCar(this.player.pos, 3.6);
      this.markerPed = ped;
      this.setPrompt(ped ? "talk" : car ? "drive" : null);
    }
    if (this.bubble) {
      this.bubble.ttl -= 1 / 60;
      if (this.bubble.ttl <= 0) this.bubble = null;
    }
  }

  private updateBubbleAndMarker() {
    if (this.markerPed && this.locked && !this.inCar) {
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

  private updateCarCamera(dt: number) {
    const c = this.inCar!;
    const t = c.pos;
    const q = c.rotY;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    const dist = 7 + c.speed * 0.12;
    const desired = new THREE.Vector3(t.x - fwd.x * dist, t.y + 3.4, t.z - fwd.z * dist);
    this.carCamPos.lerp(desired, Math.min(1, 6 * dt));
    this.camera.position.copy(this.carCamPos);
    this.camera.lookAt(t.x, t.y + 1.2, t.z);
    const targetFov = 62 + Math.min(14, c.speed * 0.6);
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 6 * dt);
      this.camera.updateProjectionMatrix();
    }
  }

  private updateClock(dt: number) {
    this.gameMinutes += dt * 0.55;
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
    const half = this.city ? this.city.mapHalf : 190;
    const scale = S / (half * 2);
    const px = (x: number) => (x + half) * scale;
    const pz = (z: number) => (z + half) * scale;

    g.fillStyle = "#31502f";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#575d66";
    for (const r of this.city.mapSidewalks) g.fillRect(px(r.x - r.w / 2), pz(r.z - r.d / 2), r.w * scale, r.d * scale);
    g.fillStyle = "#2b2f36";
    for (const r of this.city.mapRoads) g.fillRect(px(r.x - r.w / 2), pz(r.z - r.d / 2), r.w * scale, r.d * scale);
    for (const b of this.city.mapBuildings) {
      g.fillStyle = b.color;
      g.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * scale, b.d * scale);
    }
    // cars
    g.fillStyle = "#c9ccd4";
    for (const car of this.cars.cars) {
      const t = car.pos;
      g.fillRect(px(t.x) - 2, pz(t.z) - 2, 4, 4);
    }
    // pedestrians (civilians yellow, police red)
    for (const p of this.peds.peds) {
      if (p.dead) continue;
      const t = p.body.translation();
      g.fillStyle = p.mode === "police" ? "#ff5348" : "#ffd257";
      g.beginPath();
      g.arc(px(t.x), pz(t.z), 2, 0, Math.PI * 2);
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
