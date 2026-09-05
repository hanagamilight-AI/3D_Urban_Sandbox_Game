import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

/* ------------------------------------------------------------------
 * Rig — a jointed upper-body humanoid (arms only).
 *
 * The torso/head ride on the character's existing root body (kinematic
 * for the player, dynamic for peds). Arms are REAL dynamic rigid bodies
 * (capsules + hand spheres) attached with revolute impulse joints at the
 * shoulders and elbows. A procedural gait drives joint position-motors so
 * every swing carries momentum, gravity and genuine collisions.
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
export const RAY_IGNORE_LIMBS = ((0xffff & ~GROUP_LIMB) << 16) | (0xffff & ~GROUP_LIMB);

export interface RigLook {
  jacket: string;
  pants: string;
  skin: string;
  hair: string;
  hat: string | null;
  shoe: string;
  police?: boolean;
}

/* ------------------------------------------------------------------
 * Joint motor adapter.
 *
 * Rapier exposes two flavours of revolute joint wrapper depending on the
 * factory used and the package version:
 *   - UnitImpulseJoint  → flat API:        configureMotorPosition(t, k, d)
 *   - GenericImpulseJoint → axis-first API: configureMotorPosition(axis, t, k, d)
 * `revoluteWithAxes` in some builds produces the generic wrapper, so we
 * detect the real signature once and bind the correct call shape. This way
 * the gait motors always work regardless of which wrapper we got.
 * ------------------------------------------------------------------ */
interface MotorJoint {
  setLimits(...a: unknown[]): void;
  configureMotorModel(...a: unknown[]): void;
  configureMotorPosition(...a: unknown[]): void;
  setMotorMaxForce(...a: unknown[]): void;
}

const AXIS = RAPIER.JointAxis ? RAPIER.JointAxis.AngX : 3;

function wrapJoint(raw: unknown): MotorJoint {
  const j = raw as Record<string, (...a: unknown[]) => void>;
  const wantsAxis = (name: string, arity: number) =>
    typeof j[name] === "function" && j[name].length >= arity;

  return {
    setLimits: (min: number, max: number) => {
      // generic flavour takes (axis, min, max); unit flavour takes (min, max)
      if (wantsAxis("setLimits", 3)) j.setLimits(AXIS, min, max);
      else j.setLimits(min, max);
    },
    configureMotorModel: (m: unknown) => {
      if (wantsAxis("configureMotorModel", 2)) j.configureMotorModel(AXIS, m);
      else j.configureMotorModel(m);
    },
    configureMotorPosition: (t: number, k: number, d: number) => {
      if (wantsAxis("configureMotorPosition", 4)) j.configureMotorPosition(AXIS, t, k, d);
      else j.configureMotorPosition(t, k, d);
    },
    setMotorMaxForce: (f: number) => {
      if (wantsAxis("setMotorMaxForce", 2)) j.setMotorMaxForce(AXIS, f);
      else j.setMotorMaxForce(f);
    },
  };
}

const X_AXIS = { x: 1, y: 0, z: 0 };
const capsuleVolume = (r: number, h: number) => Math.PI * r * r * (2 * h + (4 * r) / 3);

const std = (color: string, rough = 0.85) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough });

interface LimbPart {
  body: RAPIER.RigidBody;
  joint: MotorJoint;
  obj: THREE.Group;
}

export class Rig {
  rootObj = new THREE.Group();
  /** attach props (guns, badges) here — follows the body */
  gunAnchor = new THREE.Group();
  /** all rigid bodies owned by this rig (root is added by the caller) */
  limbBodies: RAPIER.RigidBody[] = [];
  private limbs: LimbPart[] = [];
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
    const police = !!look.police;

    /* ---------- torso / head (follow the root body) ---------- */
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.24, 0.4, 6, 14),
      std(police ? "#274b8f" : look.jacket)
    );
    torso.position.y = 0.12;
    torso.scale.set(1.12, 1, 0.85);
    torso.castShadow = true;
    this.rootObj.add(torso);

    const pelvis = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 14, 12),
      std(police ? "#1d2430" : look.pants)
    );
    pelvis.position.y = -0.34;
    pelvis.scale.set(1.2, 0.85, 0.98);
    pelvis.castShadow = true;
    this.rootObj.add(pelvis);

    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.095, 0.15, 10),
      std(look.skin, 0.7)
    );
    neck.position.y = 0.7;
    this.rootObj.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.235, 18, 14), std(look.skin, 0.7));
    head.position.y = 0.88;
    head.castShadow = true;
    this.rootObj.add(head);

    if (police) {
      // blue peaked cap + badge
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.27, 0.12, 14), std("#1d2430"));
      cap.position.y = 1.02;
      cap.castShadow = true;
      this.rootObj.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.22), std("#1d2430"));
      brim.position.set(0, 0.99, -0.28);
      this.rootObj.add(brim);
      const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 8), std("#f4c95d", 0.4));
      badge.rotation.x = Math.PI / 2;
      badge.position.set(0, 1.04, -0.24);
      this.rootObj.add(badge);
      // shoulder radio
      const radio = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.04), std("#111111"));
      radio.position.set(0.22, 0.42, -0.1);
      this.rootObj.add(radio);
    } else if (isPlayer) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.29, 0.14, 14), std("#f4c95d"));
      cap.position.y = 1.03;
      cap.castShadow = true;
      this.rootObj.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, 0.24), std("#f4c95d"));
      brim.position.set(0, 0.99, -0.3);
      this.rootObj.add(brim);
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.2), std("#2b5fa8"));
      pack.position.set(0, 0.12, 0.3);
      pack.castShadow = true;
      this.rootObj.add(pack);
    } else if (look.hat) {
      const beanie = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.255, 0.17, 12), std(look.hat, 0.92));
      beanie.position.y = 1.01;
      beanie.castShadow = true;
      this.rootObj.add(beanie);
    } else {
      const hair = new THREE.Mesh(
        new THREE.SphereGeometry(0.245, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
        std(look.hair, 0.95)
      );
      hair.position.y = 0.91;
      hair.rotation.x = -0.25;
      this.rootObj.add(hair);
    }

    // gun mount — follows the body, points forward (−Z)
    this.gunAnchor.position.set(0.3, 0.28, -0.28);
    this.rootObj.add(this.gunAnchor);

    scene.add(this.rootObj);

    /* ---------------- articulated arms ---------------- */
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
      this.limbBodies.push(body);
      return part;
    };

    const hand = (g: THREE.Group) => {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), std(look.skin, 0.7));
      h.position.y = -0.2;
      g.add(h);
    };

    /* arms: shoulder → upper → elbow → forearm(+hand) */
    const armColor = police ? "#274b8f" : look.jacket;
    const upL = mkLimb(root, { x: 0.34, y: 0.44, z: 0 }, 0.185, 0.085, 0.8, armColor, [-0.95, 1.0]);
    const upR = mkLimb(root, { x: -0.34, y: 0.44, z: 0 }, 0.185, 0.085, 0.8, armColor, [-0.95, 1.0]);
    mkLimb(upL.body, { x: 0, y: -0.185, z: 0 }, 0.162, 0.072, 0.55, look.skin, [0.04, 2.3], hand);
    mkLimb(upR.body, { x: 0, y: -0.185, z: 0 }, 0.162, 0.072, 0.55, look.skin, [0.04, 2.3], hand);

    this.jShL = upL.joint;
    this.jShR = upR.joint;
    this.jElL = this.limbs[2].joint;
    this.jElR = this.limbs[3].joint;

    this.syncFrom(root);
  }

  /** Drive the gait motors. `speed` is the horizontal speed in m/s. */
  update(dt: number, speed: number) {
    const sN = Math.min(1.3, speed / 5.2);
    const targetAmp = speed > 0.35 ? Math.min(1, sN) : 0;
    this.amp += (targetAmp - this.amp) * Math.min(1, 7 * dt);
    this.phase += dt * (4.8 + 4.4 * sN) * (0.12 + 0.88 * Math.min(1, this.amp));

    const ph = this.phase;
    const Aa = 0.62 * this.amp;

    const shL = -Aa * Math.sin(ph);
    const shR = -Aa * Math.sin(ph + Math.PI);
    const elL = 0.28 + 0.55 * this.amp * Math.max(0, Math.sin(ph));
    const elR = 0.28 + 0.55 * this.amp * Math.max(0, Math.sin(ph + Math.PI));

    const K = 150;
    const D = 19;
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

  /** Toggle visibility of the whole character (used when driving a car). */
  setVisible(v: boolean) {
    this.rootObj.visible = v;
    for (const l of this.limbs) l.obj.visible = v;
  }

  /** Remove every body/collider/mesh this rig owns. */
  destroy(world: RAPIER.World, scene: THREE.Scene) {
    for (const l of this.limbs) {
      world.removeRigidBody(l.body);
      scene.remove(l.obj);
    }
    this.limbs = [];
    this.limbBodies = [];
    scene.remove(this.rootObj);
  }
}
