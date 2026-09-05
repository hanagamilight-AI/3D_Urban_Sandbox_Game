import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GROUP_WORLD } from "./rig";

export interface CarSpawn {
  x: number;
  z: number;
  rotY: number;
  color: string;
}

export interface DriveInput {
  throttle: number; // -1..1 (S..W)
  steer: number; // -1..1 (A..D)
}

const CAR_GROUPS = (1 << 16) | 0xffff & ~2; // collide with world & limbs, not root capsules directly

export class Car {
  body: RAPIER.RigidBody;
  group = new THREE.Group();
  wheels: THREE.Mesh[] = [];
  frontWheels: THREE.Group[] = [];
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpF = new THREE.Vector3();
  speed = 0;

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    spawn: CarSpawn
  ) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, 1.0, spawn.z)
        .setRotation({ x: 0, y: 0, z: 0, w: 1 })
        .enabledRotations(false, true, false)
        .setLinearDamping(0.6)
        .setAngularDamping(2.5)
        .setCanSleep(false)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.95, 0.45, 2.1)
        .setTranslation(0, 0, 0)
        .setFriction(0.5)
        .setRestitution(0.1)
        .setDensity(6)
        .setCollisionGroups(CAR_GROUPS),
      this.body
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.8, 0.35, 1.05)
        .setTranslation(0, 0.72, -0.25)
        .setFriction(0.5)
        .setDensity(2)
        .setCollisionGroups(CAR_GROUPS),
      this.body
    );

    this.buildMesh(spawn.color);
    scene.add(this.group);
  }

  private buildMesh(color: string) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: "#1b1d22", roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({
      color: "#9fd8e8",
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
      opacity: 0.75,
    });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.2), mat);
    chassis.position.y = 0;
    chassis.castShadow = true;
    this.group.add(chassis);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 2.1), mat);
    cabin.position.set(0, 0.55, -0.25);
    cabin.castShadow = true;
    this.group.add(cabin);

    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.5, 0.08), glass);
    windshield.position.set(0, 0.55, -1.32);
    windshield.rotation.x = 0.28;
    this.group.add(windshield);
    const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.5, 0.08), glass);
    rearGlass.position.set(0, 0.55, 0.82);
    rearGlass.rotation.x = -0.28;
    this.group.add(rearGlass);

    // headlights + taillights
    const head = new THREE.MeshStandardMaterial({ color: "#fff7d6", emissive: "#ffe9a3", emissiveIntensity: 1.4 });
    const tail = new THREE.MeshStandardMaterial({ color: "#ff4b3e", emissive: "#ff2b1e", emissiveIntensity: 1.2 });
    for (const sx of [-0.62, 0.62]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), head);
      h.position.set(sx, 0.05, -2.12);
      this.group.add(h);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), tail);
      t.position.set(sx, 0.05, 2.12);
      this.group.add(t);
    }

    // bumper
    const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.2, 0.18), dark);
    bumperF.position.set(0, -0.18, -2.1);
    this.group.add(bumperF);
    const bumperR = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.2, 0.18), dark);
    bumperR.position.set(0, -0.18, 2.1);
    this.group.add(bumperR);

    // wheels (front two steer)
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: "#14151a", roughness: 0.9 });
    const hubMat = new THREE.MeshStandardMaterial({ color: "#c9ccd4", roughness: 0.4, metalness: 0.6 });
    const positions: [number, number, number][] = [
      [-0.95, -0.3, -1.4],
      [0.95, -0.3, -1.4],
      [-0.95, -0.3, 1.4],
      [0.95, -0.3, 1.4],
    ];
    positions.forEach(([x, y, z], i) => {
      const steerGroup = new THREE.Group();
      steerGroup.position.set(x, y, z);
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.32, 8), hubMat);
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);
      steerGroup.add(wheel);
      this.group.add(steerGroup);
      this.wheels.push(wheel);
      if (i < 2) this.frontWheels.push(steerGroup);
    });
  }

  get pos() {
    return this.body.translation();
  }
  get rotY() {
    return this.body.rotation();
  }

  /** Arcade driving — grips laterally, thrusts along facing. */
  drive(dt: number, input: DriveInput) {
    const r = this.body.rotation();
    this.tmpQ.set(r.x, r.y, r.z, r.w);
    // car forward is local −Z
    this.tmpF.set(0, 0, -1).applyQuaternion(this.tmpQ);
    const right = this.tmpV.set(1, 0, 0).applyQuaternion(this.tmpQ);

    const vel = this.body.linvel();
    this.tmpV.set(vel.x, 0, vel.z);
    const fwdSpeed = this.tmpV.dot(this.tmpF);
    const sideSpeed = this.tmpV.dot(right);

    // engine / brake
    let newFwd = fwdSpeed;
    const maxSpeed = 24;
    if (input.throttle > 0) newFwd += input.throttle * 18 * dt;
    else if (input.throttle < 0) {
      if (fwdSpeed > 0.5) newFwd += input.throttle * 26 * dt; // brake
      else newFwd += input.throttle * 8 * dt; // reverse
    } else {
      newFwd *= 1 - Math.min(1, 1.6 * dt); // coast
    }
    newFwd = THREE.MathUtils.clamp(newFwd, -8, maxSpeed);

    // lateral grip (drifts a little)
    const newSide = sideSpeed * (1 - Math.min(1, 6.5 * dt));

    const outVel = new THREE.Vector3()
      .addScaledVector(this.tmpF, newFwd)
      .addScaledVector(right, newSide);
    this.body.setLinvel({ x: outVel.x, y: vel.y, z: outVel.z }, true);

    // steering scales with speed, flips when reversing
    const steerAmt = input.steer * THREE.MathUtils.clamp(Math.abs(newFwd) / 6, 0, 1) * 1.9;
    this.body.setAngvel({ x: 0, y: -steerAmt * Math.sign(newFwd || 1), z: 0 }, true);

    this.speed = Math.abs(newFwd);
    this.updateWheels(dt, newFwd, input.steer);
  }

  /** Slow to a stop when nobody's driving. */
  idle(dt: number) {
    const vel = this.body.linvel();
    const f = 1 - Math.min(1, 3 * dt);
    this.body.setLinvel({ x: vel.x * f, y: vel.y, z: vel.z * f }, true);
    this.body.setAngvel({ x: 0, y: this.body.angvel().y * f, z: 0 }, true);
    this.speed = Math.hypot(vel.x, vel.z);
    this.updateWheels(dt, this.speed, 0);
  }

  private updateWheels(dt: number, fwdSpeed: number, steer: number) {
    const spin = (fwdSpeed * dt) / 0.4;
    for (const w of this.wheels) w.rotation.x += spin;
    for (const fw of this.frontWheels) fw.rotation.y = -steer * 0.42;
  }

  sync() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.group.position.set(t.x, t.y, t.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);
  }

  destroy(world: RAPIER.World, scene: THREE.Scene) {
    world.removeRigidBody(this.body);
    scene.remove(this.group);
  }
}

export class CarManager {
  cars: Car[] = [];

  spawn(world: RAPIER.World, scene: THREE.Scene, spawns: CarSpawn[]) {
    for (const s of spawns) this.cars.push(new Car(world, scene, s));
  }

  nearestCar(point: THREE.Vector3, maxDist: number): Car | null {
    let best: Car | null = null;
    let bestD = maxDist;
    for (const c of this.cars) {
      const t = c.pos;
      const d = Math.hypot(t.x - point.x, t.z - point.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  update(dt: number, driven: Car | null, input: DriveInput) {
    for (const c of this.cars) {
      if (c === driven) c.drive(dt, input);
      else c.idle(dt);
      c.sync();
    }
  }
}

export { GROUP_WORLD };
