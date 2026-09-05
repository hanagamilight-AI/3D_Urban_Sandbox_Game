import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { CarSpawn } from "./cars";

/* ------------------------------------------------------------------ */
/*  Sunnyside City — geometry + static physics + zone sensors           */
/*  A much bigger open world: shops, hospital, police, mall, lake, beach */
/* ------------------------------------------------------------------ */

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}
export interface Zone {
  name: string;
  sub: string;
  accent: string;
  sensor: RAPIER.Collider;
}
export interface BuildingFootprint extends Rect {
  color: string;
  label: string;
}
export interface CityHandles {
  zones: Zone[];
  pedLoops: THREE.Vector3[][];
  mapRoads: Rect[];
  mapSidewalks: Rect[];
  mapBuildings: BuildingFootprint[];
  mapHalf: number;
  carSpawns: CarSpawn[];
  hospitalSpawn: THREE.Vector3;
  policeSpawn: THREE.Vector3;
  animate: (t: number, dt: number) => void;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function M(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.02, ...opts });
    matCache.set(key, m);
  }
  return m;
}

const boxGeoCache = new Map<string, THREE.BoxGeometry>();
function BGeo(w: number, h: number, d: number) {
  const k = `${w}|${h}|${d}`;
  let g = boxGeoCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    boxGeoCache.set(k, g);
  }
  return g;
}

function mesh(
  scene: THREE.Scene,
  w: number,
  h: number,
  d: number,
  color: string,
  x: number,
  y: number,
  z: number,
  opts: { shadow?: boolean; basic?: boolean; rough?: number; emissive?: string; ei?: number } = {}
) {
  const mat = opts.basic
    ? new THREE.MeshBasicMaterial({ color })
    : M(color, {
        roughness: opts.rough ?? 0.9,
        emissive: opts.emissive ? new THREE.Color(opts.emissive) : undefined,
        emissiveIntensity: opts.ei ?? 1,
      });
  const m = new THREE.Mesh(BGeo(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = opts.shadow !== false && h > 0.08;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

/** visual box + static cuboid collider */
function solid(
  scene: THREE.Scene,
  world: RAPIER.World,
  w: number,
  h: number,
  d: number,
  color: string,
  x: number,
  y: number,
  z: number,
  opts: Parameters<typeof mesh>[8] = {}
) {
  const m = mesh(scene, w, h, d, color, x, y, z, opts);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), body);
  return m;
}

/* ---------------- canvas textures ---------------- */
function signTexture(text: string, bg: string, fg: string, sub?: string) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = fg;
  g.lineWidth = 14;
  g.strokeRect(18, 18, c.width - 36, c.height - 36);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "120px Bungee, sans-serif";
  g.fillText(text, c.width / 2, sub ? 108 : c.height / 2);
  if (sub) {
    g.font = "44px 'Space Grotesk', sans-serif";
    g.fillText(sub, c.width / 2, 196);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function stripeTexture(c1: string, c2: string, n = 8) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  const w = c.width / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? c2 : c1;
    g.fillRect(i * w, 0, w, c.height);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addSignBoard(
  scene: THREE.Scene,
  text: string,
  bg: string,
  fg: string,
  x: number,
  y: number,
  z: number,
  w: number,
  rotY = 0,
  sub?: string,
  poleLen = 0.7
) {
  const h = w * 0.25;
  const g = new THREE.Group();
  const m = new THREE.Mesh(BGeo(w, h, 0.22), new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg, sub) }));
  m.castShadow = true;
  g.add(m);
  for (const sx of [-w / 2 + 0.5, w / 2 - 0.5]) {
    const post = new THREE.Mesh(BGeo(0.13, poleLen, 0.13), M("#3c3a35"));
    post.position.set(sx, -h / 2 - poleLen / 2, 0);
    g.add(post);
  }
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  scene.add(g);
}

function addAwning(scene: THREE.Scene, c1: string, c2: string, x: number, y: number, z: number, w: number, dirZ: 1 | -1) {
  const m = new THREE.Mesh(
    BGeo(w, 0.1, 2.3),
    new THREE.MeshStandardMaterial({ map: stripeTexture(c1, c2), roughness: 0.85 })
  );
  m.position.set(x, y, z + dirZ * 1.05);
  m.rotation.x = dirZ * -0.3;
  m.castShadow = true;
  scene.add(m);
  for (const sx of [-w / 2 + 0.25, w / 2 - 0.25]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.3, 6), M("#3c3a35"));
    p.position.set(x + sx, 1.65, z + dirZ * 1.9);
    scene.add(p);
  }
}

function addWindows(
  scene: THREE.Scene,
  wall: { x: number; z: number; horizontal: boolean; len: number },
  count: number,
  insetDir: 1 | -1
) {
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1) - 0.5;
    const off = t * (wall.len - 3);
    const wx = wall.horizontal ? wall.x + off : wall.x + insetDir * 0.24;
    const wz = wall.horizontal ? wall.z + insetDir * 0.24 : wall.z + off;
    const w = wall.horizontal ? 2.1 : 0.16;
    const d = wall.horizontal ? 0.16 : 2.1;
    mesh(scene, w, 1.5, d, "#26415c", wx, 2.1, wz, { shadow: false, rough: 0.35 });
    mesh(scene, w + 0.24, 0.14, d + 0.24, "#d8d4c8", wx, 2.92, wz, { shadow: false });
  }
}

/* ---------------- main builder ---------------- */
export function buildCity(scene: THREE.Scene, world: RAPIER.World): CityHandles {
  const mapRoads: Rect[] = [];
  const mapSidewalks: Rect[] = [];
  const mapBuildings: BuildingFootprint[] = [];
  const zones: Zone[] = [];

  /* ----- ground + physics floor (big world) ----- */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), M("#5e8c4a", { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(210, 0.5, 210).setFriction(0.9), b);
  }

  const slab = (r: Rect, color: string, top: number, arr?: Rect[]) => {
    mesh(scene, r.w, top, r.d, color, r.x, top / 2, r.z, { shadow: false, rough: 1 });
    arr?.push(r);
  };

  /* ----- roads ----- */
  const roadC = "#33373d";
  // Maple Ave — east/west artery (runs out toward the coast, stops at the sand)
  slab({ x: -30, z: 0, w: 260, d: 10 }, roadC, 0.05, mapRoads);
  // 5th St — north/south artery (hospital → mall)
  slab({ x: 0, z: 0, w: 10, d: 320 }, roadC, 0.05, mapRoads);
  // ring road around the old town block
  const ringRoads: Rect[] = [
    { x: 0, z: 67, w: 140, d: 6 },
    { x: 0, z: -67, w: 140, d: 6 },
    { x: 67, z: 0, w: 6, d: 128 },
    { x: -67, z: 0, w: 6, d: 128 },
  ];
  ringRoads.forEach((r) => slab(r, roadC, 0.05, mapRoads));

  /* ----- sidewalks ----- */
  const walkC = "#b7b0a0";
  const sidewalks: Rect[] = [];
  for (const s of [1, -1]) {
    for (const q of [1, -1]) {
      sidewalks.push({ x: q * 36.5, z: s * 7, w: 55, d: 4 });
      sidewalks.push({ x: s * 7, z: q * 36.5, w: 4, d: 55 });
      sidewalks.push({ x: q * 36, z: s * 62, w: 56, d: 4 });
      sidewalks.push({ x: s * 62, z: q * 36, w: 4, d: 56 });
      sidewalks.push({ x: s * 62, z: q * 62, w: 4, d: 4 });
      sidewalks.push({ x: s * 7, z: q * 7, w: 4, d: 4 });
    }
  }
  sidewalks.forEach((r) => slab(r, walkC, 0.09, mapSidewalks));
  // plazas in front of the big civic buildings
  slab({ x: 0, z: -99, w: 30, d: 8 }, walkC, 0.09, mapSidewalks); // hospital
  slab({ x: 0, z: 98, w: 40, d: 8 }, walkC, 0.09, mapSidewalks); // mall
  slab({ x: -99, z: 0, w: 8, d: 24 }, walkC, 0.09, mapSidewalks); // police

  /* ----- lane markings (instanced) along the arteries ----- */
  {
    const dashGeo = BGeo(2.1, 0.02, 0.16);
    const dashMat = M("#e9c654", { roughness: 1 });
    const positions: { x: number; z: number; rot: boolean }[] = [];
    for (let x = -155; x <= 95; x += 5) if (Math.abs(x) > 9) positions.push({ x, z: 0, rot: false });
    for (let z = -155; z <= 155; z += 5) if (Math.abs(z) > 9) positions.push({ x: 0, z, rot: true });
    const inst = new THREE.InstancedMesh(dashGeo, dashMat, positions.length);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    positions.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot ? Math.PI / 2 : 0);
      mtx.compose(new THREE.Vector3(p.x, 0.062, p.z), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, mtx);
    });
    scene.add(inst);
  }
  /* crosswalks at the central intersection */
  {
    const stripeGeo = BGeo(0.6, 0.02, 8.6);
    const stripeMat = M("#e8e6df", { roughness: 1 });
    const spots: { x: number; z: number; rot: boolean }[] = [];
    for (let i = 0; i < 6; i++) {
      const off = 6.3 + i * 0.95;
      spots.push({ x: off, z: 0, rot: false }, { x: -off, z: 0, rot: false });
      spots.push({ x: 0, z: off, rot: true }, { x: 0, z: -off, rot: true });
    }
    const inst = new THREE.InstancedMesh(stripeGeo, stripeMat, spots.length);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot ? Math.PI / 2 : 0);
      mtx.compose(new THREE.Vector3(p.x, 0.062, p.z), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, mtx);
    });
    scene.add(inst);
  }

  /* ----- street-name blades ----- */
  addSignBoard(scene, "MAPLE AVE", "#1e7a44", "#f4f2e9", 6.4, 4.6, -6.4, 4.6, Math.PI / 4, undefined, 4.02);
  addSignBoard(scene, "5TH ST", "#1e7a44", "#f4f2e9", -6.4, 4.2, 6.4, 3.6, Math.PI / 4, undefined, 3.75);

  /* ================================================================ */
  /*  BUILDINGS — hollow interiors, open doors, static wall colliders  */
  /* ================================================================ */
  const H = 4;
  const T = 0.4;

  function wallRun(x: number, z: number, w: number, d: number, color: string) {
    solid(scene, world, w, H, d, color, x, H / 2, z);
  }

  interface BuildingSpec {
    cx: number;
    cz: number;
    w: number;
    d: number;
    wall: string;
    trim: string;
    doorFace: "n" | "s" | "e" | "w";
  }

  function shell(spec: BuildingSpec, doorWidth = 2.4) {
    const { cx, cz, w, d, wall } = spec;
    const x0 = cx - w / 2,
      x1 = cx + w / 2,
      z0 = cz - d / 2,
      z1 = cz + d / 2;
    const face = spec.doorFace;

    if (face === "n" || face === "s") {
      const doorZ = face === "s" ? z0 : z1;
      const backZ = face === "s" ? z1 : z0;
      wallRun(cx, backZ, w, T, wall);
      wallRun(x0, cz, T, d, wall);
      wallRun(x1, cz, T, d, wall);
      const seg = (w - doorWidth) / 2;
      wallRun(x0 + seg / 2, doorZ, seg, T, wall);
      wallRun(x1 - seg / 2, doorZ, seg, T, wall);
      solid(scene, world, doorWidth, 1.1, T, wall, cx, H - 0.55, doorZ);
      const hingeX = cx + doorWidth / 2 - 0.05;
      const leaf = mesh(scene, 0.09, 2.7, 1.15, "#7a5230", hingeX, 1.35, doorZ + (face === "s" ? -0.62 : 0.62));
      leaf.rotation.y = 0.15;
    } else {
      const doorX = face === "w" ? x0 : x1;
      const backX = face === "w" ? x1 : x0;
      wallRun(backX, cz, T, d, wall);
      wallRun(cx, z0, w, T, wall);
      wallRun(cx, z1, w, T, wall);
      const seg = (d - doorWidth) / 2;
      wallRun(doorX, z0 + seg / 2, T, seg, wall);
      wallRun(doorX, z1 - seg / 2, T, seg, wall);
      solid(scene, world, T, 1.1, doorWidth, wall, doorX, H - 0.55, cz);
      const hingeZ = cz + doorWidth / 2 - 0.05;
      const leaf = mesh(scene, 1.15, 2.7, 0.09, "#7a5230", doorX + (face === "w" ? -0.62 : 0.62), 1.35, hingeZ);
      leaf.rotation.y = 0.15;
    }

    mesh(scene, w + 0.9, 0.32, d + 0.9, spec.trim, cx, H + 0.16, cz);
    mesh(scene, w + 0.9, 0.3, 0.25, spec.trim, cx, H + 0.42, z0 - 0.3, { shadow: false });
    mesh(scene, w + 0.9, 0.3, 0.25, spec.trim, cx, H + 0.42, z1 + 0.3, { shadow: false });
    mesh(scene, w - T, 0.07, d - T, "#cfc9ba", cx, 0.035, cz, { shadow: false, rough: 1 });
    return { x0, x1, z0, z1 };
  }

  function zoneSensor(cx: number, cz: number, hw: number, hd: number, name: string, sub: string, accent: string) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, 1.9, cz));
    const sensor = world.createCollider(RAPIER.ColliderDesc.cuboid(hw, 1.9, hd).setSensor(true), body);
    zones.push({ name, sub, accent, sensor });
  }

  /* ---------- FRESH MART (grocery, NE block) ---------- */
  {
    const spec: BuildingSpec = { cx: 26, cz: 22, w: 18, d: 14, wall: "#e8e3d4", trim: "#2c6e43", doorFace: "s" };
    const b = shell(spec);
    addAwning(scene, "#2c6e43", "#f2efe4", 26, 3.35, b.z0, 7.5, -1);
    addSignBoard(scene, "FRESH MART", "#14572f", "#f4f2e9", 26, 5.1, b.z0 - 0.45, 8.5, 0, "GROCERY · OPEN DAILY");
    for (const sx of [21, 26, 31]) {
      solid(scene, world, 1.3, 1.7, 8, "#e5dfd0", sx, 0.85, 23.4);
      for (let i = 0; i < 4; i++)
        mesh(scene, 1.1, 0.22, 0.8, ["#d96a4a", "#e3b23c", "#5a8f5a", "#7d6aa8"][i], sx, 0.5 + i * 0.42, 23.4 + (i % 2 ? 0.2 : -0.2), { shadow: false });
    }
    solid(scene, world, 3.2, 1.05, 1.1, "#8a8478", 31.4, 0.52, 17.6);
    solid(scene, world, 9.5, 2.3, 1.0, "#9fb4bd", 24, 1.15, 28.25);
    zoneSensor(26, 22.6, 8.2, 6.2, "FRESH MART", "Grocery Store · aisle 3 restocked", "#4fbf7d");
    mapBuildings.push({ x: 26, z: 22, w: 18, d: 14, color: "#4fbf7d", label: "FRESH MART" });
  }

  /* ---------- THREAD & CO (clothing, NW block) ---------- */
  {
    const spec: BuildingSpec = { cx: -26, cz: 22, w: 14, d: 14, wall: "#494439", trim: "#d8a531", doorFace: "s" };
    const b = shell(spec);
    addAwning(scene, "#d8a531", "#33302a", -26, 3.35, b.z0, 6.5, -1);
    addSignBoard(scene, "THREAD & CO", "#26221a", "#f4c95d", -26, 5.1, b.z0 - 0.45, 8, 0, "CLOTHING · EST. 1987");
    const railColors = ["#d96a4a", "#4a90b8", "#e3b23c", "#7d6aa8", "#5a8f5a", "#c96f8e"];
    for (const rx of [-30, -26, -22]) {
      solid(scene, world, 0.5, 1.85, 5.2, "#6d675c", rx, 0.92, 24.5);
      for (let i = 0; i < 5; i++)
        mesh(scene, 0.34, 0.85, 0.16, railColors[(i + Math.abs(rx)) % 6], rx, 1.25, 22.6 + i * 0.95, { shadow: false });
    }
    solid(scene, world, 2.6, 0.85, 2.6, "#a58e6b", -26, 0.42, 17.8);
    zoneSensor(-26, 22.6, 6.2, 6.2, "THREAD & CO", "Clothing Shop · new fall rack in", "#e8b84b");
    mapBuildings.push({ x: -26, z: 22, w: 14, d: 14, color: "#e8b84b", label: "THREAD & CO" });
  }

  /* ---------- CAFÉ LUNA (SE block) ---------- */
  {
    const spec: BuildingSpec = { cx: 24, cz: -20, w: 13, d: 11, wall: "#b9563f", trim: "#f2e4c9", doorFace: "n" };
    const b = shell(spec);
    addAwning(scene, "#f2e4c9", "#b9563f", 24, 3.35, b.z1, 6, 1);
    addSignBoard(scene, "CAFÉ LUNA", "#402018", "#ffd9a0", 24, 5.1, b.z1 + 0.45, 7, Math.PI, "ESPRESSO · PASTRIES");
    solid(scene, world, 4.6, 1.1, 1.2, "#5c3a28", 28.1, 0.55, -23.6);
    for (const [tx, tz] of [[20.5, -17.5], [24, -21.5], [27.5, -18]] as const) {
      solid(scene, world, 1.0, 0.74, 1.0, "#6e4a30", tx, 0.37, tz);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.07, 18), M("#8a5c3c"));
      top.position.set(tx, 0.78, tz);
      top.castShadow = true;
      scene.add(top);
    }
    zoneSensor(24, -20.4, 5.8, 4.7, "CAFÉ LUNA", "Café · oat-milk flat whites today", "#ff8a70");
    mapBuildings.push({ x: 24, z: -20, w: 13, d: 11, color: "#ff8a70", label: "CAFÉ LUNA" });
  }

  /* ---------- ST. SUNNYSIDE HOSPITAL (north) ---------- */
  const hospitalSpawn = new THREE.Vector3(0, 1.4, -100);
  {
    const spec: BuildingSpec = { cx: 0, cz: -115, w: 34, d: 22, wall: "#eceae4", trim: "#c0392b", doorFace: "n" };
    const b = shell(spec, 3.4);
    addSignBoard(scene, "HOSPITAL", "#c0392b", "#ffffff", 0, 5.4, b.z1 + 0.5, 9, Math.PI, "ST. SUNNYSIDE · ER 24H");
    // red cross on the facade
    mesh(scene, 1.0, 3.2, 0.2, "#d8452e", 0, 2.4, b.z1 + 0.25, { shadow: false, emissive: "#a3271c", ei: 0.4 });
    mesh(scene, 3.2, 1.0, 0.2, "#d8452e", 0, 2.4, b.z1 + 0.25, { shadow: false, emissive: "#a3271c", ei: 0.4 });
    // reception desk + beds
    solid(scene, world, 6, 1.1, 1.4, "#c8ccd4", -6, 0.55, -112);
    for (const bx of [6, 10, 14]) {
      solid(scene, world, 1.2, 0.6, 2.4, "#d8dee6", bx, 0.3, -120);
      mesh(scene, 1.1, 0.14, 0.7, "#f2f5f8", bx, 0.66, -120.7, { shadow: false });
    }
    solid(scene, world, 1.2, 2.2, 8, "#dfe3e8", -14, 1.1, -118); // supply wall

    // helipad on the roof
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.12, 24), M("#3c4046"));
    pad.position.set(8, H + 0.4, -115);
    scene.add(pad);
    mesh(scene, 2.6, 0.05, 0.7, "#f4c95d", 8, H + 0.48, -115, { shadow: false });
    zoneSensor(0, -114, 15, 9, "ST. SUNNYSIDE HOSPITAL", "Health regenerates inside · ER 24H", "#e86a5e");
    mapBuildings.push({ x: 0, z: -115, w: 34, d: 22, color: "#e86a5e", label: "HOSPITAL" });
  }

  /* ---------- POLICE PRECINCT (west) ---------- */
  const policeSpawn = new THREE.Vector3(-99, 1.4, 0);
  {
    const spec: BuildingSpec = { cx: -115, cz: 0, w: 24, d: 20, wall: "#3d4a63", trim: "#2b5fa8", doorFace: "e" };
    const b = shell(spec, 3.0);
    addSignBoard(scene, "POLICE", "#1d2430", "#9fc2ff", b.x1 + 0.5, 5.4, 0, 8, Math.PI / 2, "PRECINCT 5 · EST. 1962");
    // blue lamp above door
    const lamp = mesh(scene, 0.5, 0.5, 0.5, "#2b5fa8", b.x1 + 0.3, 3.2, 0, { shadow: false, emissive: "#3f7fd8", ei: 1.4 });
    lamp.castShadow = false;
    // desks + holding cells
    solid(scene, world, 5, 1.0, 1.6, "#5a6a85", -112, 0.5, -5);
    solid(scene, world, 1.4, 2.6, 6, "#4a5871", -124, 1.3, 4); // cell block
    mesh(scene, 0.12, 2.2, 5.6, "#9fc2ff", -123.2, 1.3, 4, { shadow: false, rough: 0.2 }); // bars
    zoneSensor(-115, 0, 10, 8, "POLICE PRECINCT 5", "Law & order · don't cause trouble", "#7fa8e8");
    mapBuildings.push({ x: -115, z: 0, w: 24, d: 20, color: "#7fa8e8", label: "POLICE" });
  }

  /* ---------- SUNNYSIDE MALL (south) ---------- */
  {
    const spec: BuildingSpec = { cx: 0, cz: 115, w: 44, d: 26, wall: "#c9bfa8", trim: "#8a6f4d", doorFace: "s" };
    const b = shell(spec, 4.4);
    addSignBoard(scene, "MALL", "#6b5335", "#ffe9b8", 0, 5.6, b.z0 - 0.5, 10, 0, "SUNNYSIDE · 40+ STORES");
    // storefront blocks inside
    for (const sx of [-14, -7, 7, 14]) {
      solid(scene, world, 4.6, 2.6, 1.2, ["#c96f8e", "#5a8f5a", "#4a90b8", "#e3b23c"][(sx + 14) / 7], sx, 1.3, 124);
    }
    // central atrium fountain
    const ab = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.5, 115));
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.5, 2.4), ab);
    const aw = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.8, 20), M("#a8a08e"));
    aw.position.set(0, 0.4, 115);
    aw.castShadow = true;
    scene.add(aw);
    const awat = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.1, 20), M("#5fa8c9", { roughness: 0.25 }));
    awat.position.set(0, 0.82, 115);
    scene.add(awat);
    // escalator block
    solid(scene, world, 5, 2.2, 3, "#8f8877", 18, 1.1, 110);
    zoneSensor(0, 115, 19, 10, "SUNNYSIDE MALL", "Shopping · food court on level 2", "#d8b86a");
    mapBuildings.push({ x: 0, z: 115, w: 44, d: 26, color: "#d8b86a", label: "MALL" });
  }

  /* ---------- LIBRARY (SW block — decorative) ---------- */
  {
    const cx = -25, cz = -21, w = 15, d = 13;
    solid(scene, world, w, H, T, "#7c4a3a", cx, H / 2, cz - d / 2);
    solid(scene, world, w, H, T, "#7c4a3a", cx, H / 2, cz + d / 2);
    solid(scene, world, T, H, d, "#7c4a3a", cx - w / 2, H / 2, cz);
    solid(scene, world, T, H, d, "#7c4a3a", cx + w / 2, H / 2, cz);
    mesh(scene, w + 0.9, 0.32, d + 0.9, "#4c3028", cx, H + 0.16, cz);
    addSignBoard(scene, "LIBRARY", "#3c241c", "#e8d9b8", cx, 5.0, cz + d / 2 + 0.45, 7.5, Math.PI, "CLOSED FOR RENOVATIONS");
    mesh(scene, 2.3, 3.0, 0.18, "#5d4632", cx, 1.5, cz + d / 2 + 0.22, { shadow: false });
    mapBuildings.push({ x: cx, z: cz, w, d, color: "#8a6a5a", label: "LIBRARY" });
  }

  /* ================================================================ */
  /*  LAKE + BEACH (east coast)                                        */
  /* ================================================================ */
  // sandy beach strip
  slab({ x: 108, z: 0, w: 26, d: 130 }, "#e3cd9a", 0.06);
  // lake bed + water (visual; you can wade in)
  const lakeBed = new THREE.Mesh(new THREE.CircleGeometry(48, 40), M("#3f6f7d", { roughness: 1 }));
  lakeBed.rotation.x = -Math.PI / 2;
  lakeBed.position.set(150, 0.02, 0);
  scene.add(lakeBed);
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(48, 40),
    new THREE.MeshStandardMaterial({ color: "#4f9ec4", roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 })
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(150, 0.14, 0);
  scene.add(lake);
  // wooden dock out into the lake
  for (let i = 0; i < 4; i++) {
    solid(scene, world, 3, 0.22, 5, "#a5824f", 122 + i * 5, 0.35, -14);
  }
  for (const [px, pz] of [[121, -16.4], [121, -11.6], [139, -16.4], [139, -11.6]] as const) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.2, 8), M("#8a6a3f"));
    post.position.set(px, 0.4, pz);
    scene.add(post);
  }
  zoneSensor(150, 0, 40, 40, "LAKE AZURE", "Go on — take a dip", "#6fc2e8");
  zoneSensor(106, 0, 11, 45, "SANDY COVE BEACH", "Sun's out · palms out", "#e8cf8a");

  /* beach props: palms, umbrellas, lifeguard tower */
  const palms: { g: THREE.Group; phase: number }[] = [];
  function palm(x: number, z: number) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 3.6, 7), M("#9a7a4a"));
    trunk.position.y = 1.8;
    trunk.rotation.z = 0.12;
    trunk.castShadow = true;
    g.add(trunk);
    const frondMat = M("#4e8f4a", { flatShading: true, roughness: 1 });
    for (let i = 0; i < 6; i++) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 5), frondMat);
      const a = (i / 6) * Math.PI * 2;
      frond.position.set(Math.cos(a) * 0.9, 3.7, Math.sin(a) * 0.9);
      frond.rotation.z = Math.cos(a) * 1.1;
      frond.rotation.x = -Math.sin(a) * 1.1;
      frond.castShadow = true;
      g.add(frond);
    }
    g.position.set(x, 0, z);
    scene.add(g);
    palms.push({ g, phase: Math.random() * Math.PI * 2 });
  }
  palm(96, -40); palm(100, 20); palm(95, 55); palm(112, -52); palm(114, 42); palm(98, -8);
  // umbrellas
  for (const [ux, uz, c] of [[104, -25, "#d96a4a"], [106, 15, "#4a90b8"], [103, 40, "#e3b23c"]] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), M("#c9c2b0"));
    pole.position.set(ux, 1.2, uz);
    scene.add(pole);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.8, 8), M(c, { flatShading: true }));
    top.position.set(ux, 2.6, uz);
    top.castShadow = true;
    scene.add(top);
  }
  // lifeguard tower
  {
    const g = new THREE.Group();
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6), M("#c9a86a"));
      leg.position.set(lx, 1.2, lz);
      g.add(leg);
    }
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 2.2), M("#e8d9b0"));
    cab.position.y = 3.0;
    cab.castShadow = true;
    g.add(cab);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.0, 0.8, 4), M("#d96a4a"));
    roof.position.y = 4.2;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    g.position.set(110, 0, -2);
    scene.add(g);
    const tb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(110, 1.5, -2));
    world.createCollider(RAPIER.ColliderDesc.cuboid(1.2, 1.5, 1.1), tb);
  }

  /* ================================================================ */
  /*  STREET LIFE — lamps, lights, trees, fountain, clouds             */
  /* ================================================================ */
  for (const [lx, lz] of [
    [10.5, 10.5], [-10.5, 10.5], [10.5, -10.5], [-10.5, -10.5],
    [45, 9.6], [-45, 9.6], [9.6, -45], [-9.6, 45],
    [6.5, 80], [-6.5, -80], [6.5, -95], [-6.5, 95], [-80, 6.5], [-95, -6.5],
  ] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 5.2, 8), M("#3c4046"));
    pole.position.set(lx, 2.6, lz);
    pole.castShadow = true;
    scene.add(pole);
    const head = mesh(scene, 0.7, 0.24, 0.4, "#f4f2e9", lx, 5.05, lz, { shadow: false, emissive: "#ffe9a8", ei: 0.55 });
    head.castShadow = false;
  }

  /* traffic lights at the intersection */
  const trafficLights: { bulbs: THREE.Mesh[] }[] = [];
  const bulbColors = ["#e35345", "#e9c654", "#59c26f"];
  for (const [tx, tz] of [[6.2, 6.2], [-6.2, 6.2], [6.2, -6.2], [-6.2, -6.2]] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.4, 8), M("#3c4046"));
    pole.position.set(tx, 2.2, tz);
    scene.add(pole);
    const housing = mesh(scene, 0.55, 1.5, 0.5, "#22262c", tx, 4.0, tz);
    housing.castShadow = false;
    const bulbs = bulbColors.map((c, i) => {
      const bm = new THREE.MeshStandardMaterial({ color: "#1a1a1a", emissive: new THREE.Color(c), emissiveIntensity: 0.05, roughness: 0.4 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), bm);
      bulb.position.set(tx, 4.45 - i * 0.45, tz + (tz > 0 ? -0.26 : 0.26));
      scene.add(bulb);
      return bulb;
    });
    trafficLights.push({ bulbs });
  }

  /* trees */
  const trees: { g: THREE.Group; phase: number }[] = [];
  const treeSpots: [number, number][] = [
    [44, 42], [52, 16], [14, 48], [46, 54],
    [-44, 42], [-52, 16], [-14, 48], [-46, 54],
    [44, -42], [52, -16], [14, -48], [50, -50],
    [-44, -50], [-52, -16], [-14, -48], [-50, -44],
    [20, 58], [-20, -58], [58, 20], [-58, -20],
    [30, -90], [-30, -90], [30, 90], [-30, 90], [-90, 30], [-90, -30],
  ];
  for (const [txp, tzp] of treeSpots) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.8, 7), M("#6e4a30"));
    trunk.position.y = 0.9;
    trunk.castShadow = true;
    g.add(trunk);
    const greens = ["#4e7d3a", "#5c8f44", "#427034"];
    for (let i = 0; i < 3; i++) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25 - i * 0.28, 0), M(greens[i % 3], { flatShading: true, roughness: 1 }));
      blob.position.set((i - 1) * 0.5, 2.2 + i * 0.55, i % 2 ? 0.4 : -0.3);
      blob.castShadow = true;
      g.add(blob);
    }
    g.position.set(txp, 0, tzp);
    g.scale.setScalar(0.85 + Math.random() * 0.5);
    scene.add(g);
    trees.push({ g, phase: Math.random() * Math.PI * 2 });
  }

  /* fountain plaza (SW far corner) */
  const spoutPos = new THREE.Vector3(-45, 2.2, -45);
  {
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.3, 0.7, 24), M("#a8a08e"));
    basin.position.set(-45, 0.35, -45);
    basin.castShadow = true;
    scene.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.1, 24), M("#5fa8c9", { roughness: 0.25 }));
    water.position.set(-45, 0.66, -45);
    scene.add(water);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.6, 12), M("#a8a08e"));
    col.position.set(-45, 1.2, -45);
    scene.add(col);
    const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-45, 0.55, -45));
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.55, 3.2), fb);
  }
  const spout = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), M("#7cc4de", { roughness: 0.2 }));
  spout.position.copy(spoutPos);
  scene.add(spout);

  /* benches */
  for (const [bx, bz, ry] of [[-41, -45, Math.PI / 2], [-49, -45, -Math.PI / 2], [-20, 12.5, 0], [15.5, 12.5, 0]] as const) {
    const bench = new THREE.Group();
    bench.add(mesh(bench as unknown as THREE.Scene, 2.2, 0.12, 0.65, "#8a5c3c", 0, 0.52, 0, { shadow: false }));
    bench.add(mesh(bench as unknown as THREE.Scene, 2.2, 0.5, 0.1, "#8a5c3c", 0, 0.85, -0.3, { shadow: false }));
    for (const lx of [-0.9, 0.9]) bench.add(mesh(bench as unknown as THREE.Scene, 0.12, 0.52, 0.55, "#3c4046", lx, 0.26, 0, { shadow: false }));
    bench.position.set(bx, 0, bz);
    bench.rotation.y = ry;
    scene.add(bench);
  }

  /* fire hydrant + mailbox */
  {
    const hb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(13.5, 0.45, -7));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.45, 0.3), hb);
    const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.9, 10), M("#d8452e"));
    hyd.position.set(13.5, 0.45, -7);
    scene.add(hyd);
  }
  {
    const mb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(36.8, 0.6, 7));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.35, 0.6, 0.3), mb);
    mesh(scene, 0.7, 0.9, 0.55, "#2b5fa8", 36.8, 0.75, 7);
  }

  /* drivable car spawn points (CarManager builds the bodies) */
  const carSpawns: CarSpawn[] = [
    { x: -14, z: 8.5, rotY: 0, color: "#d8452e" },
    { x: 14, z: -8.5, rotY: Math.PI, color: "#3d8b8b" },
    { x: 8.5, z: 40, rotY: Math.PI / 2, color: "#e3b23c" },
    { x: -8.5, z: -40, rotY: -Math.PI / 2, color: "#5a6aa8" },
    { x: 12, z: -96, rotY: 0, color: "#e9e7e0" },
    { x: 22, z: 96, rotY: Math.PI, color: "#7d6aa8" },
    { x: -96, z: 14, rotY: Math.PI / 2, color: "#2b5fa8" },
    { x: 90, z: 24, rotY: Math.PI / 2, color: "#d96a4a" },
  ];

  /* clouds */
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 7; i++) {
    const cg = new THREE.Group();
    const cm = M("#ffffff", { roughness: 1 });
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(2.2 - j * 0.3, 10, 8), cm);
      puff.position.set(j * 2.4 - 3.4, (j % 2) * 0.8, ((j % 3) * 0.8) - 0.8);
      puff.scale.y = 0.55;
      cg.add(puff);
    }
    cg.position.set(-160 + i * 52 + Math.random() * 12, 34 + Math.random() * 14, -100 + Math.random() * 200);
    scene.add(cg);
    clouds.push(cg);
  }

  /* café chimney steam */
  mesh(scene, 0.5, 1.1, 0.5, "#4c3028", 28.5, H + 0.7, -22.5, { shadow: false });
  const steam: { m: THREE.Mesh; t: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const sm = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 8), new THREE.MeshBasicMaterial({ color: "#e8e6df", transparent: true, opacity: 0.55 }));
    sm.position.set(28.5, H + 1.4, -22.5);
    scene.add(sm);
    steam.push({ m: sm, t: i / 3 });
  }

  /* ---------------- animation hook ---------------- */
  const animate = (t: number, dt: number) => {
    for (const tr of trees) tr.g.rotation.z = Math.sin(t * 1.3 + tr.phase) * 0.025;
    for (const p of palms) p.g.rotation.z = 0.06 + Math.sin(t * 1.6 + p.phase) * 0.045;
    for (const c of clouds) {
      c.position.x += dt * 1.6;
      if (c.position.x > 190) c.position.x = -190;
    }
    const cyc = t % 12.6;
    const active = cyc < 6 ? 2 : cyc < 7.6 ? 1 : 0;
    for (const tl of trafficLights)
      tl.bulbs.forEach((b, i) => {
        (b.material as THREE.MeshStandardMaterial).emissiveIntensity = i === active ? 2.4 : 0.06;
      });
    spout.scale.setScalar(1 + Math.sin(t * 5) * 0.22);
    // gentle lake shimmer
    lake.material.opacity = 0.78 + Math.sin(t * 1.4) * 0.05;
    lake.position.y = 0.14 + Math.sin(t * 0.9) * 0.02;
    for (const s of steam) {
      s.t = (s.t + dt * 0.35) % 1;
      s.m.position.y = H + 1.4 + s.t * 2.4;
      (s.m.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - s.t);
      s.m.scale.setScalar(0.6 + s.t * 1.4);
    }
  };

  /* ---------------- pedestrian sidewalk loops ---------------- */
  const pedLoops: THREE.Vector3[][] = [];
  for (const sx of [1, -1])
    for (const sz of [1, -1])
      pedLoops.push([
        new THREE.Vector3(sx * 7, 0, sz * 7),
        new THREE.Vector3(sx * 62, 0, sz * 7),
        new THREE.Vector3(sx * 62, 0, sz * 62),
        new THREE.Vector3(sx * 7, 0, sz * 62),
      ]);
  // beach boardwalk loop + hospital plaza loop
  pedLoops.push([
    new THREE.Vector3(104, 0, -45),
    new THREE.Vector3(104, 0, 45),
    new THREE.Vector3(112, 0, 45),
    new THREE.Vector3(112, 0, -45),
  ]);
  pedLoops.push([
    new THREE.Vector3(-12, 0, -99),
    new THREE.Vector3(12, 0, -99),
    new THREE.Vector3(12, 0, -94),
    new THREE.Vector3(-12, 0, -94),
  ]);

  return {
    zones,
    pedLoops,
    mapRoads,
    mapSidewalks,
    mapBuildings,
    mapHalf: 190,
    carSpawns,
    hospitalSpawn,
    policeSpawn,
    animate,
  };
}
