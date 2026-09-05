import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

/* ------------------------------------------------------------------
 * Rig — a jointed humanoid.
 *
 * The torso/head ride on the character's existing root body (kinematic
 * for the player, dynamic for peds). Arms and legs are REAL dynamic
 * rigid bodies (capsules + foot boxes) attached with revolute impulse
 * joints at hips/knees/shoulders/elbows. A procedural gait drives
 * joint position-motors, so every swing carries momentum, gravity and
 * genuine collisions — limbs clatter off door frames, shelves and the
 * pavement.
 *
 * Conventions: characters face local −Z. A positive rotation about the
 * local +X axis swings a hanging limb forward.
 *
 * Collision groups (membership << 16 | filter):
 *   bit 1 — world/static geometry
 *   bit 2 — character root capsules
 *   bit 4 — rig limbs (filter: world only → no self/root tangling)
 * ------------------------------------------------------------------ */

export const GROUP_WORLD = 1;
export const GROUP_ROOT = 2;
export const GROUP_LIMB = 4;
/** membership << 16 | filter — this build packs groups into a plain number */
export const ROOT_GROUPS = (GROUP_ROOT << 16) | 0xffff;
export const LIMB_GROUPS = (GROUP_LIMB << 16) | GROUP_WORLD;
/** Ray filter that ignores limbs (used by the camera occlusion ray). */
export const RAY_IGNORE_LIMBS =
  ((0xffff & ~GROUP_LIMB) << 16) | (0xffff & ~GROUP_LIMB);

export interface RigLook {
  jacket: string;
  pants: string;
  skin: string;
  hair: string;
  hat: string | null;
  shoe: string;
}

/**
 * Rapier builds revolute joints either as a UnitImpulseJoint (flat API:
 * `setLimits(min, max)`) or as a GenericImpulseJoint (per-axis API:
 * `setLimits(axis, min, max)`), depending on the factory used and the
 * package version. This adapter detects the real signature once at build
 * time and always forwards the right call shape — so gait motors drive the
 * limbs no matter which wrapper the runtime returns.
 */
interface MotorJoint {
  setLimits(min: number, max: number): void;
  configureMotorModel(m: RAPIER.MotorModel): void;
  configureMotorPosition(target: number, stiffness: number, damping: number): void;
  setMotorMaxForce(f: number): void;
}

function wrapJoint(raw: unknown): MotorJoint {
  const j = raw as {
    setLimits: (...a: number[]) => void;
    configureMotorModel: (...a: unknown[]) => void;
    configureMotorPosition: (...a: number[]) => void;
    setMotorMaxForce: (...a: number[]) => void;
  };
  // generic joints take (axis, ...) — 4 params for configureMotorPosition
  const generic = j.configureMotorPosition.length >= 4;
  const AX = (RAPIER.JointAxis?.AngX ?? 3) as number;
  if (generic) {
    return {
      setLimits: (min, max) => j.setLimits(AX, min, max),
      configureMotorModel: (m) => j.configureMotorModel(AX, m),
      configureMotorPosition: (t, k, d) => j.configureMotorPosition(AX, t, k, d),
      setMotorMaxForce: (f) => j.setMotorMaxForce(AX, f),
    };
  }
  return {
    setLimits: (min, max) => j.setLimits(min, max),
    configureMotorModel: (m) => j.configureMotorModel(m),
    configureMotorPosition: (t, k, d) => j.configureMotorPosition(t, k, d),
    setMotorMaxForce: (f) => j.setMotorMaxForce(f),
  };
}

const X_AXIS = { x: 1, y: 0, z: 0 };
const capsuleVolume = (r: number, h: number) =>
  Math.PI * r * r * (2 * h + (4 * r) / 3);
const boxVolume = (hx: number, hy: number, hz: number) => 8 * hx * hy * hz;

const std = (color: string, rough = 0.85) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough });

interface LimbPart {
  body: RAPIER.RigidBody;
  joint: MotorJoint;
  obj: THREE.Group;
}

export class Rig {
  rootObj = new THREE.Group();
  private limbs: LimbPart[] = [];
  private jHipL!: MotorJoint;
  private jHipR!: MotorJoint;
  private jKneeL!: MotorJoint;
  private jKneeR!: MotorJoint;
  private jShL!: MotorJoint;
  private jShR!: MotorJoint;
  private jElL!: MotorJoint;
  private jElR!: MotorJoint;

  private phase = Math.random() * 6.28;
  private amp = 0;
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private motorWarned = false;

  private motor(j: MotorJoint, target: number, k: number, d: number) {
    try {
      j.configureMotorPosition(target, k, d);
    } catch (e) {
      // a degenerate joint must never take the game loop down with it
      if (!this.motorWarned) {
        this.motorWarned = true;
        console.error("[rig] joint motor failed:", e);
      }
    }
  }

  build(
    root: RAPIER.RigidBody,
    world: RAPIER.World,
    scene: THREE.Scene,
    look: RigLook,
    isPlayer = false
  ) {
    /* ---------- torso / head (follow the root body) ---------- */
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.235, 0.38, 6, 14), std(look.jacket));
    torso.position.y = 0.14;
    torso.scale.set(1.12, 1, 0.85);
    torso.castShadow = true;
    this.rootObj.add(torso);

    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), std(look.pants));
    pelvis.position.y = -0.36;
    pelvis.scale.set(1.22, 0.82, 0.98);
    pelvis.castShadow = true;
    this.rootObj.add(pelvis);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.15, 10), std(look.skin, 0.7));
    neck.position.y = 0.72;
    this.rootObj.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.235, 18, 14), std(look.skin, 0.7));
    head.position.y = 0.9;
    head.castShadow = true;
    this.rootObj.add(head);

    if (isPlayer) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.29, 0.14, 14), std("#f4c95d"));
      cap.position.y = 1.05;
      cap.castShadow = true;
      this.rootObj.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, 0.24), std("#f4c95d"));
      brim.position.set(0, 1.01, -0.3);
      this.rootObj.add(brim);
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.2), std("#2b5fa8"));
      pack.position.set(0, 0.12, 0.3);
      pack.castShadow = true;
      this.rootObj.add(pack);
    } else if (look.hat) {
      const beanie = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.255, 0.17, 12), std(look.hat, 0.92));
      beanie.position.y = 1.03;
      beanie.castShadow = true;
      this.rootObj.add(beanie);
    } else {
      const hair = new THREE.Mesh(
        new THREE.SphereGeometry(0.245, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
        std(look.hair, 0.95)
      );
      hair.position.y = 0.93;
      hair.rotation.x = -0.25;
      this.rootObj.add(hair);
    }
    scene.add(this.rootObj);

    /* ---------------- articulated limbs ---------------- */
    const mkLimb = (
      parent: RAPIER.RigidBody,
      anchor: { x: number; y: number; z: number },
      half: number,
      radius: number,
      mass: number,
      color: string,
      limits: [number, number],
      extra?: (g: THREE.Group) => void
    ): LimbPart => {
      const pt = parent.translation();
      const pr = parent.rotation();
      this.q.set(pr.x, pr.y, pr.z, pr.w);
      this.v.set(anchor.x, anchor.y - half, anchor.z).applyQuaternion(this.q);

      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pt.x + this.v.x, pt.y + this.v.y, pt.z + this.v.z)
          .setRotation({ x: pr.x, y: pr.y, z: pr.z, w: pr.w })
          .setLinearDamping(0.35)
          .setAngularDamping(1.8)
          .setCanSleep(false)
      );
      world.createCollider(
        RAPIER.ColliderDesc.capsule(half, radius)
          .setDensity(mass / capsuleVolume(radius, half))
          .setFriction(0.7)
          .setRestitution(0)
          .setCollisionGroups(LIMB_GROUPS),
        body
      );
      const joint = wrapJoint(
        world.createImpulseJoint(
          RAPIER.JointData.revoluteWithAxes(anchor, { x: 0, y: half, z: 0 }, X_AXIS, X_AXIS),
          parent,
          body,
          true
        )
      );
      joint.setLimits(limits[0], limits[1]);
      joint.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
      joint.setMotorMaxForce(150);

      const obj = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, half * 2, 5, 10), std(color));
      mesh.castShadow = true;
      obj.add(mesh);
      if (extra) extra(obj);
      scene.add(obj);

      const part = { body, joint, obj };
      this.limbs.push(part);
      return part;
    };

    const foot = (g: THREE.Group) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.28), std(look.shoe, 0.8));
      f.position.set(0, -0.21, -0.055);
      f.castShadow = true;
      g.add(f);
    };
    const hand = (g: THREE.Group) => {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), std(look.skin, 0.7));
      h.position.y = -0.2;
      g.add(h);
    };

    /* legs: hip → thigh → knee → shin(+foot collider).
     * The root capsule's bottom is 0.81 below its center and hips sit at
     * −0.02, so thigh 0.40 + shin 0.42 ≈ 0.82 plants the feet on the ground
     * with a naturally slightly-bent knee. */
    const thighL = mkLimb(root, { x: 0.16, y: -0.02, z: 0 }, 0.2, 0.13, 1.4, look.pants, [-0.85, 1.15]);
    const thighR = mkLimb(root, { x: -0.16, y: -0.02, z: 0 }, 0.2, 0.13, 1.4, look.pants, [-0.85, 1.15]);
    const shinL = mkLimb(thighL.body, { x: 0, y: -0.2, z: 0 }, 0.16, 0.1, 1.0, look.pants, [-2.35, -0.045], foot);
    const shinR = mkLimb(thighR.body, { x: 0, y: -0.2, z: 0 }, 0.16, 0.1, 1.0, look.pants, [-2.35, -0.045], foot);

    // feet get their own little collider so they physically plant on the ground
    // (its bottom is flush with the shin capsule's rounded end)
    for (const shin of [shinL, shinR]) {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.065, 0.05, 0.14)
          .setTranslation(0, -0.21, -0.055)
          .setDensity(0.4 / boxVolume(0.065, 0.05, 0.14))
          .setFriction(0.95)
          .setRestitution(0)
          .setCollisionGroups(LIMB_GROUPS),
        shin.body
      );
    }

    /* arms: shoulder → upper → elbow → forearm(+hand) */
    const upL = mkLimb(root, { x: 0.34, y: 0.46, z: 0 }, 0.185, 0.085, 0.8, look.jacket, [-0.95, 1.0]);
    const upR = mkLimb(root, { x: -0.34, y: 0.46, z: 0 }, 0.185, 0.085, 0.8, look.jacket, [-0.95, 1.0]);
    mkLimb(upL.body, { x: 0, y: -0.185, z: 0 }, 0.162, 0.072, 0.55, look.skin, [0.04, 2.3], hand);
    mkLimb(upR.body, { x: 0, y: -0.185, z: 0 }, 0.162, 0.072, 0.55, look.skin, [0.04, 2.3], hand);

    this.jHipL = thighL.joint;
    this.jHipR = thighR.joint;
    this.jKneeL = shinL.joint;
    this.jKneeR = shinR.joint;
    this.jShL = upL.joint;
    this.jShR = upR.joint;
    this.jElL = this.limbs[6].joint;
    this.jElR = this.limbs[7].joint;

    this.syncFrom(root);
  }

  /** Drive the gait motors. `speed` is the horizontal speed in m/s. */
  update(dt: number, speed: number) {
    const sN = Math.min(1.3, speed / 5.2);
    const targetAmp = speed > 0.35 ? Math.min(1, sN) : 0;
    this.amp += (targetAmp - this.amp) * Math.min(1, 7 * dt);
    this.phase += dt * (4.8 + 4.4 * sN) * (0.12 + 0.88 * Math.min(1, this.amp));

    const ph = this.phase;
    const A = 0.82 * this.amp;
    const Aa = 0.6 * this.amp;
    const kneeFlex = 1.25 * this.amp;

    const hipL = A * Math.sin(ph);
    const hipR = A * Math.sin(ph + Math.PI);
    const kneeL = -(0.06 + kneeFlex * Math.pow(Math.max(0, Math.cos(ph)), 1.3));
    const kneeR = -(0.06 + kneeFlex * Math.pow(Math.max(0, Math.cos(ph + Math.PI)), 1.3));
    const shL = -Aa * Math.sin(ph);
    const shR = -Aa * Math.sin(ph + Math.PI);
    const elL = 0.28 + 0.55 * this.amp * Math.max(0, Math.sin(ph));
    const elR = 0.28 + 0.55 * this.amp * Math.max(0, Math.sin(ph + Math.PI));

    const K = 150;
    const D = 19;
    this.motor(this.jHipL, hipL, K, D);
    this.motor(this.jHipR, hipR, K, D);
    this.motor(this.jKneeL, kneeL, K, D);
    this.motor(this.jKneeR, kneeR, K, D);
    this.motor(this.jShL, shL, K, D);
    this.motor(this.jShR, shR, K, D);
    this.motor(this.jElL, elL, K, D);
    this.motor(this.jElR, elR, K, D);
  }

  /** Copy physics transforms from the bodies onto the meshes. */
  syncFrom(root: RAPIER.RigidBody) {
    const t = root.translation();
    const r = root.rotation();
    this.rootObj.position.set(t.x, t.y, t.z);
    this.rootObj.quaternion.set(r.x, r.y, r.z, r.w);
    for (const l of this.limbs) {
      const lt = l.body.translation();
      const lr = l.body.rotation();
      l.obj.position.set(lt.x, lt.y, lt.z);
      l.obj.quaternion.set(lr.x, lr.y, lr.z, lr.w);
    }
  }
}
