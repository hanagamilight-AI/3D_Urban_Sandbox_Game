import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Rig, ROOT_GROUPS, type RigLook } from "./rig";

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
  "They opened a whole MALL down south. My wallet weeps.",
  "The lake's lovely this time of year. Bring a towel.",
];

const JACKETS = ["#4a7fb5", "#7a4fb5", "#b54f6a", "#4fb57a", "#b5844f", "#5b8c85", "#a5533f", "#3f6fa5"];
const PANTS = ["#33415c", "#4a3b2f", "#2f4a3b", "#55524e", "#3c2f4a"];
const SKINS = ["#e8b48a", "#c68e5f", "#8d5a3b", "#f0c8a0", "#a06a44"];
const HAIRS = ["#2f2620", "#54402c", "#191714", "#7a6a52", "#8c4a2f"];
const HATS: (string | null)[] = [null, null, "#d8452e", "#2b5fa8", "#e0b23e", "#3c3a35"];

export type PedMode = "wander" | "police";

export interface Ped {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  rig: Rig;
  mode: PedMode;
  loop: THREE.Vector3[] | null;
  nodeIdx: number;
  dir: 1 | -1;
  speed: number;
  pauseT: number;
  talkT: number;
  yaw: number;
  name: string;
  accent: string;
  health: number;
  attackT: number; // police attack cooldown
  dead: boolean;
}

interface Blood {
  m: THREE.Mesh;
  v: THREE.Vector3;
  life: number;
}

export class PedManager {
  peds: Ped[] = [];
  /** every rigid body (root + limbs) → its ped, for bullet raycasts */
  bodyMap = new Map<number, Ped>();
  private blood: Blood[] = [];
  private quat = new THREE.Quaternion();
  private Y_AXIS = new THREE.Vector3(0, 1, 0);

  constructor(
    private scene: THREE.Scene,
    private world: RAPIER.World,
    private loops: THREE.Vector3[][]
  ) {}

  private buildPed(pos: THREE.Vector3, look: RigLook, mode: PedMode, name: string, accent: string): Ped {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y + 1.2, pos.z)
        .setLinearDamping(0.4)
        .setAngularDamping(0.9)
        .setCanSleep(false)
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.26).setFriction(0.4).setDensity(25).setCollisionGroups(ROOT_GROUPS),
      body
    );
    const rig = new Rig();
    rig.build(body, this.world, this.scene, look);

    const ped: Ped = {
      body,
      collider,
      rig,
      mode,
      loop: mode === "wander" ? this.loops[this.peds.length % Math.max(1, this.loops.length)] : null,
      nodeIdx: 0,
      dir: Math.random() > 0.5 ? 1 : -1,
      speed: mode === "police" ? 4.6 : 1.3 + Math.random() * 0.9,
      pauseT: 0,
      talkT: 0,
      yaw: 0,
      name,
      accent,
      health: mode === "police" ? 60 : 30,
      attackT: 0,
      dead: false,
    };
    this.register(ped);
    this.peds.push(ped);
    return ped;
  }

  private register(ped: Ped) {
    this.bodyMap.set(ped.body.handle, ped);
    for (const b of ped.rig.limbBodies) this.bodyMap.set(b.handle, ped);
  }
  private unregister(ped: Ped) {
    this.bodyMap.delete(ped.body.handle);
    for (const b of ped.rig.limbBodies) this.bodyMap.delete(b.handle);
  }

  /** Spawn wandering civilians. */
  spawn(count: number) {
    for (let i = 0; i < count; i++) {
      const loop = this.loops[i % this.loops.length];
      const nodeIdx = Math.floor(Math.random() * loop.length);
      const next = (nodeIdx + 1) % loop.length;
      const pos = new THREE.Vector3().lerpVectors(loop[nodeIdx], loop[next], Math.random());
      const jacket = JACKETS[i % JACKETS.length];
      const look: RigLook = {
        jacket,
        pants: PANTS[(i * 2 + 1) % PANTS.length],
        skin: SKINS[(i * 3 + 2) % SKINS.length],
        hair: HAIRS[(i * 2 + 3) % HAIRS.length],
        hat: HATS[(i * 5 + 1) % HATS.length],
        shoe: "#2e2b28",
      };
      const ped = this.buildPed(pos, look, "wander", PED_NAMES[i % PED_NAMES.length], jacket);
      ped.loop = loop;
      ped.nodeIdx = nodeIdx;
    }
  }

  /** Spawn police officers that hunt the player. */
  spawnPolice(at: THREE.Vector3, count: number) {
    for (let i = 0; i < count; i++) {
      const pos = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6));
      const look: RigLook = {
        jacket: "#274b8f",
        pants: "#1d2430",
        skin: SKINS[(i * 2 + 1) % SKINS.length],
        hair: HAIRS[i % HAIRS.length],
        hat: null,
        shoe: "#1a1a1a",
        police: true,
      };
      this.buildPed(pos, look, "police", "Officer " + PED_NAMES[(i * 3) % PED_NAMES.length], "#7fa8e8");
    }
  }

  nearest(point: THREE.Vector3, maxDist: number, mode: PedMode = "wander"): Ped | null {
    let best: Ped | null = null;
    let bestD = maxDist;
    for (const p of this.peds) {
      if (p.dead || p.mode !== mode) continue;
      const t = p.body.translation();
      const d = Math.hypot(t.x - point.x, t.z - point.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  engage(p: Ped, playerPos: THREE.Vector3) {
    p.talkT = 2.6;
    p.pauseT = Math.max(p.pauseT, 2.6);
  }

  /** Returns true if this killed the ped. */
  damage(p: Ped, amount: number): boolean {
    if (p.dead) return false;
    p.health -= amount;
    this.burst(p, 6);
    if (p.health <= 0) {
      this.kill(p);
      return true;
    }
    return false;
  }

  private burst(p: Ped, n: number) {
    const t = p.body.translation();
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 6, 5),
        new THREE.MeshBasicMaterial({ color: "#c2251c" })
      );
      m.position.set(t.x, t.y + 0.4 + Math.random() * 0.6, t.z);
      this.scene.add(m);
      this.blood.push({
        m,
        v: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5),
        life: 0.8,
      });
    }
  }

  private kill(p: Ped) {
    p.dead = true;
    this.unregister(p);
    p.rig.destroy(this.world, this.scene);
    this.world.removeRigidBody(p.body);
    this.peds = this.peds.filter((x) => x !== p);
  }

  /** Remove all police (used when the player is arrested/respawns). */
  clearPolice() {
    for (const p of [...this.peds]) if (p.mode === "police") this.kill(p);
  }

  update(dt: number, playerPos: THREE.Vector3, onPoliceAttack?: (dmg: number) => void) {
    // blood particles
    for (const b of [...this.blood]) {
      b.life -= dt;
      b.v.y -= 14 * dt;
      b.m.position.addScaledVector(b.v, dt);
      if (b.m.position.y < 0.05) b.m.position.y = 0.05;
      (b.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.life / 0.8);
      if (b.life <= 0) {
        this.scene.remove(b.m);
        this.blood = this.blood.filter((x) => x !== b);
      }
    }

    for (const p of this.peds) {
      if (p.dead) continue;
      const t = p.body.translation();
      let moveSpeed = 0;

      if (p.mode === "police") {
        // hunt the player
        const dx = playerPos.x - t.x;
        const dz = playerPos.z - t.z;
        const dist = Math.hypot(dx, dz);
        const want = Math.atan2(-dx, -dz);
        let d = want - p.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p.yaw += d * Math.min(1, 10 * dt);
        if (dist > 1.6) {
          const s = p.speed / Math.max(dist, 0.001);
          p.body.setLinvel({ x: dx * s, y: p.body.linvel().y, z: dz * s }, true);
          moveSpeed = p.speed;
        } else {
          p.body.setLinvel({ x: 0, y: p.body.linvel().y, z: 0 }, true);
          // melee swipe
          p.attackT -= dt;
          if (p.attackT <= 0 && onPoliceAttack) {
            p.attackT = 0.9;
            onPoliceAttack(8);
          }
        }
      } else if (p.pauseT > 0) {
        p.pauseT -= dt;
        if (p.talkT > 0) {
          p.talkT -= dt;
          const want = Math.atan2(-(playerPos.x - t.x), -(playerPos.z - t.z));
          let d = want - p.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          p.yaw += d * Math.min(1, 10 * dt);
        }
        p.body.setLinvel({ x: 0, y: p.body.linvel().y, z: 0 }, true);
      } else if (p.loop) {
        const target = p.loop[p.nodeIdx];
        const dx = target.x - t.x;
        const dz = target.z - t.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.55) {
          const roll = Math.random();
          if (roll < 0.2) p.dir = (p.dir * -1) as 1 | -1;
          else p.nodeIdx = (p.nodeIdx + p.dir + p.loop.length) % p.loop.length;
          if (roll > 0.85) p.pauseT = 0.7 + Math.random() * 1.4;
        } else {
          const s = p.speed / dist;
          p.body.setLinvel({ x: dx * s, y: p.body.linvel().y, z: dz * s }, true);
          moveSpeed = p.speed;
          const want = Math.atan2(-dx, -dz);
          let d = want - p.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          p.yaw += d * Math.min(1, 8 * dt);
        }
      }

      p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.quat.setFromAxisAngle(this.Y_AXIS, p.yaw);
      p.body.setRotation({ x: this.quat.x, y: this.quat.y, z: this.quat.z, w: this.quat.w }, true);

      p.rig.update(dt, moveSpeed);
      p.rig.syncFrom(p.body);
    }
  }
}
