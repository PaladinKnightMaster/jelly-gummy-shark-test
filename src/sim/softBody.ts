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

  private readonly constraints: SharkMesh["constraints"];
  private readonly clusters: Cluster[];
  private readonly goalX: Float64Array;
  private readonly goalY: Float64Array;
  private readonly goalW: Float64Array;
  private readonly goalK: Float64Array;
  private grab: Grab | null = null;
  private lastH = 1 / 180;
  private accum = 0;
  private readonly preX: Float64Array;
  private readonly preY: Float64Array;
  private readonly solvedX: Float64Array;
  private readonly solvedY: Float64Array;
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
    this.preX = new Float64Array(n);
    this.preY = new Float64Array(n);
    this.solvedX = new Float64Array(n);
    this.solvedY = new Float64Array(n);
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
    this.accum = 0;
    this.idleTime = 0;
    this.meanSpeed = 0;
    this.impactFatigue = 0;
    this.clearOfFloor = true;
    if (this.intro) this.poseIntro();
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

  /**
   * The candy already carries the velocity it gained while the hand was moving.
   * Blend the pinched neighborhood toward the pointer velocity, capped, and
   * leave the rest of the body alone. Nothing is pinned, and nothing is zeroed.
   */
  endGrab(): void {
    if (!this.grab) return;
    const h = this.lastH;
    let vx = this.grab.vx;
    let vy = this.grab.vy;
    const sp = Math.hypot(vx, vy);
    if (sp > PARAMS.maxSpeed) {
      vx *= PARAMS.maxSpeed / sp;
      vy *= PARAMS.maxSpeed / sp;
    }
    for (const p of this.particles) {
      const w = this.grabWeight(p);
      // The whole candy takes most of the throw. The pinched spot leads,
      // but not by enough to yank an edge through its lock.
      const share = 0.62 + 0.38 * w;
      const cvx = (p.x - p.px) / h;
      const cvy = (p.y - p.py) / h;
      let nvx = cvx + (vx - cvx) * share;
      let nvy = cvy + (vy - cvy) * share;
      const nsp = Math.hypot(nvx, nvy);
      if (nsp > PARAMS.maxSpeed) {
        nvx *= PARAMS.maxSpeed / nsp;
        nvy *= PARAMS.maxSpeed / nsp;
      }
      p.px = p.x - nvx * h;
      p.py = p.y - nvy * h;
    }
    this.grab = null;
  }

  /**
   * A resize changes the room under the hand. Drop the grab and slide the
   * whole body back inside, instead of letting the old world-space pinch
   * pin the candy into a corner.
   */
  adaptToRoom(): boolean {
    const released = this.grab !== null;
    if (released) this.endGrab();
    this.fitInside();
    return released;
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
    // Fixed substep so a 30Hz frame and a 120Hz frame run the same integration.
    const h = 1 / (60 * PARAMS.substeps);
    this.lastH = h;
    this.accum += frame;
    let steps = 0;
    while (this.accum >= h - 1e-8 && steps < 8) {
      this.substep(h);
      this.accum -= h;
      steps += 1;
    }
    this.seal();
    // Edge projection can pinch the outline back into a crossing. Unfold
    // after it, then lock lengths once more. The published frame is this one.
    this.uncross(this.lastH);
    this.seal();
    this.time += frame;
    if (this.broken()) this.reset();
  }

  /**
   * Last word on the published frame. The locked set is the outline ring,
   * a degree-2 cycle, so a few exact projections land inside the band.
   * Interior links stay soft: locking them together with the ring does not converge.
   */
  private seal(): void {
    for (let pass = 0; pass < 28; pass++) {
      let violated = false;
      for (const c of this.constraints) {
        if (!c.limit) continue;
        const a = this.particles[c.i];
        const b = this.particles[c.j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1e-6) {
          violated = true;
          continue;
        }
        const hi = c.rest * PARAMS.maxStretch;
        const lo = c.rest * PARAMS.minStretch;
        if (dist <= hi && dist >= lo) continue;
        violated = true;
        const target = dist > hi ? hi : lo;
        this.separate(a, b, dx / dist, dy / dist, dist - target);
      }
      if (!violated) return;
    }
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
      const held = this.grab ? 0.08 : 1;
      const k = (this.goalK[i] / w) * held;
      const spin = this.uprightAlpha() * (this.grab ? 0.12 : 1);
      const homeK = this.grab ? 0.05 : 1;
      const ax =
        (gx - p.x) * k + (this.homeX - com.x) * PARAMS.comKX * homeK - (p.y - com.y) * spin;
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
    this.enforceLimits();
    for (let i = 0; i < this.particles.length; i++) {
      this.preX[i] = this.particles[i].x;
      this.preY[i] = this.particles[i].y;
    }

    // The pointer moves the candy first. Every later pass may pull that
    // motion back. The last pass is the stretch limit, so a grab cannot
    // publish an edge the constraints have not accepted.
    this.pullTowardPointer(h);
    for (let n = 0; n < PARAMS.constraintIterations; n++) this.solveConstraints();
    this.solvePressure();
    this.projectShape(h);
    this.preventOutlineFold();
    this.enforceLimits();
    this.solveWalls(h);
    this.enforceLimits();
    this.retreatToLegal(h);
    this.uncross(h);
    this.recoverShape(h);
    this.retreatToLegal(h);
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
   * Local clusters follow whatever stack they have collapsed into. Mix the
   * full-body rest pose back in, around the current center, so a landing can
   * unsquash where it fell. Translation is not part of this pose.
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
    const share = this.grab ? PARAMS.silhouetteHeld : PARAMS.silhouette;
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
        this.separate(a, b, rx / rl, ry / rl, -c.rest * 0.5);
        continue;
      }
      const give = this.impactFatigue > 0.12 ? 0.35 : 1;
      const stiffness = c.stiffness * give;
      const hi = c.limit ? c.rest * PARAMS.maxStretch : Infinity;
      const lo = c.limit ? c.rest * PARAMS.minStretch : 0;
      let target = c.rest + (dist - c.rest) * (1 - stiffness);
      if (dist > hi) target = hi;
      else if (dist < lo) target = lo;
      const delta = dist - target;
      this.separate(a, b, dx / dist, dy / dist, delta);
    }
  }

  /**
   * Project every structural edge onto [minStretch, maxStretch] exactly.
   * Position corrections move the previous position by the same amount, so
   * the correction does not invent a velocity that grows as the frame gets shorter.
   */
  private enforceLimits(): void {
    const particles = this.particles;
    for (let pass = 0; pass < PARAMS.enforcePasses; pass++) {
      let violated = false;
      for (const c of this.constraints) {
        if (!c.limit) continue;
        const a = particles[c.i];
        const b = particles[c.j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const hi = c.rest * PARAMS.maxStretch;
        const lo = c.rest * PARAMS.minStretch;
        if (dist < 1e-4) {
          const rx = b.restX - a.restX;
          const ry = b.restY - a.restY;
          const rl = Math.hypot(rx, ry) || 1;
          this.separate(a, b, rx / rl, ry / rl, -lo);
          violated = true;
          continue;
        }
        if (dist <= hi && dist >= lo) continue;
        violated = true;
        const target = dist > hi ? hi : lo;
        this.separate(a, b, dx / dist, dy / dist, dist - target);
      }
      if (!violated) return;
    }
  }

  /**
   * If the sweeps stop a hair over the stretch lock, walk back toward the
   * post-integration pose until every structural edge is inside the band.
   * That pose was reached without the grab, so the walk cannot invent a tear.
   */
  private retreatToLegal(h: number): void {
    if (this.withinBand()) return;
    const n = this.particles.length;
    for (let i = 0; i < n; i++) {
      this.solvedX[i] = this.particles[i].x;
      this.solvedY[i] = this.particles[i].y;
    }
    let legal = 0;
    let illegal = 1;
    for (let k = 0; k < 7; k++) {
      const mid = (legal + illegal) * 0.5;
      this.blendToward(mid, h);
      if (this.withinBand()) legal = mid;
      else illegal = mid;
    }
    this.blendToward(legal, h);
    if (this.withinBand()) return;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const vx = (p.x - p.px) / h;
      const vy = (p.y - p.py) / h;
      p.x = this.preX[i];
      p.y = this.preY[i];
      p.px = p.x - vx * h;
      p.py = p.y - vy * h;
    }
  }

  private blendToward(alpha: number, h: number): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const vx = (p.x - p.px) / h;
      const vy = (p.y - p.py) / h;
      p.x = this.preX[i] + (this.solvedX[i] - this.preX[i]) * alpha;
      p.y = this.preY[i] + (this.solvedY[i] - this.preY[i]) * alpha;
      p.px = p.x - vx * h;
      p.py = p.y - vy * h;
    }
  }

  private withinBand(): boolean {
    const hi = PARAMS.maxStretch;
    const lo = PARAMS.minStretch;
    for (const c of this.constraints) {
      if (!c.limit) continue;
      const a = this.particles[c.i];
      const b = this.particles[c.j];
      const ratio = Math.hypot(b.x - a.x, b.y - a.y) / c.rest;
      if (ratio > hi || ratio < lo) return false;
    }
    return true;
  }

  /** Move a pair along n so their distance changes by `delta`, without changing velocity. */
  private separate(a: Particle, b: Particle, nx: number, ny: number, delta: number): void {
    const inv = a.invMass + b.invMass;
    if (inv <= 0 || delta === 0) return;
    const corr = delta / inv;
    const ax = nx * corr * a.invMass;
    const ay = ny * corr * a.invMass;
    const bx = nx * corr * b.invMass;
    const by = ny * corr * b.invMass;
    a.x += ax;
    a.y += ay;
    a.px += ax;
    a.py += ay;
    b.x -= bx;
    b.y -= by;
    b.px -= bx;
    b.py -= by;
  }

  private solvePressure(): void {
    const area = this.area();
    if (!Number.isFinite(area) || area <= 0) return;
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
      const ox = nx * sign * mag;
      const oy = ny * sign * mag;
      p.x += ox;
      p.y += oy;
      p.px += ox;
      p.py += oy;
    }
  }

  private solveWalls(h: number): void {
    let impact = 0;
    let contacts = 0;
    let lowest = -Infinity;
    let wallHit = 0;
    for (const p of this.particles) {
      wallHit = Math.max(wallHit, this.bounce(p, "x", this.minX, 1, h, PARAMS.wallPush, PARAMS.restitution));
      wallHit = Math.max(wallHit, this.bounce(p, "x", this.maxX, -1, h, PARAMS.wallPush, PARAMS.restitution));
      wallHit = Math.max(wallHit, this.bounce(p, "y", this.minY, 1, h, PARAMS.wallPush, PARAMS.restitution));
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
    if (wallHit > PARAMS.impactSpeed && this.impactFatigue <= 0) this.impactFatigue = 0.28;
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
  ): number {
    const before = p[axis];
    const pen = (wall - before) * inward;
    if (pen <= 0) return 0;
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
    return Math.abs(vel);
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
    const areaRatio = Math.abs(this.area()) / this.restArea;
    const collapsed = areaRatio < 0.75;
    const pull = this.grab ? 0 : collapsed ? 0.2 : this.impactFatigue > 0 ? 0.012 : 0.06;
    const floor = this.maxY;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.invMass === 0) continue;
      const w = this.goalW[i];
      if (w < 1e-6) continue;
      const t = Math.min(0.28, pull * w);
      const gx = this.goalX[i] / w;
      const gy = this.goalY[i] / w;
      const vx = (p.x - p.px) / h;
      const vy = (p.y - p.py) / h;
      // Only the real underside stays planted. A crumpled fin that has
      // fallen onto the floor still has to be allowed to rise.
      const planted =
        !this.grab && !collapsed && p.y > floor - 0.04 && p.restY > this.restBottom - 0.06;
      const nextX = p.x + (gx - p.x) * t;
      let nextY = p.y + (gy - p.y) * t;
      if (nextY > floor) nextY = floor;
      if (planted && nextY < p.y) nextY = p.y;
      p.x = nextX;
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
      const restChord = Math.hypot(c.restX - a.restX, c.restY - a.restY);
      const chord = Math.hypot(c.x - a.x, c.y - a.y);
      if (restChord < 1e-4 || chord < 1e-4) continue;
      // A corner that kept its sign but sank onto the chord is a notch.
      // Only when the chord itself is still long, so a floor squash is left alone.
      const collapsedCorner =
        restCross * cross > 0 &&
        Math.abs(restCross) > 0.002 &&
        chord > restChord * 0.8 &&
        Math.abs(cross) < Math.abs(restCross) * 0.28;
      if ((restCross * cross >= 0 && !collapsedCorner) || Math.abs(restCross) < 0.0015) continue;
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
      const fixX = (targetX - p.x) * 0.65;
      const fixY = (targetY - p.y) * 0.65;
      p.x += fixX;
      p.y += fixY;
      p.px += fixX;
      p.py += fixY;
    }
  }

  /**
   * Chase the pointer by at most grabSpeed * h, shared with a gaussian
   * neighborhood. The contact is not assigned to the pointer. Edges that
   * this step stretches are pulled back by enforceLimits before the substep ends.
   */
  private pullTowardPointer(h: number): void {
    const grab = this.grab;
    if (!grab) return;
    const p0 = this.particles[grab.index];
    let dx = grab.x - p0.x;
    let dy = grab.y - p0.y;
    const dist = Math.hypot(dx, dy);
    const maxStep = PARAMS.grabSpeed * h;
    if (dist > maxStep && dist > 1e-8) {
      dx *= maxStep / dist;
      dy *= maxStep / dist;
    }
    const rigid = PARAMS.carry;
    const rx = dx * rigid;
    const ry = dy * rigid;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.x += rx;
      p.y += ry;
      p.px += rx;
      p.py += ry;
      this.preX[i] += rx;
      this.preY[i] += ry;
    }
    const lx = dx - rx;
    const ly = dy - ry;
    for (const p of this.particles) {
      const w = this.grabWeight(p);
      if (w < 0.03) continue;
      const ox = lx * w;
      const oy = ly * w;
      p.x += ox;
      p.y += oy;
      p.px += ox;
      p.py += oy;
    }
  }

  /** Slide the whole body so it sits in the room. A translation, not a crush. */
  private fitInside(): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.particles) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const roomW = this.maxX - this.minX;
    const roomH = this.maxY - this.minY;
    let dx = 0;
    let dy = 0;
    if (maxX - minX > roomW) dx = (this.minX + this.maxX) / 2 - (minX + maxX) / 2;
    else if (minX < this.minX) dx = this.minX - minX;
    else if (maxX > this.maxX) dx = this.maxX - maxX;
    if (maxY - minY > roomH) dy = (this.minY + this.maxY) / 2 - (minY + maxY) / 2;
    else if (minY < this.minY) dy = this.minY - minY;
    else if (maxY > this.maxY) dy = this.maxY - maxY;
    if (dx === 0 && dy === 0) return;
    for (const p of this.particles) {
      p.x += dx;
      p.y += dy;
      p.px += dx;
      p.py += dy;
    }
  }

  /**
   * If the outline has collapsed or blown up and nobody is holding it,
   * ease particles toward the rest pose around the current center.
   * The center stays where the candy is. This is not a return to a seat.
   */
  /**
   * A 2D outline can accordion while every edge is still inside the stretch
   * band. When the polygon crosses itself or loses most of its area, ease it
   * back toward the resting silhouette around the current center. This also
   * runs during a grab: a pull may bend the candy, and it may not tie a knot.
   */
  private uncross(h: number): void {
    for (let n = 0; n < 3; n++) {
      if (!this.outlineCrossed()) return;
      this.blendToRest(0.28, h);
    }
  }

  private outlineCrossed(): boolean {
    const b = this.boundary;
    const n = b.length;
    const particles = this.particles;
    for (let i = 0; i < n; i++) {
      const a = particles[b[i]];
      const c = particles[b[(i + 1) % n]];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const d = particles[b[j]];
        const e = particles[b[(j + 1) % n]];
        const o1 = (c.x - a.x) * (d.y - a.y) - (c.y - a.y) * (d.x - a.x);
        const o2 = (c.x - a.x) * (e.y - a.y) - (c.y - a.y) * (e.x - a.x);
        const o3 = (e.x - d.x) * (a.y - d.y) - (e.y - d.y) * (a.x - d.x);
        const o4 = (e.x - d.x) * (c.y - d.y) - (e.y - d.y) * (c.x - d.x);
        if (o1 * o2 < 0 && o3 * o4 < 0) return true;
      }
    }
    return false;
  }

  /** Move toward the resting silhouette around the current center, then sit it on the floor. */
  private blendToRest(rate: number, h: number): void {
    const com = this.center();
    const tx = com.x - this.restComX;
    let ty = com.y - this.restComY;
    const floor = this.maxY;
    const poseBottom = this.restBottom + ty;
    if (poseBottom > floor) ty -= poseBottom - floor;
    for (const p of this.particles) {
      const vx = (p.x - p.px) / h;
      const vy = (p.y - p.py) / h;
      p.x += (p.restX + tx - p.x) * rate;
      p.y += (p.restY + ty - p.y) * rate;
      if (p.y > floor) p.y = floor;
      p.px = p.x - vx * h;
      p.py = p.y - vy * h;
    }
  }

  private recoverShape(h: number): void {
    if (this.grab) return;
    const area = this.area();
    const ratio = Math.abs(area) / this.restArea;
    // A normal landing is allowed to sit a little under the free area.
    // Below 0.75 the outline has folded and has to come back even while
    // the impact timer is still counting down.
    if (area > 0 && ratio > 0.9 && ratio < 1.22) return;
    if (this.impactFatigue > 0 && ratio > 0.75) return;
    this.blendToRest(ratio < 0.75 || area <= 0 ? 0.22 : 0.12, h);
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

  /** Structural edge ratios and outline area. The final substep state, not a mid-solve one. */
  metrics(): {
    areaRatio: number;
    maxEdge: number;
    minEdge: number;
    worstRest: number;
    worstExcess: number;
    finite: boolean;
    crossed: boolean;
  } {
    let maxEdge = 0;
    let minEdge = Infinity;
    let worstRest = 0;
    let worstExcess = 0;
    let finite = true;
    for (const c of this.constraints) {
      if (!c.limit) continue;
      const a = this.particles[c.i];
      const b = this.particles[c.j];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const ratio = dist / c.rest;
      if (ratio > maxEdge) {
        maxEdge = ratio;
        worstRest = c.rest;
        worstExcess = dist - c.rest * PARAMS.maxStretch;
      }
      if (ratio < minEdge) minEdge = ratio;
    }
    for (const p of this.particles) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.px) || !Number.isFinite(p.py)) {
        finite = false;
      }
    }
    const area = this.area();
    return {
      areaRatio: Number.isFinite(area) ? Math.abs(area) / this.restArea : 0,
      maxEdge,
      minEdge,
      worstRest,
      worstExcess,
      finite: finite && Number.isFinite(area),
      crossed: this.outlineCrossed(),
    };
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
