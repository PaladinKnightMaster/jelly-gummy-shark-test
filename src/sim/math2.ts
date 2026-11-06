export type Pt = { x: number; y: number };

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function hypot(x: number, y: number): number {
  return Math.hypot(x, y);
}

/** Inverse square root of a symmetric 2×2 matrix [[a, b], [b, c]]. */
export function invSqrtSym(a: number, b: number, c: number): [number, number, number] {
  const tr = a + c;
  const det = a * c - b * b;
  const disc = Math.sqrt(Math.max(0, (tr * tr) * 0.25 - det));
  const eps = 1e-10;
  const l1 = Math.max(tr * 0.5 + disc, eps);
  const l2 = Math.max(tr * 0.5 - disc, eps);
  const s1 = 1 / Math.sqrt(l1);
  const s2 = 1 / Math.sqrt(l2);

  let v1x: number;
  let v1y: number;
  const scale = Math.abs(a) + Math.abs(c) + 1;
  if (Math.abs(b) < 1e-8 * scale) {
    if (a >= c) {
      v1x = 1;
      v1y = 0;
    } else {
      v1x = 0;
      v1y = 1;
    }
  } else {
    v1x = b;
    v1y = l1 - a;
    const n1 = Math.hypot(v1x, v1y);
    if (n1 < 1e-10) {
      v1x = 1;
      v1y = 0;
    } else {
      v1x /= n1;
      v1y /= n1;
    }
  }
  const v2x = -v1y;
  const v2y = v1x;
  const rayleigh = v1x * (a * v1x + b * v1y) + v1y * (b * v1x + c * v1y);
  const useSwap = Math.abs(rayleigh - l2) < Math.abs(rayleigh - l1);
  const ss1 = useSwap ? s2 : s1;
  const ss2 = useSwap ? s1 : s2;
  const s00 = ss1 * v1x * v1x + ss2 * v2x * v2x;
  const s01 = ss1 * v1x * v1y + ss2 * v2x * v2y;
  const s11 = ss1 * v1y * v1y + ss2 * v2y * v2y;
  return [s00, s01, s11];
}

/**
 * Polar factor of a 2×2 matrix. Returns a proper rotation (determinant +1).
 * Columns are stored [r00, r01, r10, r11] as [[r00, r01], [r10, r11]].
 */
export function polarRotation(
  a00: number,
  a01: number,
  a10: number,
  a11: number,
): [number, number, number, number] {
  if (![a00, a01, a10, a11].every(Number.isFinite)) return [1, 0, 0, 1];
  const ata00 = a00 * a00 + a10 * a10;
  const ata01 = a00 * a01 + a10 * a11;
  const ata11 = a01 * a01 + a11 * a11;
  if (ata00 + ata11 < 1e-12) return [1, 0, 0, 1];
  const [s00, s01] = invSqrtSym(ata00, ata01, ata11);
  let r00 = a00 * s00 + a01 * s01;
  let r10 = a10 * s00 + a11 * s01;
  const n0 = Math.hypot(r00, r10);
  if (n0 < 1e-8) return [1, 0, 0, 1];
  r00 /= n0;
  r10 /= n0;
  // Force a proper rotation so the shark cannot mirror itself.
  const r01 = -r10;
  const r11 = r00;
  return [r00, r01, r10, r11];
}

export function chaikinClosed(points: Pt[], iterations: number): Pt[] {
  let pts = points;
  for (let k = 0; k < iterations; k++) {
    const next: Pt[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    pts = next;
  }
  return pts;
}

export function resampleClosed(points: Pt[], count: number): Pt[] {
  const n = points.length;
  const cum: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[n];
  const out: Pt[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = (k * total) / count;
    while (seg < n - 1 && cum[seg + 1] < target) seg++;
    const span = cum[seg + 1] - cum[seg] || 1;
    const t = (target - cum[seg]) / span;
    const a = points[seg];
    const b = points[(seg + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

export function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const crosses = yi > y !== yj > y;
    if (crosses) {
      const xHit = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < xHit) inside = !inside;
    }
  }
  return inside;
}

export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = 0;
  if (len2 > 1e-12) t = clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return a * 0.5;
}

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
