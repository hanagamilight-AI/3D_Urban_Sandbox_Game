import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export interface PlayerInput {
  moveX: number; // strafe  -1..1 (D positive)
  moveZ: number; // forward -1..1 (W positive)
  sprint: boolean;
}

/** Kinematic character controller + third-person camera anchored behind the player. */
export class Player {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  group = new THREE.Group();

  yaw = Math.PI; // facing the shops (−z) at spawn
  pitch = 0.34;
  private vy = 0;
  private hVel = new THREE.Vector3();
  private grounded = false;
  private coyote = 0;
  private jumpBuffer = 0;
  private bobPhase = 0;
  private camDist = 5.6;
  private camPos = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  wasAirborne = false;

  onLand: (() => void) | null = null;
  onJump: (() => void) | null = null;
  onStep: (() => void) | null = null;
  private stepTimer = 0;

  constructor(
    private scene: THREE.Scene,
    private world: RAPIER.World,
    private camera: THREE.PerspectiveCamera,
    spawn: THREE.Vector3
  ) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z)
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.38).setFriction(0).setRestitution(0),
      this.body
    );
    this.controller = world.createCharacterController(0.02);
    this.controller.setSlideEnabled(true);
    this.controller.enableAutostep(0.34, 0.2, true);
    this.controller.enableSnapToGround(0.38);
    this.controller.setMaxSlopeClimbAngle(0.65);
    this.controller.setMinSlopeSlideAngle(0.95);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(72);

    /* ------- little townie avatar ------- */
    const jacket = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.36, 0.58, 6, 14),
      new THREE.MeshStandardMaterial({ color: "#d8452e", roughness: 0.8 })
    );
    jacket.position.y = -0.08;
    jacket.castShadow = true;
    this.group.add(jacket);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 18, 14),
      new THREE.MeshStandardMaterial({ color: "#e8b48a", roughness: 0.75 })
    );
    head.position.y = 0.66;
    head.castShadow = true;
    this.group.add(head);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.29, 0.31, 0.14, 14),
      new THREE.MeshStandardMaterial({ color: "#f4c95d", roughness: 0.8 })
    );
    cap.position.y = 0.88;
    cap.castShadow = true;
    this.group.add(cap);
    const brim = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.05, 0.26),
      new THREE.MeshStandardMaterial({ color: "#f4c95d", roughness: 0.8 })
    );
    brim.position.set(0, 0.84, 0.32);
    this.group.add(brim);
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.5, 0.22),
      new THREE.MeshStandardMaterial({ color: "#2b5fa8", roughness: 0.85 })
    );
    pack.position.set(0, 0.02, -0.38);
    pack.castShadow = true;
    this.group.add(pack);
    scene.add(this.group);
    this.camPos
      .copy(spawn)
      .add(new THREE.Vector3(0, 1.35, 0))
      .add(this.desiredCamPos(5.6));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(spawn.x, spawn.y + 1.35, spawn.z);
  }

  get pos() {
    const t = this.body.translation();
    return this.tmp.set(t.x, t.y, t.z);
  }

  queueJump() {
    this.jumpBuffer = 0.14;
  }

  rotate(dx: number, dy: number) {
    this.yaw -= dx * 0.0026;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0022, -0.55, 1.02);
  }

  private desiredCamPos(dist: number) {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(
      Math.sin(this.yaw) * cp * dist,
      Math.sin(this.pitch) * dist + 1.35,
      Math.cos(this.yaw) * cp * dist
    );
  }

  update(dt: number, input: PlayerInput) {
    /* --- horizontal wish direction, camera relative --- */
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3()
      .addScaledVector(fwd, input.moveZ)
      .addScaledVector(right, input.moveX);
    if (wish.lengthSq() > 1) wish.normalize();

    const speed = input.sprint && input.moveZ > 0 ? 8.6 : 5.3;
    const accel = this.grounded ? 14 : 5;
    this.hVel.lerp(wish.multiplyScalar(speed), Math.min(1, accel * dt));

    /* --- vertical: gravity + buffered jump with coyote time --- */
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vy = 8.4;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.onJump?.();
    }
    this.vy = Math.max(-30, this.vy - 24 * dt);

    /* --- character controller step --- */
    this.controller.computeColliderMovement(this.collider, {
      x: this.hVel.x * dt,
      y: this.vy * dt,
      z: this.hVel.z * dt,
    });
    const moved = this.controller.computedMovement();
    const p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + moved.x, y: p.y + moved.y, z: p.z + moved.z });
    const nowGrounded = this.controller.computedGrounded();
    if (nowGrounded && this.vy <= 0) this.vy = 0;
    if (nowGrounded && this.wasAirborne && this.vy < -0.01) this.onLand?.();
    this.wasAirborne = !nowGrounded;
    this.grounded = nowGrounded;

    /* --- avatar presentation --- */
    const np = this.body.translation();
    const planarSpeed = Math.hypot(moved.x, moved.z) / Math.max(dt, 1e-4);
    if (planarSpeed > 0.6 && this.grounded) {
      const targetYaw = Math.atan2(this.hVel.x, this.hVel.z);
      let d = targetYaw - this.group.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.group.rotation.y += d * Math.min(1, 12 * dt);
      this.bobPhase += dt * (6 + planarSpeed * 1.4);
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = input.sprint ? 0.26 : 0.36;
        this.onStep?.();
      }
    }
    this.group.position.set(np.x, np.y + Math.sin(this.bobPhase) * 0.035 - 0.02, np.z);
  }

  updateCamera(dt: number) {
    const p = this.body.translation();
    const target = this.tmp.set(p.x, p.y + 1.35, p.z);

    // keep the camera out of walls
    let dist = 5.6;
    const want = this.desiredCamPos(dist);
    const dirN = want.clone().normalize();
    const ray = new RAPIER.Ray(
      { x: target.x, y: target.y, z: target.z },
      { x: dirN.x, y: dirN.y, z: dirN.z }
    );
    const hit = this.world.castRay(ray, dist, true, undefined, undefined, undefined, this.body);
    if (hit && hit.timeOfImpact < dist) dist = Math.max(1.5, hit.timeOfImpact - 0.35);
    this.camDist += (dist - this.camDist) * Math.min(1, 14 * dt);

    const final = this.desiredCamPos(this.camDist);
    this.camPos.lerp(new THREE.Vector3(target.x + final.x, target.y + final.y, target.z + final.z), Math.min(1, 16 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(target);

    // sprint fov kick
    const sprinting = this.hVel.length() > 6.5;
    const targetFov = sprinting ? 68 : 62;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 8 * dt);
      this.camera.updateProjectionMatrix();
    }
  }
}
