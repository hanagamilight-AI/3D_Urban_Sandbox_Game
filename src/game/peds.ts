import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export const PED_NAMES = ["Sam", "Rio", "June", "Kofi", "Mara", "Nico", "Ada", "Bea", "Theo", "Lou", "Ivy", "Ozzy"];

export const DIALOGUE = [
  "Nice weather today!",
  "Welcome to our town!",
  "The Fresh Mart restocked aisle 3 — go have a look.",
  "I swear the traffic light has been red for an hour.",
  "Thread & Co just got their fall rack in. Very cozy.",
  "Café Luna's oat-milk flat white? Life-changing.",
  "Careful on the crosswalk, cyclists come out of nowhere.",
  "I walked 10,000 steps before breakfast. This town is my gym.",
  "You're new here, right? I can always tell.",
  "The library's been 'renovating' since 2019. Suspicious.",
  "If you hear splashing, that's just the fountain showing off.",
  "Legend says the mailbox on Maple Ave grants good saves.",
  "Jump if you want — gravity here is very forgiving.",
  "I once raced a cloud around the block. It cheated.",
];

const SHIRT_COLORS = ["#4a90b8", "#c96f8e", "#5a8f5a", "#7d6aa8", "#e3b23c", "#3d8b8b", "#b8604a", "#5a6aa8"];
const SKIN_COLORS = ["#e8b48a", "#c98e62", "#8a5c3c", "#f0c9a0", "#6e4a30"];

export interface Ped {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  group: THREE.Group;
  loop: THREE.Vector3[];
  nodeIdx: number;
  dir: 1 | -1;
  speed: number;
  pauseT: number;
  talkT: number;
  phase: number;
  name: string;
  accent: string;
}

export class PedManager {
  peds: Ped[] = [];
  private tmp = new THREE.Vector3();
  private look = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private world: RAPIER.World,
    private loops: THREE.Vector3[][]
  ) {}

  spawn(count: number) {
    for (let i = 0; i < count; i++) {
      const loop = this.loops[i % this.loops.length];
      const nodeIdx = Math.floor(Math.random() * loop.length);
      const next = (nodeIdx + 1) % loop.length;
      const t = Math.random();
      const pos = new THREE.Vector3().lerpVectors(loop[nodeIdx], loop[next], t);

      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, 1.0, pos.z)
          .enabledRotations(false, false, false)
          .setLinearDamping(0.4)
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.capsule(0.5, 0.34).setFriction(0.4).setDensity(1.4),
        body
      );

      const shirt = SHIRT_COLORS[i % SHIRT_COLORS.length];
      const group = new THREE.Group();
      const torso = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.32, 0.5, 5, 12),
        new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 })
      );
      torso.position.y = -0.05;
      torso.castShadow = true;
      group.add(torso);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 14, 12),
        new THREE.MeshStandardMaterial({ color: SKIN_COLORS[i % SKIN_COLORS.length], roughness: 0.75 })
      );
      head.position.y = 0.58;
      head.castShadow = true;
      group.add(head);
      // little beanie hat so every local has some personality
      const hat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.26, 0.16, 12),
        new THREE.MeshStandardMaterial({ color: SHIRT_COLORS[(i + 3) % SHIRT_COLORS.length], roughness: 0.9 })
      );
      hat.position.y = 0.76;
      group.add(hat);
      this.scene.add(group);

      this.peds.push({
        body,
        collider,
        group,
        loop,
        nodeIdx,
        dir: Math.random() > 0.5 ? 1 : -1,
        speed: 1.3 + Math.random() * 0.9,
        pauseT: 0,
        talkT: 0,
        phase: Math.random() * 10,
        name: PED_NAMES[i % PED_NAMES.length],
        accent: shirt,
      });
    }
  }

  nearest(point: THREE.Vector3, maxDist: number): Ped | null {
    let best: Ped | null = null;
    let bestD = maxDist;
    for (const p of this.peds) {
      const t = p.body.translation();
      const d = Math.hypot(t.x - point.x, t.z - point.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Pause a ped mid-stroll and make them face the player for a chat. */
  engage(p: Ped, playerPos: THREE.Vector3) {
    p.talkT = 2.6;
    p.pauseT = Math.max(p.pauseT, 2.6);
  }

  update(dt: number, playerPos: THREE.Vector3) {
    for (const p of this.peds) {
      const t = p.body.translation();
      p.phase += dt * p.speed * 4.2;

      if (p.pauseT > 0) {
        p.pauseT -= dt;
        if (p.talkT > 0) {
          p.talkT -= dt;
          const want = Math.atan2(playerPos.x - t.x, playerPos.z - t.z);
          let d = want - p.group.rotation.y;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          p.group.rotation.y += d * Math.min(1, 10 * dt);
        }
        p.body.setLinvel({ x: 0, y: p.body.linvel().y, z: 0 }, true);
      } else {
        const target = p.loop[p.nodeIdx];
        const dx = target.x - t.x;
        const dz = target.z - t.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.55) {
          // reached a sidewalk corner — maybe turn around, maybe pause
          const roll = Math.random();
          if (roll < 0.2) p.dir = (p.dir * -1) as 1 | -1;
          else p.nodeIdx = (p.nodeIdx + p.dir + p.loop.length) % p.loop.length;
          if (roll > 0.85) p.pauseT = 0.7 + Math.random() * 1.4;
        } else {
          const s = p.speed / dist;
          p.body.setLinvel({ x: dx * s, y: p.body.linvel().y, z: dz * s }, true);
          const want = Math.atan2(dx, dz);
          let d = want - p.group.rotation.y;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          p.group.rotation.y += d * Math.min(1, 8 * dt);
        }
      }

      p.group.position.set(t.x, t.y + Math.sin(p.phase) * 0.03 - 0.02, t.z);
    }
  }
}
