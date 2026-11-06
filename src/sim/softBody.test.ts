import { describe, expect, it } from "vitest";
import { PARAMS } from "../params";
import { evalBinding } from "./geometry";
import { createSoftBody, type SoftBody } from "./softBody";

/**
 * The stretch lock is the outline ring. A hard wall throw still publishes a
 * frame whose worst edge is about 1.65. On a 0.06 rest edge that is
 * 0.002 world units past the lock.
 * V1 left those same edges at 7 to 10 times rest.
 */
const EDGE_TOL = 0.04;

function openRoom(body: SoftBody): void {
  // Floor sits just under the belly, as it does on screen. A room whose
  // floor is several body-lengths below turns every case into a high drop.
  body.minX = -8;
  body.maxX = 8;
  body.minY = -3;
  body.maxY = 1.35;
}

function extreme(body: SoftBody, key: "restX" | "restY", dir: 1 | -1): number {
  return body.particles.reduce(
    (best, p, i) => (dir * p[key] > dir * body.particles[best][key] ? i : best),
    0,
  );
}

function span(body: SoftBody): { w: number; h: number; left: number; right: number; top: number; bottom: number } {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of body.particles) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  return { w: right - left, h: bottom - top, left, right, top, bottom };
}

function hold(body: SoftBody, index: number, x: number, y: number, frames: number, vx = 0, vy = 0, dt = 1 / 60): void {
  const p = body.particles[index];
  const sx = p.x;
  const sy = p.y;
  expect(body.beginGrab(sx, sy)).toBe(true);
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    body.moveGrab(sx + (x - sx) * t, sy + (y - sy) * t, vx, vy);
    body.step(dt);
    const m = body.metrics();
    expect(m.finite).toBe(true);
    expect(m.maxEdge).toBeLessThanOrEqual(PARAMS.maxStretch + EDGE_TOL);
    expect(m.minEdge).toBeGreaterThanOrEqual(PARAMS.minStretch - EDGE_TOL);
    expect(m.areaRatio).toBeGreaterThan(0.62);
    expect(m.areaRatio).toBeLessThan(1.45);
    expect(m.crossed).toBe(false);
  }
}

function assertSettled(body: SoftBody): void {
  const m = body.metrics();
  expect(m.finite).toBe(true);
  expect(m.maxEdge).toBeLessThanOrEqual(PARAMS.maxStretch + EDGE_TOL);
  expect(m.minEdge).toBeGreaterThanOrEqual(PARAMS.minStretch - EDGE_TOL);
  // Gravity and the compression lock leave a seated shark under its free
  // area. Measured settle after a hard grab is about 0.62. The V1 failure
  // this guards against was 0.16, with a crossed outline.
  expect(m.areaRatio).toBeGreaterThan(0.6);
  expect(m.areaRatio).toBeLessThan(1.2);
  expect(m.crossed).toBe(false);
  expect(body.meanSpeed).toBeLessThan(PARAMS.maxSpeed);
}

function snoutIndex(body: ReturnType<typeof createSoftBody>): number {
  let index = 0;
  let best = -Infinity;
  body.particles.forEach((p, i) => {
    if (p.restX > best) {
      best = p.restX;
      index = i;
    }
  });
  return index;
}

function tailIndex(body: ReturnType<typeof createSoftBody>): number {
  let index = 0;
  let best = Infinity;
  body.particles.forEach((p, i) => {
    if (p.restX < best) {
      best = p.restX;
      index = i;
    }
  });
  return index;
}

describe("gummy shark body", () => {
  it("builds a recognizable shark mesh", () => {
    const body = createSoftBody();
    expect(body.boundary.length).toBeGreaterThan(80);
    expect(body.particles.length).toBeGreaterThan(body.boundary.length + 40);
    const rest = body.particles.map((p) => ({ x: p.restX, y: p.restY }));
    const xs = rest.map((p) => p.x);
    const ys = rest.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    expect(width).toBeCloseTo(2.4, 1);
    expect(width).toBeGreaterThan(height * 1.35);

    const dorsal = rest.filter((p) => p.y < Math.min(...ys) + height * 0.22).length;
    const pectoral = rest.filter((p) => p.y > Math.max(...ys) - height * 0.22).length;
    const tail = rest.filter((p) => p.x < Math.min(...xs) + width * 0.18).length;
    expect(dorsal).toBeGreaterThan(6);
    expect(pectoral).toBeGreaterThan(6);
    expect(tail).toBeGreaterThan(8);

    const eye = evalBinding(body.features.eye, rest);
    expect(eye.x).toBeGreaterThan(0.2);
    expect(Number.isFinite(eye.y)).toBe(true);
  });

  it("pulls the snout farther than the tail", () => {
    const body = createSoftBody();
    openRoom(body);
    const snout = snoutIndex(body);
    const tail = tailIndex(body);
    let mid = 0;
    let midScore = Infinity;
    body.particles.forEach((p, i) => {
      const score = Math.abs(p.restX - 0.35) + Math.abs(p.restY) * 3;
      if (score < midScore) {
        midScore = score;
        mid = i;
      }
    });
    const origin = body.particles[snout];
    const tailX = body.particles[tail].x;
    const midX = body.particles[mid].x;
    expect(body.beginGrab(origin.x, origin.y)).toBe(true);
    for (let i = 0; i < 18; i++) {
      body.moveGrab(origin.restX + 0.95, origin.restY, 0.2, 0);
      body.step(1 / 60);
    }
    const snoutShift = body.particles[snout].x - origin.restX;
    const midShift = Math.abs(body.particles[mid].x - midX);
    const tailShift = Math.abs(body.particles[tail].x - tailX);
    expect(snoutShift).toBeGreaterThan(0.55);
    expect(midShift).toBeGreaterThan(0.12);
    expect(midShift).toBeLessThan(snoutShift * 0.75);
    expect(tailShift).toBeLessThan(snoutShift * 0.55);
    const m = body.metrics();
    expect(m.maxEdge).toBeLessThanOrEqual(PARAMS.maxStretch + EDGE_TOL);
    expect(m.areaRatio).toBeGreaterThan(0.75);
    expect(m.areaRatio).toBeLessThan(1.35);
  });

  it("carries the whole shark while the pinched snout still leads", () => {
    const body = createSoftBody();
    openRoom(body);
    const snout = snoutIndex(body);
    const tail = tailIndex(body);
    const origin = body.particles[snout];
    expect(body.beginGrab(origin.x, origin.y)).toBe(true);
    for (let i = 1; i <= 18; i++) {
      body.moveGrab(origin.restX + i * 0.08, origin.restY - 0.04, 5, -2);
      body.step(1 / 60);
    }
    const com = body.center();
    const snoutLead = body.particles[snout].x - com.x - body.particles[snout].restX;
    const tailLead = body.particles[tail].x - com.x - body.particles[tail].restX;
    expect(com.x).toBeGreaterThan(0.28);
    expect(snoutLead).toBeGreaterThan(tailLead + 0.04);
    for (const p of body.particles) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("drops onto the floor, shortens, and stays down", () => {
    const body = createSoftBody();
    body.minX = -4;
    body.maxX = 4;
    body.minY = -3;
    body.maxY = 1.2;
    const spanOf = () => {
      let top = Infinity;
      let bottom = -Infinity;
      for (const p of body.particles) {
        top = Math.min(top, p.y);
        bottom = Math.max(bottom, p.y);
      }
      return bottom - top;
    };
    const restSpan = spanOf();
    for (const p of body.particles) {
      p.y -= 1.15;
      p.py = p.y;
      p.px = p.x;
    }
    let touched = false;
    let minSpan = restSpan;
    let leftFloor = false;
    for (let i = 0; i < 180; i++) {
      body.step(1 / 60);
      const bottom = Math.max(...body.particles.map((p) => p.y));
      if (bottom > body.maxY - 0.08) {
        touched = true;
        minSpan = Math.min(minSpan, spanOf());
      }
      if (touched && bottom < body.maxY - 0.06) leftFloor = true;
      for (const p of body.particles) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
    expect(touched).toBe(true);
    expect(minSpan).toBeLessThan(restSpan * 0.94);
    expect(leftFloor).toBe(false);
    expect(body.meanSpeed).toBeLessThan(1.2);
  });

  it("recovers the snout shape without deleting a slow release", () => {
    const body = createSoftBody();
    openRoom(body);
    const snout = snoutIndex(body);
    const origin = body.particles[snout];
    const restLead = origin.restX - body.center().x;
    body.beginGrab(origin.x, origin.y);
    for (let i = 0; i < 20; i++) {
      body.moveGrab(origin.restX + 0.8, origin.restY - 0.1, 0.4, 0);
      body.step(1 / 60);
    }
    const pulledLead = body.particles[snout].x - body.center().x;
    body.endGrab();
    for (let i = 0; i < 240; i++) body.step(1 / 60);
    const lead = body.particles[snout].x - body.center().x;
    expect(Math.abs(lead - restLead)).toBeLessThan(Math.abs(pulledLead - restLead) * 0.55);
    assertSettled(body);
  });

  it("unwinds an inverted fin instead of keeping the knot", () => {
    const body = createSoftBody();
    const b = body.boundary;
    let flipped = -1;
    for (let n = 0; n < b.length; n++) {
      const a = body.particles[b[(n - 1 + b.length) % b.length]];
      const p = body.particles[b[n]];
      const c = body.particles[b[(n + 1) % b.length]];
      const restCross =
        (p.restX - a.restX) * (c.restY - p.restY) - (p.restY - a.restY) * (c.restX - p.restX);
      if (p.restY < -0.12 && Math.abs(restCross) > 0.002) {
        const mx = (a.x + c.x) / 2;
        const my = (a.y + c.y) / 2;
        p.x = 2 * mx - p.x;
        p.y = 2 * my - p.y;
        p.px = p.x;
        p.py = p.y;
        flipped = n;
        break;
      }
    }
    expect(flipped).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 240; i++) body.step(1 / 60);
    const a = body.particles[b[(flipped - 1 + b.length) % b.length]];
    const p = body.particles[b[flipped]];
    const c = body.particles[b[(flipped + 1) % b.length]];
    const restCross =
      (p.restX - a.restX) * (c.restY - p.restY) - (p.restY - a.restY) * (c.restX - p.restX);
    const cross = (p.x - a.x) * (c.y - p.y) - (p.y - a.y) * (c.x - p.x);
    // A flat corner is not an inverted knot. The turn must not stay flipped.
    expect(restCross * cross).toBeGreaterThan(-1e-4);
    expect(body.meanSpeed).toBeLessThan(1.2);
  });

  it("keeps a fast flick inside the room and finite", () => {
    const body = createSoftBody();
    body.minX = -3.2;
    body.maxX = 3.2;
    body.minY = -2.2;
    body.maxY = 2.2;
    const snout = snoutIndex(body);
    const origin = body.particles[snout];
    body.beginGrab(origin.x, origin.y);
    body.moveGrab(origin.x + 0.2, origin.y - 0.1, 18, -14);
    body.step(1 / 60);
    body.endGrab();
    for (let i = 0; i < 240; i++) body.step(1 / 60);
    for (const p of body.particles) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.x).toBeGreaterThan(-8);
      expect(p.x).toBeLessThan(8);
      expect(p.y).toBeGreaterThan(-8);
      expect(p.y).toBeLessThan(8);
    }
    expect(body.metrics().maxEdge).toBeLessThanOrEqual(PARAMS.maxStretch + EDGE_TOL);
    expect(body.metrics().areaRatio).toBeGreaterThan(0.6);
    expect(body.metrics().crossed).toBe(false);
  });
});

describe("v2 structural integrity", () => {
  it("stretches the tail less than the snout and keeps the outline", () => {
    const body = createSoftBody();
    openRoom(body);
    const tail = tailIndex(body);
    const snout = snoutIndex(body);
    const tailRest = body.particles[tail].x;
    const snoutRest = body.particles[snout].x;
    hold(body, tail, tailRest - 0.7, body.particles[tail].y, 24, -1.2, 0);
    const tailShift = Math.abs(body.particles[tail].x - tailRest);
    const snoutShift = Math.abs(body.particles[snout].x - snoutRest);
    expect(tailShift).toBeGreaterThan(0.35);
    expect(snoutShift).toBeLessThan(tailShift * 0.65);
    body.endGrab();
    for (let i = 0; i < 180; i++) body.step(1 / 60);
    assertSettled(body);
  });

  it("lifts the dorsal fin without doubling the area", () => {
    const body = createSoftBody();
    openRoom(body);
    const fin = extreme(body, "restY", -1);
    const belly = extreme(body, "restY", 1);
    const finRest = body.particles[fin].y;
    const bellyRest = body.particles[belly].y;
    hold(body, fin, body.particles[fin].x, finRest - 0.55, 24, 0, -2);
    expect(body.particles[fin].y).toBeLessThan(finRest - 0.22);
    expect(Math.abs(body.particles[belly].y - bellyRest)).toBeLessThan(0.35);
    expect(body.metrics().areaRatio).toBeLessThan(1.35);
    body.endGrab();
    for (let i = 0; i < 180; i++) body.step(1 / 60);
    assertSettled(body);
  });

  it("absorbs an extreme pointer jump without tearing", () => {
    const body = createSoftBody();
    openRoom(body);
    const snout = snoutIndex(body);
    const p = body.particles[snout];
    expect(body.beginGrab(p.x, p.y)).toBe(true);
    body.moveGrab(p.restX + 6, p.restY - 3, 40, -30);
    for (let i = 0; i < 30; i++) {
      body.step(1 / 60);
      const m = body.metrics();
      expect(m.finite).toBe(true);
      expect(m.maxEdge).toBeLessThanOrEqual(PARAMS.maxStretch + EDGE_TOL);
      expect(m.minEdge).toBeGreaterThanOrEqual(PARAMS.minStretch - EDGE_TOL);
      expect(m.areaRatio).toBeGreaterThan(0.62);
      expect(m.areaRatio).toBeLessThan(1.45);
      expect(body.meanSpeed).toBeLessThanOrEqual(PARAMS.maxSpeed + 0.05);
    }
    body.endGrab();
    for (let i = 0; i < 180; i++) body.step(1 / 60);
    assertSettled(body);
  });

  it("keeps a fast release moving, then stays one piece", () => {
    const body = createSoftBody();
    openRoom(body);
    const snout = snoutIndex(body);
    const p = body.particles[snout];
    const x0 = body.center().x;
    body.beginGrab(p.x, p.y);
    for (let i = 0; i < 8; i++) {
      body.moveGrab(p.restX + (i + 1) * 0.16, p.restY, 9, 0);
      body.step(1 / 60);
    }
    body.endGrab();
    body.step(1 / 60);
    for (let i = 0; i < 15; i++) body.step(1 / 60);
    expect(body.center().x).toBeGreaterThan(x0 + 0.35);
    for (let i = 0; i < 180; i++) body.step(1 / 60);
    assertSettled(body);
    expect(span(body).w).toBeGreaterThan(1.5);
  });

  it("survives a throw into the right wall", () => {
    const body = createSoftBody();
    body.minX = -3;
    body.maxX = 2.1;
    body.minY = -2.5;
    body.maxY = 2.5;
    const h = 1 / 60 / PARAMS.substeps;
    for (const p of body.particles) p.px = p.x - 8 * h;
    let sawContact = false;
    for (let i = 0; i < 90; i++) {
      body.step(1 / 60);
      const m = body.metrics();
      expect(m.finite).toBe(true);
      expect(m.maxEdge).toBeLessThanOrEqual(PARAMS.maxStretch + EDGE_TOL);
      // A full-speed wall hit flattens the outline to about 0.47 of its rest
      // area for a few frames. The settled check is what requires it to return.
      expect(m.areaRatio).toBeGreaterThan(0.42);
      expect(m.areaRatio).toBeLessThan(1.45);
      if (span(body).right > body.maxX - 0.08) sawContact = true;
    }
    expect(sawContact).toBe(true);
    for (let i = 0; i < 160; i++) body.step(1 / 60);
    assertSettled(body);
    expect(span(body).w / span(body).h).toBeGreaterThan(1.15);
  });

  it("survives a throw into the left wall", () => {
    const body = createSoftBody();
    body.minX = -2.1;
    body.maxX = 3;
    body.minY = -2.5;
    body.maxY = 2.5;
    const h = 1 / 60 / PARAMS.substeps;
    for (const p of body.particles) p.px = p.x + 8 * h;
    let sawContact = false;
    for (let i = 0; i < 90; i++) {
      body.step(1 / 60);
      const m = body.metrics();
      expect(m.finite).toBe(true);
      expect(m.maxEdge).toBeLessThanOrEqual(PARAMS.maxStretch + EDGE_TOL);
      expect(m.areaRatio).toBeGreaterThan(0.42);
      if (span(body).left < body.minX + 0.08) sawContact = true;
    }
    expect(sawContact).toBe(true);
    for (let i = 0; i < 160; i++) body.step(1 / 60);
    assertSettled(body);
    expect(span(body).w / span(body).h).toBeGreaterThan(1.15);
  });

  it("bends the head toward the tail and restores a shark", () => {
    const body = createSoftBody();
    openRoom(body);
    const snout = snoutIndex(body);
    const tail = tailIndex(body);
    const restW = span(body).w;
    const targetX = body.particles[tail].restX + 0.2;
    const targetY = body.particles[tail].restY - 0.15;
    hold(body, snout, targetX, targetY, 36, -6, -1);
    expect(body.metrics().areaRatio).toBeGreaterThan(0.62);
    body.endGrab();
    for (let i = 0; i < 200; i++) body.step(1 / 60);
    assertSettled(body);
    expect(span(body).w).toBeGreaterThan(restW * 0.8);
  });

  it("stays valid across repeated grabs", () => {
    const body = createSoftBody();
    openRoom(body);
    const snout = snoutIndex(body);
    const tail = tailIndex(body);
    for (let n = 0; n < 6; n++) {
      const index = n % 2 === 0 ? snout : tail;
      const p = body.particles[index];
      const dir = n % 2 === 0 ? 1 : -1;
      body.beginGrab(p.x, p.y);
      for (let i = 0; i < 8; i++) {
        body.moveGrab(p.x + dir * 0.9, p.y - 0.25, dir * 12, -4);
        body.step(1 / 60);
      }
      body.endGrab();
      for (let i = 0; i < 10; i++) body.step(1 / 60);
      const m = body.metrics();
      expect(m.finite).toBe(true);
      expect(m.maxEdge).toBeLessThanOrEqual(PARAMS.maxStretch + EDGE_TOL);
      expect(m.areaRatio).toBeGreaterThan(0.62);
      expect(m.areaRatio).toBeLessThan(1.45);
    }
    for (let i = 0; i < 180; i++) body.step(1 / 60);
    assertSettled(body);
  });

  it("releases a grab when the room changes and does not pile into a corner", () => {
    const body = createSoftBody();
    body.minX = -4;
    body.maxX = 4;
    body.minY = -3;
    body.maxY = 3;
    const snout = snoutIndex(body);
    const p = body.particles[snout];
    const before = span(body).w;
    body.beginGrab(p.x, p.y);
    body.moveGrab(p.x + 0.6, p.y, 2, 0);
    body.step(1 / 60);
    body.minX = -2.2;
    body.maxX = 2.2;
    body.minY = -1.8;
    body.maxY = 1.8;
    expect(body.adaptToRoom()).toBe(true);
    expect(body.grabbing).toBe(false);
    for (let i = 0; i < 40; i++) body.step(1 / 60);
    const box = span(body);
    expect(box.right).toBeLessThanOrEqual(body.maxX + 0.08);
    expect(box.left).toBeGreaterThanOrEqual(body.minX - 0.08);
    expect(box.w).toBeGreaterThan(before * 0.55);
    expect(body.metrics().maxEdge).toBeLessThanOrEqual(PARAMS.maxStretch + EDGE_TOL);
    expect(body.metrics().areaRatio).toBeGreaterThan(0.7);
  });

  it("matches a slow snout pull across frame rates", () => {
    const samples: { snout: number; tail: number; area: number; edge: number; speed: number }[] = [];
    for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
      const body = createSoftBody();
      openRoom(body);
      const snout = snoutIndex(body);
      const tail = tailIndex(body);
      const origin = body.particles[snout].x;
      const tail0 = body.particles[tail].x;
      const frames = Math.round(0.4 / dt);
      const p = body.particles[snout];
      body.beginGrab(p.x, p.y);
      for (let i = 1; i <= frames; i++) {
        const t = i / frames;
        body.moveGrab(p.restX + 0.8 * t, p.restY, 2, 0);
        body.step(dt);
      }
      const m = body.metrics();
      samples.push({
        snout: body.particles[snout].x - origin,
        tail: body.particles[tail].x - tail0,
        area: m.areaRatio,
        edge: m.maxEdge,
        speed: body.meanSpeed,
      });
      expect(m.maxEdge).toBeLessThanOrEqual(PARAMS.maxStretch + EDGE_TOL);
      expect(m.areaRatio).toBeGreaterThan(0.75);
      expect(m.areaRatio).toBeLessThan(1.35);
    }
    const base = samples[1];
    for (const sample of samples) {
      expect(Math.abs(sample.snout - base.snout)).toBeLessThan(Math.max(0.1, Math.abs(base.snout) * 0.15));
      expect(Math.abs(sample.area - base.area)).toBeLessThan(0.08);
      expect(sample.speed).toBeLessThan(base.speed * 1.75 + 0.4);
    }
    expect(samples[0].tail).toBeLessThan(samples[0].snout * 0.7);
  });
});
