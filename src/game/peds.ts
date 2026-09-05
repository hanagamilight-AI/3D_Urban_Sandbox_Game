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
];

const JACKETS = ["#4a7fb5", "#7a4fb5", "#b54f6a", "#4fb57a", "#b5844f", "#5b8c85", "#a5533f", "#3f6fa5"];
const PANTS = ["#33415c", "#4a3b2f", "#2f4a3b", "#55524e", "#3c2f4a"];
const SKINS = ["#e8b48a", "#c68e5f", "#8d5a3b", "#f0c8a0", "#a06a44"];
const HAIRS = ["#2f2620", "#54402c", "#191714", "#7a6a52", "#8c4a2f"];
const HATS: (string | null)[] = [null, null, "#d8452e", "#2b5fa8", "#e0b23e", "#3c3a35"];

export interface Ped {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  rig: Rig;
  loop: THREE.Vector3[];
  nodeIdx: number;
  dir: 1 | -1;
  speed: number;
  pauseT: number;
  talkT: number;
  yaw: number;
  name: string;
  accent: string;
}

export class PedManager {
  peds: Ped[] = [];
  private quat = new THREE.Quaternion();
  private Y_AXIS = new THREE.Vector3(0, 1, 0);

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
          .setTranslation(pos.x, 2.4, pos.z)
          .enabledRotations(false, false, false)
          .setLinearDamping(0.4)
          .setCanSleep(false)
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.capsule(0.55, 0.26)
          .setFriction(0.4)
          .setDensity(25)
          .setCollisionGroups(ROOT_GROUPS),
        body
      );

      const jacket = JACKETS[i % JACKETS.length];
      const look: RigLook = {
        jacket,
        pants: PANTS[(i * 2 + 1) % PANTS.length],
        skin: SKINS[(i * 3 + 2) % SKINS.length],
        hair: HAIRS[(i * 2 + 3) % HAIRS.length],
        hat: HATS[(i * 5 + 1) % HATS.length],
        shoe: "#2e2b28",
      };
      const rig = new Rig();
      rig.build(body, this.world, this.scene, look);

      this.peds.push({
        body,
        collider,
        rig,
        loop,
        nodeIdx,
        dir: Math.random() > 0.5 ? 1 : -1,
        speed: 1.3 + Math.random() * 0.9,
        pauseT: 0,
        talkT: 0,
        yaw: 0,
        name: PED_NAMES[i % PED_NAMES.length],
        accent: jacket,
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
      let moveSpeed = 0;

      if (p.pauseT > 0) {
        p.pauseT -= dt;
        if (p.talkT > 0) {
          p.talkT -= dt;
          // turn to face the player (character forward is local −Z)
          const want = Math.atan2(-(playerPos.x - t.x), -(playerPos.z - t.z));
          let d = want - p.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          p.yaw += d * Math.min(1, 10 * dt);
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
          moveSpeed = p.speed;
          const want = Math.atan2(-dx, -dz);
          let d = want - p.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          p.yaw += d * Math.min(1, 8 * dt);
        }
      }

      // the physics body carries the yaw so limb hinge axes track facing
      this.quat.setFromAxisAngle(this.Y_AXIS, p.yaw);
      p.body.setRotation({ x: this.quat.x, y: this.quat.y, z: this.quat.z, w: this.quat.w }, true);

      p.rig.update(dt, moveSpeed);
      p.rig.syncFrom(p.body);
    }
  }
}
