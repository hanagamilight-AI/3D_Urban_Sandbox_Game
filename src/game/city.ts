import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

/* ------------------------------------------------------------------ */
/*  Sunnyside Block — city geometry + static physics + zone sensors    */
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
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
  );
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
  const m = new THREE.Mesh(
    BGeo(w, h, 0.22),
    new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg, sub) })
  );
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

function addAwning(
  scene: THREE.Scene,
  c1: string,
  c2: string,
  x: number,
  y: number,
  z: number,
  w: number,
  dirZ: 1 | -1
) {
  const m = new THREE.Mesh(
    BGeo(w, 0.1, 2.3),
    new THREE.MeshStandardMaterial({ map: stripeTexture(c1, c2), roughness: 0.85 })
  );
  m.position.set(x, y, z + dirZ * 1.05);
  m.rotation.x = dirZ * -0.3;
  m.castShadow = true;
  scene.add(m);
  // support posts down to the ground
  for (const sx of [-w / 2 + 0.25, w / 2 - 0.25]) {
    const p = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 3.3, 6),
      M("#3c3a35")
    );
    p.position.set(x + sx, 1.65, z + dirZ * 1.9);
    scene.add(p);
  }
}

function addWindows(
  scene: THREE.Scene,
  wall: { x: number; y: number; z: number; horizontal: boolean; len: number },
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

  /* ----- ground + physics floor ----- */
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    M("#5e8c4a", { roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(110, 0.5, 110).setFriction(0.9), b);
  }

  /* ----- flat slab helper (visual layers above the physics floor) ----- */
  const slab = (r: Rect, color: string, top: number, arr?: Rect[]) => {
    mesh(scene, r.w, top, r.d, color, r.x, top / 2, r.z, { shadow: false, rough: 1 });
    arr?.push(r);
  };

  /* ----- roads ----- */
  const roadC = "#33373d";
  const crossEW: Rect = { x: 0, z: 0, w: 140, d: 10 }; // Maple Ave (E-W)
  const crossNS: Rect = { x: 0, z: 0, w: 10, d: 140 }; // 5th St (N-S)
  slab(crossEW, roadC, 0.05, mapRoads);
  slab(crossNS, roadC, 0.05, mapRoads);
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
      sidewalks.push({ x: q * 36.5, z: s * 7, w: 55, d: 4 }); // along Maple Ave
      sidewalks.push({ x: s * 7, z: q * 36.5, w: 4, d: 55 }); // along 5th St
      sidewalks.push({ x: q * 36, z: s * 62, w: 56, d: 4 }); // inside ring road
      sidewalks.push({ x: s * 62, z: q * 36, w: 4, d: 56 });
      sidewalks.push({ x: s * 62, z: q * 62, w: 4, d: 4 }); // ring corners
      sidewalks.push({ x: s * 7, z: q * 7, w: 4, d: 4 }); // intersection corners
    }
  }
  sidewalks.forEach((r) => slab(r, walkC, 0.09, mapSidewalks));

  /* ----- lane markings (instanced) ----- */
  {
    const dashGeo = BGeo(2.1, 0.02, 0.16);
    const dashMat = M("#e9c654", { roughness: 1 });
    const positions: { x: number; z: number; rot: boolean }[] = [];
    for (let x = -63; x <= 63; x += 5) if (Math.abs(x) > 9) positions.push({ x, z: 0, rot: false });
    for (let z = -63; z <= 63; z += 5) if (Math.abs(z) > 9) positions.push({ x: 0, z, rot: true });
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

  /* ----- street-name blades at the intersection ----- */
  addSignBoard(scene, "MAPLE AVE", "#1e7a44", "#f4f2e9", 6.4, 4.6, -6.4, 4.6, Math.PI / 4, undefined, 4.02);
  addSignBoard(scene, "5TH ST", "#1e7a44", "#f4f2e9", -6.4, 4.2, 6.4, 3.6, Math.PI / 4, undefined, 3.75);

  /* ================================================================ */
  /*  BUILDINGS — hollow interiors, open doors, static wall colliders  */
  /* ================================================================ */
  const H = 4; // wall height
  const T = 0.4; // wall thickness

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
    doorFace: "n" | "s";
  }

  function shell(spec: BuildingSpec, doorWidth = 2.4) {
    const { cx, cz, w, d, wall } = spec;
    const x0 = cx - w / 2,
      x1 = cx + w / 2,
      z0 = cz - d / 2,
      z1 = cz + d / 2;
    // back + side walls
    wallRun(cx, spec.doorFace === "s" ? z1 : z0, w, T, wall);
    wallRun(x0, cz, T, d, wall);
    wallRun(x1, cz, T, d, wall);
    // front wall split around the open doorway
    const fz = spec.doorFace === "s" ? z0 : z1;
    const seg = (w - doorWidth) / 2;
    wallRun(x0 + seg / 2, fz, seg, T, wall);
    wallRun(x1 - seg / 2, fz, seg, T, wall);
    // lintel above the door
    solid(scene, world, doorWidth, 1.1, T, wall, cx, H - 0.55, fz);
    // roof slab + parapet trim
    mesh(scene, w + 0.9, 0.32, d + 0.9, spec.trim, cx, H + 0.16, cz);
    mesh(scene, w + 0.9, 0.3, 0.25, spec.trim, cx, H + 0.42, z0 - 0.3, { shadow: false });
    mesh(scene, w + 0.9, 0.3, 0.25, spec.trim, cx, H + 0.42, z1 + 0.3, { shadow: false });
    // open door leaf, swung against the wall
    const hingeX = cx + doorWidth / 2 - 0.05;
    const leaf = mesh(scene, 0.09, 2.7, 1.15, "#7a5230", hingeX, 1.35, fz + (spec.doorFace === "s" ? -0.62 : 0.62));
    leaf.rotation.y = 0.15;
    // floor
    mesh(scene, w - T, 0.07, d - T, "#cfc9ba", cx, 0.035, cz, { shadow: false, rough: 1 });
    return { x0, x1, z0, z1 };
  }

  function zoneSensor(cx: number, cz: number, hw: number, hd: number, name: string, sub: string, accent: string) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, 1.9, cz));
    const sensor = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hw, 1.9, hd).setSensor(true),
      body
    );
    zones.push({ name, sub, accent, sensor });
  }

  /* ---------- 1 · FRESH MART (grocery, NE block) ---------- */
  {
    const spec: BuildingSpec = { cx: 26, cz: 22, w: 18, d: 14, wall: "#e8e3d4", trim: "#2c6e43", doorFace: "s" };
    const b = shell(spec);
    addAwning(scene, "#2c6e43", "#f2efe4", 26, 3.35, b.z0, 7.5, -1);
    addSignBoard(scene, "FRESH MART", "#14572f", "#f4f2e9", 26, 5.1, b.z0 - 0.45, 8.5, 0, "GROCERY · OPEN DAILY");
    addWindows(scene, { x: 20.9, y: 0, z: b.z0, horizontal: true, len: 7.8 }, 1, -1);
    addWindows(scene, { x: 31.1, y: 0, z: b.z0, horizontal: true, len: 7.8 }, 1, -1);
    addWindows(scene, { x: b.x1, y: 0, z: 22, horizontal: false, len: 14 }, 2, 1);
    // interior: shelving aisles (collidable), produce crates, till, freezer
    for (const sx of [21, 26, 31]) {
      solid(scene, world, 1.3, 1.7, 8, "#e5dfd0", sx, 0.85, 23.4);
      for (let i = 0; i < 4; i++)
        mesh(scene, 1.1, 0.22, 0.8, ["#d96a4a", "#e3b23c", "#5a8f5a", "#7d6aa8"][i], sx, 0.5 + i * 0.42, 23.4 + (i % 2 ? 0.2 : -0.2), { shadow: false });
    }
    solid(scene, world, 3.2, 1.05, 1.1, "#8a8478", 31.4, 0.52, 17.6); // till
    mesh(scene, 0.7, 0.5, 0.6, "#3a3f46", 31.4, 1.3, 17.6, { shadow: false });
    solid(scene, world, 9.5, 2.3, 1.0, "#9fb4bd", 24, 1.15, 28.25); // freezer wall
    mesh(scene, 9.2, 1.9, 0.12, "#274b5e", 24, 1.2, 27.7, { shadow: false, rough: 0.3 });
    for (let i = 0; i < 4; i++) mesh(scene, 1.0, 0.55, 1.0, "#b0793f", 18.6, 0.28, 17 + i * 1.2, { shadow: false });
    const pl = new THREE.PointLight("#fff3d8", 26, 22, 1.6);
    pl.position.set(26, 3.5, 22);
    scene.add(pl);
    zoneSensor(26, 22.6, 8.2, 6.2, "FRESH MART", "Grocery Store · aisle 3 restocked", "#4fbf7d");
    mapBuildings.push({ x: 26, z: 22, w: 18, d: 14, color: "#4fbf7d", label: "FRESH MART" });
  }

  /* ---------- 2 · THREAD & CO (clothing, NW block) ---------- */
  {
    const spec: BuildingSpec = { cx: -26, cz: 22, w: 14, d: 14, wall: "#494439", trim: "#d8a531", doorFace: "s" };
    const b = shell(spec);
    addAwning(scene, "#d8a531", "#33302a", -26, 3.35, b.z0, 6.5, -1);
    addSignBoard(scene, "THREAD & CO", "#26221a", "#f4c95d", -26, 5.1, b.z0 - 0.45, 8, 0, "CLOTHING · EST. 1987");
    addWindows(scene, { x: -29.4, y: 0, z: b.z0, horizontal: true, len: 4.8 }, 1, -1);
    addWindows(scene, { x: -22.6, y: 0, z: b.z0, horizontal: true, len: 4.8 }, 1, -1);
    addWindows(scene, { x: b.x0, y: 0, z: 22, horizontal: false, len: 14 }, 2, -1);
    // interior: garment rails + display tables + fitting block
    const railColors = ["#d96a4a", "#4a90b8", "#e3b23c", "#7d6aa8", "#5a8f5a", "#c96f8e"];
    for (const rx of [-30, -26, -22]) {
      solid(scene, world, 0.5, 1.85, 5.2, "#6d675c", rx, 0.92, 24.5);
      for (let i = 0; i < 5; i++)
        mesh(scene, 0.34, 0.85, 0.16, railColors[(i + rx) % 6 < 0 ? 0 : (i + Math.abs(rx)) % 6], rx, 1.25, 22.6 + i * 0.95, { shadow: false });
    }
    solid(scene, world, 2.6, 0.85, 2.6, "#a58e6b", -26, 0.42, 17.8); // display table
    mesh(scene, 1.6, 0.5, 1.6, "#c96f8e", -26, 1.1, 17.8, { shadow: false });
    solid(scene, world, 2.2, 2.5, 2.2, "#5c564a", -31.4, 1.25, 17.4); // fitting room
    mesh(scene, 0.9, 2.0, 0.1, "#9fb4bd", -31.4, 1.2, 16.24, { shadow: false, rough: 0.25 });
    const pl = new THREE.PointLight("#ffe9c0", 22, 20, 1.6);
    pl.position.set(-26, 3.5, 22);
    scene.add(pl);
    zoneSensor(-26, 22.6, 6.2, 6.2, "THREAD & CO", "Clothing Shop · new fall rack in", "#e8b84b");
    mapBuildings.push({ x: -26, z: 22, w: 14, d: 14, color: "#e8b84b", label: "THREAD & CO" });
  }

  /* ---------- 3 · CAFÉ LUNA (SE block) ---------- */
  {
    const spec: BuildingSpec = { cx: 24, cz: -20, w: 13, d: 11, wall: "#b9563f", trim: "#f2e4c9", doorFace: "n" };
    const b = shell(spec);
    addAwning(scene, "#f2e4c9", "#b9563f", 24, 3.35, b.z1, 6, 1);
    addSignBoard(scene, "CAFÉ LUNA", "#402018", "#ffd9a0", 24, 5.1, b.z1 + 0.45, 7, Math.PI, "ESPRESSO · PASTRIES");
    addWindows(scene, { x: 20.6, y: 0, z: b.z1, horizontal: true, len: 4.4 }, 1, 1);
    addWindows(scene, { x: 27.4, y: 0, z: b.z1, horizontal: true, len: 4.4 }, 1, 1);
    addWindows(scene, { x: b.x1, y: 0, z: -20, horizontal: false, len: 11 }, 2, 1);
    // interior: counter + espresso machine + round tables + stools
    solid(scene, world, 4.6, 1.1, 1.2, "#5c3a28", 28.1, 0.55, -23.6);
    mesh(scene, 1.1, 0.7, 0.7, "#8f979e", 28.4, 1.45, -23.6, { shadow: false, rough: 0.35 });
    mesh(scene, 0.14, 0.3, 0.14, "#c8ccd0", 28.4, 1.95, -23.6, { shadow: false });
    for (const [tx, tz] of [
      [20.5, -17.5],
      [24, -21.5],
      [27.5, -18],
    ] as const) {
      solid(scene, world, 1.0, 0.74, 1.0, "#6e4a30", tx, 0.37, tz);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.07, 18), M("#8a5c3c"));
      top.position.set(tx, 0.78, tz);
      top.castShadow = true;
      scene.add(top);
      mesh(scene, 0.2, 0.14, 0.2, "#f2e4c9", tx, 0.88, tz, { shadow: false }); // cup
    }
    solid(scene, world, 3.4, 1.9, 0.9, "#4a2f20", 20, 0.95, -24.6); // pastry case
    mesh(scene, 3.1, 1.2, 0.12, "#c9d6da", 20, 1.1, -24.1, { shadow: false, rough: 0.25 });
    const pl = new THREE.PointLight("#ffdca8", 24, 20, 1.6);
    pl.position.set(24, 3.4, -20);
    scene.add(pl);
    zoneSensor(24, -20.4, 5.8, 4.7, "CAFÉ LUNA", "Café · oat-milk flat whites today", "#ff8a70");
    mapBuildings.push({ x: 24, z: -20, w: 13, d: 11, color: "#ff8a70", label: "CAFÉ LUNA" });
  }

  /* ---------- 4 · LIBRARY (SW block — decorative, doors shut) ---------- */
  {
    const cx = -25,
      cz = -21,
      w = 15,
      d = 13;
    solid(scene, world, w, H, T, "#7c4a3a", cx, H / 2, cz - d / 2);
    solid(scene, world, w, H, T, "#7c4a3a", cx, H / 2, cz + d / 2);
    solid(scene, world, T, H, d, "#7c4a3a", cx - w / 2, H / 2, cz);
    solid(scene, world, T, H, d, "#7c4a3a", cx + w / 2, H / 2, cz);
    mesh(scene, w + 0.9, 0.32, d + 0.9, "#4c3028", cx, H + 0.16, cz);
    addSignBoard(scene, "LIBRARY", "#3c241c", "#e8d9b8", cx, 5.0, cz + d / 2 + 0.45, 7.5, Math.PI, "CLOSED FOR RENOVATIONS");
    addWindows(scene, { x: cx - 4, y: 0, z: cz + d / 2, horizontal: true, len: 6 }, 1, 1);
    addWindows(scene, { x: cx + 4, y: 0, z: cz + d / 2, horizontal: true, len: 6 }, 1, 1);
    mesh(scene, 2.3, 3.0, 0.18, "#5d4632", cx, 1.5, cz + d / 2 + 0.22, { shadow: false }); // boarded door
    mapBuildings.push({ x: cx, z: cz, w, d, color: "#8a6a5a", label: "LIBRARY" });
  }

  /* ================================================================ */
  /*  STREET LIFE — lamps, lights, trees, cars, fountain, clouds       */
  /* ================================================================ */

  for (const [lx, lz] of [
    [10.5, 10.5],
    [-10.5, 10.5],
    [10.5, -10.5],
    [-10.5, -10.5],
    [45, 9.6],
    [-45, 9.6],
    [9.6, -45],
    [-9.6, 45],
  ] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 5.2, 8), M("#3c4046"));
    pole.position.set(lx, 2.6, lz);
    pole.castShadow = true;
    scene.add(pole);
    mesh(scene, 1.4, 0.12, 0.12, "#3c4046", lx + (lx > 0 ? -0.7 : 0.7), 5.15, lz, { shadow: false });
    const head = mesh(scene, 0.7, 0.24, 0.4, "#f4f2e9", lx + (lx > 0 ? -1.3 : 1.3), 5.05, lz, {
      shadow: false,
      emissive: "#ffe9a8",
      ei: 0.55,
    });
    head.castShadow = false;
  }

  /* traffic lights at the intersection — they cycle */
  const trafficLights: { bulbs: THREE.Mesh[]; phases: number[] }[] = [];
  const bulbColors = ["#e35345", "#e9c654", "#59c26f"];
  for (const [tx, tz] of [
    [6.2, 6.2],
    [-6.2, 6.2],
    [6.2, -6.2],
    [-6.2, -6.2],
  ] as const) {
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
    trafficLights.push({ bulbs, phases: [0, 0, 0] });
  }

  /* trees */
  const trees: { g: THREE.Group; phase: number }[] = [];
  const treeSpots: [number, number][] = [
    [44, 42], [52, 16], [14, 48], [46, 54],
    [-44, 42], [-52, 16], [-14, 48], [-46, 54],
    [44, -42], [52, -16], [14, -48], [50, -50],
    [-44, -50], [-52, -16], [-14, -48], [-50, -44],
    [20, 58], [-20, -58], [58, 20], [-58, -20],
  ];
  for (const [txp, tzp] of treeSpots) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.8, 7), M("#6e4a30"));
    trunk.position.y = 0.9;
    trunk.castShadow = true;
    g.add(trunk);
    const greens = ["#4e7d3a", "#5c8f44", "#427034"];
    for (let i = 0; i < 3; i++) {
      const blob = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.25 - i * 0.28, 0),
        M(greens[i % 3], { flatShading: true, roughness: 1 })
      );
      blob.position.set((i - 1) * 0.5, 2.2 + i * 0.55, (i % 2 ? 0.4 : -0.3));
      blob.castShadow = true;
      g.add(blob);
    }
    g.position.set(txp, 0, tzp);
    const s = 0.85 + Math.random() * 0.5;
    g.scale.setScalar(s);
    scene.add(g);
    trees.push({ g, phase: Math.random() * Math.PI * 2 });
  }

  /* fountain plaza (SW far corner) */
  const fountain = new THREE.Group();
  {
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.3, 0.7, 24), M("#a8a08e"));
    basin.position.y = 0.35;
    basin.castShadow = true;
    basin.receiveShadow = true;
    fountain.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.1, 24), M("#5fa8c9", { roughness: 0.25 }));
    water.position.y = 0.66;
    fountain.add(water);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.6, 12), M("#a8a08e"));
    col.position.y = 1.2;
    col.castShadow = true;
    fountain.add(col);
    fountain.position.set(-45, 0, -45);
    scene.add(fountain);
    const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-45, 0.55, -45));
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.55, 3.2), fb);
  }
  const spout = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), M("#7cc4de", { roughness: 0.2 }));
  spout.position.set(-45, 2.2, -45);
  scene.add(spout);

  /* benches */
  for (const [bx, bz, ry] of [
    [-41, -45, Math.PI / 2],
    [-49, -45, -Math.PI / 2],
    [-20, 12.5, 0],
    [15.5, 12.5, 0],
  ] as const) {
    const bench = new THREE.Group();
    const seat = mesh(bench as unknown as THREE.Scene, 2.2, 0.12, 0.65, "#8a5c3c", 0, 0.52, 0, { shadow: false });
    bench.add(seat);
    const back = mesh(bench as unknown as THREE.Scene, 2.2, 0.5, 0.1, "#8a5c3c", 0, 0.85, -0.3, { shadow: false });
    bench.add(back);
    for (const lx of [-0.9, 0.9])
      bench.add(mesh(bench as unknown as THREE.Scene, 0.12, 0.52, 0.55, "#3c4046", lx, 0.26, 0, { shadow: false }));
    bench.position.set(bx, 0, bz);
    bench.rotation.y = ry;
    scene.add(bench);
  }

  /* fire hydrant + mailbox (tiny colliders — kickable vibes) */
  {
    const hb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(13.5, 0.45, -7));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.45, 0.3), hb);
    const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.9, 10), M("#d8452e"));
    hyd.position.set(13.5, 0.45, -7);
    hyd.castShadow = true;
    scene.add(hyd);
    mesh(scene, 0.5, 0.18, 0.4, "#d8452e", 13.5, 0.98, -7, { shadow: false });
  }
  {
    const mb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(36.8, 0.6, 7));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.35, 0.6, 0.3), mb);
    mesh(scene, 0.7, 0.9, 0.55, "#2b5fa8", 36.8, 0.75, 7);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 6), M("#3c4046"));
    post.position.set(36.8, 0.3, 7);
    scene.add(post);
  }

  /* parked cars (static obstacles) */
  function car(x: number, z: number, rotY: number, body: string) {
    const g = new THREE.Group();
    const lower = mesh(g as unknown as THREE.Scene, 4.3, 1.0, 1.9, body, 0, 0.7, 0);
    g.add(lower);
    const cabin = mesh(g as unknown as THREE.Scene, 2.3, 0.75, 1.7, body, -0.2, 1.55, 0);
    g.add(cabin);
    mesh(g as unknown as THREE.Scene, 2.1, 0.5, 1.5, "#26415c", -0.2, 1.55, 0, { shadow: false, rough: 0.25 });
    for (const [wx, wz] of [
      [-1.4, 0.95],
      [-1.4, -0.95],
      [1.4, 0.95],
      [1.4, -0.95],
    ] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12), M("#1c1e22"));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.38, wz);
      g.add(wheel);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    scene.add(g);
    const cb = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0.9, z).setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) })
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(2.25, 0.9, 1.05), cb);
  }
  car(-30, 67, 0, "#3d8b8b");
  car(24, -67, Math.PI, "#d8452e");
  car(3.6, 34, Math.PI / 2, "#e3b23c");
  car(-3.6, -38, -Math.PI / 2, "#5a6aa8");

  /* clouds */
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const cg = new THREE.Group();
    const cm = M("#ffffff", { roughness: 1 });
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(2.2 - j * 0.3, 10, 8), cm);
      puff.position.set(j * 2.4 - 3.4, (j % 2) * 0.8, (j % 3) * 0.8 - 0.8);
      puff.scale.y = 0.55;
      cg.add(puff);
    }
    cg.position.set(-110 + i * 42 + Math.random() * 12, 34 + Math.random() * 12, -70 + Math.random() * 140);
    scene.add(cg);
    clouds.push(cg);
  }

  /* café chimney steam */
  mesh(scene, 0.5, 1.1, 0.5, "#4c3028", 28.5, H + 0.7, -22.5, { shadow: false });
  const steam: { m: THREE.Mesh; t: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const sm = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 8, 8),
      new THREE.MeshBasicMaterial({ color: "#e8e6df", transparent: true, opacity: 0.55 })
    );
    sm.position.set(28.5, H + 1.4, -22.5);
    scene.add(sm);
    steam.push({ m: sm, t: i / 3 });
  }

  /* ---------------- animation hook ---------------- */
  const animate = (t: number, dt: number) => {
    for (const tr of trees) tr.g.rotation.z = Math.sin(t * 1.3 + tr.phase) * 0.025;
    for (const c of clouds) {
      c.position.x += dt * 1.6;
      if (c.position.x > 125) c.position.x = -125;
    }
    // traffic light cycle: green 6s / yellow 1.6s / red 5s
    const cyc = t % 12.6;
    const active = cyc < 6 ? 2 : cyc < 7.6 ? 1 : 0;
    for (const tl of trafficLights)
      tl.bulbs.forEach((b, i) => {
        (b.material as THREE.MeshStandardMaterial).emissiveIntensity = i === active ? 2.4 : 0.06;
      });
    spout.scale.setScalar(1 + Math.sin(t * 5) * 0.22);
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

  return { zones, pedLoops, mapRoads, mapSidewalks, mapBuildings, animate };
}
