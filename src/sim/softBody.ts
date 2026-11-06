import { PARAMS } from "../params";
import { buildSharkMesh, type Binding, type SharkMesh } from "./geometry";
import { clamp, polarRotation, type Pt } from "./math2";

export type Particle = {
  x: number;
  y: number;
  px: number;
  py: number;
  restX: number;
  restY: number;
  mass: number;
  invMass: number;
  thickness: number;
  strain: number;
};

type Cluster = {
  name: string;
  indices: number[];
  localX: Float64Array;
  localY: Float64Array;
  k: number;
  weight: number;
  r00: number;
  r01: number;
  r10: number;
  r11: number;
};

type Grab = {
  index: number;
  restX: number;
  restY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r00: number;
  r01: number;
  r10: number;
  r11: number;
  carryX: number;
  carryY: number;
};

export class SoftBody {
  readonly particles: Particle[];
  readonly boundary: number[];
  readonly features: SharkMesh["features"];
  readonly restArea: number;
  minX = -3;
  maxX = 3;
  minY = -2;
  maxY = 2;
  time = 0;
  meanSpeed = 0;
  homeX = 0;
  homeY = 0;
  mode: "pull" | "drop" = "pull";

  private readonly constraints: SharkMesh["constraints"];
  private readonly clusters: Cluster[];
  private readonly goalX: Float64Array;
  private readonly goalY: Float64Array;
  private readonly goalW: Float64Array;
  private readonly goalK: Float64Array;
  private grab: Grab | null = null;
  private lastH = 1 / 60;
  private idleTime = 0;
  private impactFatigue = 0;
  private clearOfFloor = true;
  private readonly intro: boolean;
  private readonly restBottom: number;
  private readonly restComX: number;
  private readonly restComY: number;

  constructor(mesh: SharkMesh, intro: boolean) {
    this.intro = intro;
    this.boundary = mesh.boundary;
    this.features = mesh.features;
    this.constraints = mesh.constraints;
    this.particles = mesh.rest.map((p, i) => ({
      x: p.x,
      y: p.y,
      px: p.x,
      py: p.y,
      restX: p.x,
      restY: p.y,
      mass: mesh.mass[i],
      invMass: 1 / mesh.mass[i],
      thickness: mesh.thickness[i],
      strain: 1,
    }));
    let restMass = 0;
    let restCx = 0;
    let restCy = 0;
    let restBottom = -Infinity;
    for (const p of this.particles) {
      restMass += p.mass;
      restCx += p.restX * p.mass;
      restCy += p.restY * p.mass;
      restBottom = Math.max(restBottom, p.restY);
    }
    this.restComX = restCx / restMass;
    this.restComY = restCy / restMass;
    this.restBottom = restBottom;
    this.clusters = mesh.clusters.map((cluster) => {
      let cx = 0;
      let cy = 0;
      let m = 0;
      for (const index of cluster.indices) {
        const p = this.particles[index];
        cx += p.restX * p.mass;
        cy += p.restY * p.mass;
        m += p.mass;
      }
      cx /= m;
      cy /= m;
      const localX = new Float64Array(cluster.indices.length);
      const localY = new Float64Array(cluster.indices.length);
      cluster.indices.forEach((index, n) => {
        localX[n] = this.particles[index].restX - cx;
        localY[n] = this.particles[index].restY - cy;
      });
      return {
        name: cluster.name,
        indices: cluster.indices,
        localX,
        localY,
        k: cluster.k,
        weight: cluster.weight,
        r00: 1,
        r01: 0,
        r10: 0,
        r11: 1,
      };
    });
    const n = this.particles.length;
    this.goalX = new Float64Array(n);
    this.goalY = new Float64Array(n);
    this.goalW = new Float64Array(n);
    this.goalK = new Float64Array(n);
    this.restArea = Math.abs(this.area());
    this.homeY = this.maxY - this.restBottom - 0.02;
    if (intro) this.poseIntro();
  }

  reset(): void {
    for (const p of this.particles) {
      p.x = p.restX;
      p.y = p.restY;
      p.px = p.x;
      p.py = p.y;
      p.strain = 1;
    }
    this.grab = null;
    this.time = 0;
    this.idleTime = 0;
    this.meanSpeed = 0;
    this.impactFatigue = 0;
    this.clearOfFloor = true;
    if (this.intro) this.poseIntro();
  }

  setMode(mode: "pull" | "drop"): void {
    if (this.grab) this.endGrab();
    this.mode = mode;
  }

  private poseIntro(): void {
    for (const p of this.particles) {
      p.y -= 0.85;
      p.px = p.x;
      p.py = p.y;
    }
  }

  center(): Pt {
    let x = 0;
    let y = 0;
    let m = 0;
    for (const p of this.particles) {
      x += p.x * p.mass;
      y += p.y * p.mass;
      m += p.mass;
    }
    return { x: x / m, y: y / m };
  }

  hitTest(x: number, y: number): boolean {
    const poly = this.boundary.map((i) => this.particles[i]);
    if (pointInside(x, y, poly)) return true;
    for (const i of this.boundary) {
      const p = this.particles[i];
      if ((p.x - x) ** 2 + (p.y - y) ** 2 < 0.012) return true;
    }
    return false;
  }

  beginGrab(x: number, y: number): boolean {
    if (!this.hitTest(x, y)) return false;
    let best = 0;
    let bestD = Infinity;
    let bestBoundary = -1;
    let bestBoundaryD = Infinity;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
      if (i < this.boundary.length && d < bestBoundaryD) {
        bestBoundaryD = d;
        bestBoundary = i;
      }
    }
    const index = bestBoundaryD < 0.014 ? bestBoundary : best;
    const p = this.particles[index];
    const cluster = this.dominantCluster(index);
    const com = this.center();
    this.grab = {
      index,
      restX: p.restX,
      restY: p.restY,
      x,
      y,
      vx: 0,
      vy: 0,
      r00: cluster?.r00 ?? 1,
      r01: cluster?.r01 ?? 0,
      r10: cluster?.r10 ?? 0,
      r11: cluster?.r11 ?? 1,
      carryX: com.x - this.restComX,
      carryY: com.y - this.restComY,
    };
    this.idleTime = 0;
    return true;
  }

  moveGrab(x: number, y: number, vx: number, vy: number): void {
    if (!this.grab) return;
    const sp = Math.hypot(vx, vy);
    const scale = sp > PARAMS.maxSpeed ? PARAMS.maxSpeed / sp : 1;
    this.grab.x = x;
    this.grab.y = y;
    this.grab.vx = vx * scale;
    this.grab.vy = vy * scale;
  }

  endGrab(): void {
    if (!this.grab) return;
    const { vx, vy } = this.grab;
    const sp = Math.hypot(vx, vy);
    const h = this.lastH;
    if (this.mode === "pull") {
      for (const p of this.particles) {
        const w = this.grabWeight(p, PARAMS.pullSigma);
        if (w < 0.04) continue;
        const cvx = ((p.x - p.px) / h) * (1 - w);
        const cvy = ((p.y - p.py) / h) * (1 - w);
        p.px = p.x - cvx * h;
        p.py = p.y - cvy * h;
      }
      this.grab = null;
      return;
    }
    if (sp > PARAMS.flickSpeed) {
      const extra = Math.min(PARAMS.flickBoost, ((sp - PARAMS.flickSpeed) / PARAMS.flickSpeed) * PARAMS.flickBoost);
      for (const p of this.particles) {
        const w = this.grabWeight(p);
        if (w < 0.04) continue;
        const cvx = ((p.x - p.px) / h) * (1 + extra * w);
        const cvy = ((p.y - p.py) / h) * (1 + extra * w);
        p.px = p.x - cvx * h;
        p.py = p.y - cvy * h;
      }
    }
    this.grab = null;
  }

  get grabbing(): boolean {
    return this.grab !== null;
  }

  grabPoint(): Pt | null {
    if (!this.grab) return null;
    return { x: this.grab.x, y: this.grab.y };
  }

  step(dt: number): void {
    if (dt <= 0) return;
    const frame = Math.min(dt, 1 / 30);
    const h = frame / PARAMS.substeps;
    this.lastH = h;
    for (let s = 0; s < PARAMS.substeps; s++) this.substep(h);
    this.time += frame;
    if (this.broken()) this.reset();
  }

  private substep(h: number): void {
    this.homeY = this.maxY - this.restBottom - 0.02;
    this.computeGoals();
    const breath = this.breathAmount();
    const com = this.center();
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const w = this.goalW[i] || 1;
      let gx = this.goalX[i] / w;
      let gy = this.goalY[i] / w;
      if (breath !== 0) {
        gx = com.x + (gx - com.x) * (1 - breath * 0.42);
        gy = com.y + (gy - com.y) * (1 + breath);
      }
      const held = this.grab && this.mode === "pull" ? 0.2 : 1;
      const k = (this.goalK[i] / w) * held;
      const spin = this.uprightAlpha();
      const ax =
        (gx - p.x) * k + (this.homeX - com.x) * PARAMS.comKX - (p.y - com.y) * spin;
      const ay =
        (gy - p.y) * k +
        (this.homeY - com.y) * PARAMS.comKY +
        PARAMS.gravity +
        (p.x - com.x) * spin;
      let vx = (p.x - p.px) / h;
      let vy = (p.y - p.py) / h;
      const speed = Math.hypot(vx, vy);
      const decay = Math.exp(-(PARAMS.linearDamp + PARAMS.quadDamp * speed) * h);
      vx *= decay;
      vy *= decay;
      const nx = p.x + vx * h + ax * h * h;
      const ny = p.y + vy * h + ay * h * h;
      p.px = p.x;
      p.py = p.y;
      p.x = nx;
      p.y = ny;
    }

    this.applyGrab(h, false);
    const pinned = this.grab?.index ?? -1;
    const savedInv = pinned >= 0 ? this.particles[pinned].invMass : 0;
    if (pinned >= 0) this.particles[pinned].invMass = 0;
    for (let n = 0; n < PARAMS.constraintIterations; n++) this.solveConstraints();
    this.solvePressure();
    if (pinned >= 0) this.particles[pinned].invMass = savedInv;
    this.projectShape(h);
    this.preventOutlineFold();
    this.applyGrab(h, true);
    this.anchorHeld();
    this.solveWalls(h);
    this.settle(h);
    this.limitSpeed(h);
    this.updateStrain();
  }

  private computeGoals(): void {
    this.goalX.fill(0);
    this.goalY.fill(0);
    this.goalW.fill(0);
    this.goalK.fill(0);
    for (const cluster of this.clusters) {
      let cx = 0;
      let cy = 0;
      let m = 0;
      for (const index of cluster.indices) {
        const p = this.particles[index];
        cx += p.x * p.mass;
        cy += p.y * p.mass;
        m += p.mass;
      }
      cx /= m;
      cy /= m;
      if (cluster.name === "global") {
        const seated = this.poseCenter(cx, cy);
        cx = seated.x;
        cy = seated.y;
      }
      let h00 = 0;
      let h01 = 0;
      let h10 = 0;
      let h11 = 0;
      for (let n = 0; n < cluster.indices.length; n++) {
        const p = this.particles[cluster.indices[n]];
        const px = p.x - cx;
        const py = p.y - cy;
        const lx = cluster.localX[n];
        const ly = cluster.localY[n];
        h00 += p.mass * px * lx;
        h01 += p.mass * px * ly;
        h10 += p.mass * py * lx;
        h11 += p.mass * py * ly;
      }
      const [r00, r01, r10, r11] = polarRotation(h00, h01, h10, h11);
      cluster.r00 = r00;
      cluster.r01 = r01;
      cluster.r10 = r10;
      cluster.r11 = r11;
      for (let n = 0; n < cluster.indices.length; n++) {
        const index = cluster.indices[n];
        const gx = cx + r00 * cluster.localX[n] + r01 * cluster.localY[n];
        const gy = cy + r10 * cluster.localX[n] + r11 * cluster.localY[n];
        this.goalX[index] += gx * cluster.weight;
        this.goalY[index] += gy * cluster.weight;
        this.goalW[index] += cluster.weight;
        this.goalK[index] += cluster.k * cluster.weight;
      }
    }
    this.applySilhouette();
    this.plantGoals();
  }

  /**
   * A pull springs back to the seated pose. A drop keeps the pose on the
   * moving center so a throw can travel and a landing can stay where it fell.
   */
  private poseCenter(cx: number, cy: number): { x: number; y: number } {
    if (this.mode === "pull") return { x: this.homeX, y: this.homeY };
    return { x: cx, y: cy };
  }

  /**
   * Local clusters follow whatever stack they have collapsed into. Mix the
   * full-body rest pose back in so a landing can unsquash without hopping.
   */
  private applySilhouette(): void {
    const global = this.clusters.find((cluster) => cluster.name === "global");
    if (!global) return;
    let cx = 0;
    let cy = 0;
    let m = 0;
    for (const index of global.indices) {
      const p = this.particles[index];
      cx += p.x * p.mass;
      cy += p.y * p.mass;
      m += p.mass;
    }
    cx /= m;
    cy /= m;
    const seated = this.poseCenter(cx, cy);
    cx = seated.x;
    cy = seated.y;
    const share = PARAMS.silhouette;
    for (let n = 0; n < global.indices.length; n++) {
      const index = global.indices[n];
      const w = this.goalW[index];
      if (w < 1e-6) continue;
      const gx = cx + global.r00 * global.localX[n] + global.r01 * global.localY[n];
      const gy = cy + global.r10 * global.localX[n] + global.r11 * global.localY[n];
      const bx = this.goalX[index] / w;
      const by = this.goalY[index] / w;
      this.goalX[index] = (bx + (gx - bx) * share) * w;
      this.goalY[index] = (by + (gy - by) * share) * w;
    }
  }

  /**
   * Shape goals are built around the current center, which can sit inside the
   * floor after a landing. Lift the whole pose so the belly rests on the floor
   * instead of being pulled through it.
   */
  private plantGoals(): void {
    let lowest = -Infinity;
    for (let i = 0; i < this.particles.length; i++) {
      const w = this.goalW[i];
      if (w < 1e-6) continue;
      lowest = Math.max(lowest, this.goalY[i] / w);
    }
    const floor = this.maxY - 0.012;
    if (lowest <= floor) return;
    const lift = lowest - floor;
    for (let i = 0; i < this.particles.length; i++) this.goalY[i] -= lift * this.goalW[i];
  }

  private uprightAlpha(): number {
    const globalCluster = this.clusters.find((cluster) => cluster.name === "global");
    if (!globalCluster) return 0;
    const angle = Math.atan2(globalCluster.r10, globalCluster.r00);
    return -angle * PARAMS.uprightK;
  }

  private breathAmount(): number {
    if (this.grab || this.meanSpeed > PARAMS.idleSpeed) {
      this.idleTime = 0;
      return 0;
    }
    this.idleTime += this.lastH;
    const settle = this.intro ? clamp((this.time - 0.85) / 0.45, 0, 1) : 1;
    const idle = clamp(this.idleTime / 0.4, 0, 1);
    return Math.sin(this.time * PARAMS.breathOmega) * PARAMS.breathAmp * idle * settle;
  }

  private solveConstraints(): void {
    const particles = this.particles;
    for (const c of this.constraints) {
      const a = particles[c.i];
      const b = particles[c.j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-4) {
        const rx = b.restX - a.restX;
        const ry = b.restY - a.restY;
        const rl = Math.hypot(rx, ry) || 1;
        const push = c.rest * 0.12;
        const nx = rx / rl;
        const ny = ry / rl;
        if (a.invMass > 0) {
          a.x -= nx * push;
          a.y -= ny * push;
        }
        if (b.invMass > 0) {
          b.x += nx * push;
          b.y += ny * push;
        }
        continue;
      }
      const give = this.impactFatigue > 0.12 ? 0.22 : 1;
      const stiffness = c.stiffness * give;
      const hi = c.limit ? c.rest * PARAMS.maxStretch : Infinity;
      const lo = c.limit ? c.rest * PARAMS.minStretch : 0;
      let target = c.rest + (dist - c.rest) * (1 - stiffness);
      if (dist > hi) target = hi;
      else if (dist < lo) target = lo;
      let delta = dist - target;
      delta = clamp(delta, -0.45, 0.45);
      const inv = a.invMass + b.invMass;
      if (inv <= 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const corr = delta / inv;
      a.x += nx * corr * a.invMass;
      a.y += ny * corr * a.invMass;
      b.x -= nx * corr * b.invMass;
      b.y -= ny * corr * b.invMass;
    }
  }

  private solvePressure(): void {
    const area = this.area();
    if (!Number.isFinite(area) || area <= this.restArea * 0.2) return;
    const diff = this.restArea - area;
    const scale = clamp(diff / this.restArea, -0.35, 0.45);
    const yieldScale = this.impactFatigue > 0.12 ? 0.2 : 1;
    const mag = PARAMS.pressure * scale * 0.22 * yieldScale;
    if (Math.abs(mag) < 1e-5) return;
    const com = this.center();
    const b = this.boundary;
    for (let n = 0; n < b.length; n++) {
      const p = this.particles[b[n]];
      const prev = this.particles[b[(n - 1 + b.length) % b.length]];
      const next = this.particles[b[(n + 1) % b.length]];
      let nx = next.y - prev.y;
      let ny = prev.x - next.x;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      const away = (p.x - com.x) * nx + (p.y - com.y) * ny;
      const sign = away < 0 ? -1 : 1;
      if (p.invMass === 0) continue;
      p.x += nx * sign * mag;
      p.y += ny * sign * mag;
    }
  }

  private solveWalls(h: number): void {
    let impact = 0;
    let contacts = 0;
    let lowest = -Infinity;
    for (const p of this.particles) {
      this.bounce(p, "x", this.minX, 1, h, PARAMS.wallPush, PARAMS.restitution);
      this.bounce(p, "x", this.maxX, -1, h, PARAMS.wallPush, PARAMS.restitution);
      this.bounce(p, "y", this.minY, 1, h, PARAMS.wallPush, PARAMS.restitution);
      lowest = Math.max(lowest, p.y);
      const vy = (p.y - p.py) / h;
      if (p.y > this.maxY - 0.04 && vy > 0.25) {
        contacts += 1;
        impact = Math.max(impact, vy);
      }
      this.bounce(p, "y", this.maxY, -1, h, PARAMS.floorPush, 0);
    }
    if (lowest < this.maxY - 0.18) this.clearOfFloor = true;
    if (this.clearOfFloor && contacts >= 1 && impact > PARAMS.impactSpeed && this.impactFatigue <= 0) {
      this.land(h);
      this.clearOfFloor = false;
    }
    if (this.impactFatigue > 0) this.impactFatigue = Math.max(0, this.impactFatigue - h);
  }

  /**
   * Inelastic contact. Downward speed at the floor is removed, so the candy
   * shortens under its own weight and stays down.
   */
  private land(h: number): void {
    const floor = this.maxY;
    for (const p of this.particles) {
      if (p.invMass === 0) continue;
      if (p.y > floor) p.y = floor;
      const above = floor - p.y;
      if (above > 0.22) continue;
      const vy = (p.y - p.py) / h;
      if (vy > 0) p.py = p.y;
    }
    this.impactFatigue = 0.55;
  }

  private bounce(
    p: Particle,
    axis: "x" | "y",
    wall: number,
    inward: 1 | -1,
    h: number,
    push: number,
    restitution: number,
  ): void {
    const before = p[axis];
    const pen = (wall - before) * inward;
    if (pen <= 0) return;
    p[axis] = before + pen * push * inward;
    const prevKey = axis === "x" ? "px" : "py";
    const vel = (before - p[prevKey]) / h;
    const outward = vel * inward < 0;
    const nv = outward ? -vel * restitution : vel;
    p[prevKey] = p[axis] - nv * h;
    const tangent = axis === "x" ? "y" : "x";
    const prevTangent = tangent === "x" ? "px" : "py";
    const tv = (p[tangent] - p[prevTangent]) / h;
    p[prevTangent] = p[tangent] - tv * 0.82 * h;
  }

  /** Once a landing has finished deforming, throw away the leftover vertical rattle. */
  private settle(h: number): void {
    if (this.grab || this.impactFatigue > 0) return;
    let bottom = -Infinity;
    for (const p of this.particles) bottom = Math.max(bottom, p.y);
    if (bottom < this.maxY - 0.04) return;
    for (const p of this.particles) {
      const vy = (p.y - p.py) / h;
      p.py = p.y - vy * 0.35 * h;
    }
  }

  private limitSpeed(h: number): void {
    let energy = 0;
    for (const p of this.particles) {
      let vx = (p.x - p.px) / h;
      let vy = (p.y - p.py) / h;
      const sp = Math.hypot(vx, vy);
      if (sp > PARAMS.maxSpeed) {
        const s = PARAMS.maxSpeed / sp;
        vx *= s;
        vy *= s;
        p.px = p.x - vx * h;
        p.py = p.y - vy * h;
      }
      energy += sp;
    }
    this.meanSpeed = energy / this.particles.length;
  }

  private updateStrain(): void {
    const acc = new Float64Array(this.particles.length);
    const cnt = new Float64Array(this.particles.length);
    for (const c of this.constraints) {
      if (!c.limit) continue;
      const a = this.particles[c.i];
      const b = this.particles[c.j];
      const ratio = Math.hypot(b.x - a.x, b.y - a.y) / c.rest;
      acc[c.i] += ratio;
      acc[c.j] += ratio;
      cnt[c.i]++;
      cnt[c.j]++;
    }
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].strain = cnt[i] ? acc[i] / cnt[i] : 1;
    }
  }

  /**
   * Positional pull toward the resting silhouette. Runs after edge constraints
   * so a fold can unwind. Particles already on the floor are not lifted, so
   * the candy unsquashes in place instead of hopping.
   */
  private projectShape(h: number): void {
    this.computeGoals();
    const pull = this.grab && this.mode === "pull" ? 0.008 : this.impactFatigue > 0 ? 0.012 : 0.045;
    const floor = this.maxY;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.invMass === 0) continue;
      const w = this.goalW[i];
      if (w < 1e-6) continue;
      const t = Math.min(0.22, pull * w);
      const gx = this.goalX[i] / w;
      const gy = this.goalY[i] / w;
      const vx = (p.x - p.px) / h;
      const vy = (p.y - p.py) / h;
      const planted = p.y > floor - 0.05;
      p.x += (gx - p.x) * t;
      let nextY = p.y + (gy - p.y) * t;
      if (nextY > floor) nextY = floor;
      if (planted && nextY < p.y) nextY = p.y;
      p.y = nextY;
      p.px = p.x - vx * h;
      p.py = p.y - vy * h;
    }
  }

  /** Pushes a boundary vertex back out when its turn has flipped into a knot. */
  private preventOutlineFold(): void {
    const b = this.boundary;
    const particles = this.particles;
    for (let n = 0; n < b.length; n++) {
      const a = particles[b[(n - 1 + b.length) % b.length]];
      const p = particles[b[n]];
      const c = particles[b[(n + 1) % b.length]];
      if (p.invMass === 0) continue;
      const restCross =
        (p.restX - a.restX) * (c.restY - p.restY) - (p.restY - a.restY) * (c.restX - p.restX);
      const cross = (p.x - a.x) * (c.y - p.y) - (p.y - a.y) * (c.x - p.x);
      if (restCross * cross >= 0 || Math.abs(restCross) < 0.0015) continue;
      const restChord = Math.hypot(c.restX - a.restX, c.restY - a.restY);
      const chord = Math.hypot(c.x - a.x, c.y - a.y);
      if (restChord < 1e-4 || chord < 1e-4) continue;
      const rx = (c.restX - a.restX) / restChord;
      const ry = (c.restY - a.restY) / restChord;
      const cx = (c.x - a.x) / chord;
      const cy = (c.y - a.y) / chord;
      const cos = rx * cx + ry * cy;
      const sin = rx * cy - ry * cx;
      const ox = p.restX - (a.restX + c.restX) * 0.5;
      const oy = p.restY - (a.restY + c.restY) * 0.5;
      const scale = Math.min(chord / restChord, 1.25);
      const tx = (cos * ox - sin * oy) * scale;
      const ty = (sin * ox + cos * oy) * scale;
      const targetX = (a.x + c.x) * 0.5 + tx;
      const targetY = (a.y + c.y) * 0.5 + ty;
      p.x += (targetX - p.x) * 0.65;
      p.y += (targetY - p.y) * 0.65;
    }
  }

  private anchorHeld(): void {
    const grab = this.grab;
    if (!grab) return;
    const h = this.lastH;
    const seatX = this.homeX - this.restComX;
    const seatY = this.homeY - this.restComY;
    if (this.mode === "drop") {
      const follow = PARAMS.carryFollow;
      grab.carryX += (grab.x - grab.restX - grab.carryX) * follow;
      grab.carryY += (grab.y - grab.restY - grab.carryY) * follow;
    } else {
      grab.carryX = seatX;
      grab.carryY = seatY;
    }
    const anchor = this.mode === "drop" ? 0.32 : PARAMS.holdAnchor;
    const sigma = this.mode === "pull" ? PARAMS.pullSigma : PARAMS.grabSigma;
    for (const p of this.particles) {
      const keep = (1 - this.grabWeight(p, sigma)) * anchor;
      if (keep <= 0.001) continue;
      const vx = (p.x - p.px) / h;
      const vy = (p.y - p.py) / h;
      p.x += (p.restX + grab.carryX - p.x) * keep;
      p.y += (p.restY + grab.carryY - p.y) * keep;
      const nvx = this.mode === "drop" ? vx + (grab.vx - vx) * keep : vx;
      const nvy = this.mode === "drop" ? vy + (grab.vy - vy) * keep : vy;
      p.px = p.x - nvx * h;
      p.py = p.y - nvy * h;
    }
  }

  private applyGrab(h: number, pinOnly: boolean): void {
    const grab = this.grab;
    if (!grab) return;
    const cluster = this.dominantCluster(grab.index);
    if (cluster) {
      grab.r00 = cluster.r00;
      grab.r01 = cluster.r01;
      grab.r10 = cluster.r10;
      grab.r11 = cluster.r11;
    }
    if (!pinOnly && this.mode === "drop") {
      for (const p of this.particles) {
        const w = this.grabWeight(p, PARAMS.grabSigma);
        if (w < 0.03) continue;
        const lx = p.restX - grab.restX;
        const ly = p.restY - grab.restY;
        const gx = grab.x + grab.r00 * lx + grab.r01 * ly;
        const gy = grab.y + grab.r10 * lx + grab.r11 * ly;
        const t = w * 0.9;
        p.x += (gx - p.x) * t;
        p.y += (gy - p.y) * t;
        const vx = (p.x - p.px) / h;
        const vy = (p.y - p.py) / h;
        const nvx = vx + (grab.vx - vx) * t;
        const nvy = vy + (grab.vy - vy) * t;
        p.px = p.x - nvx * h;
        p.py = p.y - nvy * h;
      }
    }
    if (!pinOnly && this.mode === "pull") {
      const seatX = this.homeX - this.restComX;
      const seatY = this.homeY - this.restComY;
      const dx = grab.x - (grab.restX + seatX);
      const dy = grab.y - (grab.restY + seatY);
      for (const p of this.particles) {
        const w = this.grabWeight(p, PARAMS.pullSigma);
        if (w < 0.03) continue;
        const tx = p.restX + seatX + dx * w;
        const ty = p.restY + seatY + dy * w;
        const t = PARAMS.pullFollow * (0.3 + 0.7 * w);
        p.x += (tx - p.x) * t;
        p.y += (ty - p.y) * t;
        const vx = (p.x - p.px) / h;
        const vy = (p.y - p.py) / h;
        p.px = p.x - vx * h;
        p.py = p.y - vy * h;
      }
    }
    const p = this.particles[grab.index];
    p.x = grab.x;
    p.y = grab.y;
    p.px = p.x - grab.vx * h;
    p.py = p.y - grab.vy * h;
  }

  private grabWeight(p: Particle, sigma = PARAMS.grabSigma): number {
    if (!this.grab) return 0;
    const dx = p.restX - this.grab.restX;
    const dy = p.restY - this.grab.restY;
    return Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
  }

  private dominantCluster(index: number): Cluster | undefined {
    let best: Cluster | undefined;
    let bestW = -1;
    for (const cluster of this.clusters) {
      if (cluster.name === "global") continue;
      if (!cluster.indices.includes(index)) continue;
      if (cluster.weight > bestW) {
        bestW = cluster.weight;
        best = cluster;
      }
    }
    return best ?? this.clusters[0];
  }

  private area(): number {
    const b = this.boundary;
    let a = 0;
    for (let i = 0; i < b.length; i++) {
      const p = this.particles[b[i]];
      const q = this.particles[b[(i + 1) % b.length]];
      a += p.x * q.y - q.x * p.y;
    }
    return a * 0.5;
  }

  private broken(): boolean {
    for (const p of this.particles) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return true;
      if (Math.abs(p.x) > 24 || Math.abs(p.y) > 24) return true;
    }
    return false;
  }
}

function pointInside(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function createSoftBody(options?: { intro?: boolean }): SoftBody {
  return new SoftBody(buildSharkMesh(), options?.intro ?? false);
}

export type { Binding };
