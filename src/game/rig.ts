import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

/* ------------------------------------------------------------------
 * Rig — a smooth capsule-bodied character (no limbs).
 *
 * The whole body rides on the character's existing root body (kinematic
 * for the player, dynamic for peds): torso, pelvis, neck and head, plus
 * per-character hats / hair / uniforms and the player's cap & backpack.
 * A gunAnchor group is parented to the body so the sidearm rides along
 * and can be given recoil feedback.
 *
 * Conventions: characters face local −Z.
 *
 * Collision groups (membership << 16 | filter):
 *   bit 1 — world/static geometry
 *   bit 2 — character root capsules
 *   bit 4 — rig limbs (kept for compatibility; nothing uses it anymore)
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

const std = (color: string, rough = 0.85) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough });

export class Rig {
  rootObj = new THREE.Group();
  /** gun mount, parented to the body — faces local −Z */
  gunAnchor = new THREE.Group();

  build(
    root: RAPIER.RigidBody,
    _world: RAPIER.World,
    scene: THREE.Scene,
    look: RigLook,
    isPlayer = false
  ) {
    void root;

    /* ---------- body ---------- */
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

    /* ---------- headwear / uniform details ---------- */
    if (look.police) {
      const beret = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.15, 12), std("#22304e", 0.92));
      beret.position.y = 1.04;
      beret.castShadow = true;
      this.rootObj.add(beret);
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.03), std("#d8a531", 0.4));
      badge.position.set(0.13, 0.42, -0.2);
      this.rootObj.add(badge);
    } else if (isPlayer) {
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

    /* ---------- gun mount (right side of the chest, facing −Z) ---------- */
    this.gunAnchor.position.set(0.42, 0.42, -0.18);
    this.rootObj.add(this.gunAnchor);

    scene.add(this.rootObj);
  }

  /** Kept for API compatibility — limbless bodies have nothing to drive. */
  update(_dt: number, _speed: number) {
    /* no-op */
  }

  /** Copy the root body transform onto the visible body. */
  syncFrom(root: RAPIER.RigidBody) {
    const t = root.translation();
    const r = root.rotation();
    this.rootObj.position.set(t.x, t.y, t.z);
    this.rootObj.quaternion.set(r.x, r.y, r.z, r.w);
  }

  setVisible(v: boolean) {
    this.rootObj.visible = v;
  }

  /** Detach the body from the scene (used when a ped dies). */
  destroy(_world: RAPIER.World, scene: THREE.Scene) {
    scene.remove(this.rootObj);
  }
}
