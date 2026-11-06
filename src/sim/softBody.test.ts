import { describe, expect, it } from "vitest";
import { evalBinding } from "./geometry";
import { createSoftBody } from "./softBody";

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

  it("stretches near a grab and leaves the tail behind", () => {
    const body = createSoftBody();
    body.minX = -6;
    body.maxX = 6;
    body.minY = -4;
    body.maxY = 4;
    const snout = snoutIndex(body);
    const tail = tailIndex(body);
    const origin = body.particles[snout];
    expect(body.beginGrab(origin.x, origin.y)).toBe(true);
    for (let i = 0; i < 18; i++) {
      body.moveGrab(origin.restX + 0.95, origin.restY, 0.2, 0);
      body.step(1 / 60);
    }
    const snoutShift = body.particles[snout].x - origin.restX;
    const tailShift = body.particles[tail].x - body.particles[tail].restX;
    expect(snoutShift).toBeGreaterThan(0.55);
    expect(tailShift).toBeLessThan(snoutShift * 0.72);
    for (const p of body.particles) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("recovers toward the resting snout after a pull", () => {
    const body = createSoftBody();
    body.minX = -6;
    body.maxX = 6;
    body.minY = -4;
    body.maxY = 4;
    const snout = snoutIndex(body);
    const origin = body.particles[snout];
    body.beginGrab(origin.x, origin.y);
    for (let i = 0; i < 16; i++) {
      body.moveGrab(origin.restX + 0.8, origin.restY - 0.15, 0, 0);
      body.step(1 / 60);
    }
    const pulled = body.particles[snout].x;
    body.endGrab();
    for (let i = 0; i < 300; i++) body.step(1 / 60);
    const recovered = Math.abs(body.particles[snout].x - origin.restX);
    expect(recovered).toBeLessThan(Math.abs(pulled - origin.restX) * 0.55);
    expect(body.meanSpeed).toBeLessThan(1.2);
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
    for (let i = 0; i < 90; i++) body.step(1 / 60);
    const a = body.particles[b[(flipped - 1 + b.length) % b.length]];
    const p = body.particles[b[flipped]];
    const c = body.particles[b[(flipped + 1) % b.length]];
    const restCross =
      (p.restX - a.restX) * (c.restY - p.restY) - (p.restY - a.restY) * (c.restX - p.restX);
    const cross = (p.x - a.x) * (c.y - p.y) - (p.y - a.y) * (c.x - p.x);
    expect(restCross * cross).toBeGreaterThan(0);
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
  });
});
