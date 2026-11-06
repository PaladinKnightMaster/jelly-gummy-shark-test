import { PARAMS } from "../params";
import {
  chaikinClosed,
  distToSegment,
  mulberry32,
  pointInPolygon,
  resampleClosed,
  type Pt,
} from "./math2";

/** Hand-authored side profile in pixel space, y downward, snout to the right. */
const OUTLINE_RAW: Array<[number, number]> = [
  [982, 300],
  [966, 276],
  [930, 246],
  [860, 208],
  [775, 180],
  [690, 164],
  [620, 158],
  [582, 118],
  [550, 74],
  [524, 50],
  [498, 74],
  [468, 122],
  [438, 166],
  [360, 184],
  [285, 196],
  [220, 198],
  [176, 172],
  [138, 142],
  [108, 118],
  [96, 104],
  [112, 146],
  [152, 186],
  [176, 214],
  [188, 240],
  [172, 262],
  [136, 302],
  [108, 332],
  [96, 352],
  [122, 334],
  [166, 302],
  [204, 278],
  [258, 312],
  [328, 348],
  [368, 378],
  [392, 432],
  [412, 464],
  [436, 430],
  [462, 372],
  [518, 346],
  [572, 370],
  [608, 438],
  [636, 492],
  [670, 442],
  [718, 376],
  [792, 354],
  [848, 346],
  [892, 320],
  [938, 344],
  [966, 322],
];

const FEATURE_RAW = {
  eye: [808, 228] as [number, number],
  mouth: [
    [858, 336],
    [900, 322],
    [934, 336],
  ] as Array<[number, number]>,
  gills: [
    [
      [742, 214],
      [758, 248],
    ],
    [
      [706, 208],
      [724, 246],
    ],
    [
      [672, 210],
      [690, 242],
    ],
  ] as Array<[[number, number], [number, number]]>,
  highlights: [
    [760, 196],
    [610, 176],
    [500, 198],
    [880, 236],
    [390, 192],
  ] as Array<[number, number]>,
};

const FIN_SEEDS: Array<[number, number]> = [
  [530, 96],
  [512, 130],
  [548, 120],
  [630, 430],
  [650, 400],
  [600, 450],
  [408, 410],
  [396, 388],
  [124, 136],
  [140, 168],
  [122, 322],
  [146, 300],
  [860, 260],
  [800, 236],
  [910, 286],
  [500, 250],
  [400, 246],
  [620, 240],
];

export type Binding = {
  i: number;
  j: number;
  k: number;
  a: number;
  b: number;
  c: number;
};

export type MeshConstraint = {
  i: number;
  j: number;
  rest: number;
  stiffness: number;
  limit: boolean;
};

export type MeshCluster = {
  name: string;
  indices: number[];
  k: number;
  weight: number;
};

export type SharkMesh = {
  rest: Pt[];
  boundary: number[];
  thickness: number[];
  mass: number[];
  constraints: MeshConstraint[];
  clusters: MeshCluster[];
  features: {
    eye: Binding;
    mouth: [Binding, Binding, Binding];
    gills: Array<[Binding, Binding]>;
    highlights: Binding[];
    sugar: Binding[];
    blotches: Array<{ binding: Binding; radius: number; tone: number }>;
  };
};

function barycentric(
  px: number,
  py: number,
  a: Pt,
  b: Pt,
  c: Pt,
): [number, number, number] | null {
  const v0x = b.x - a.x;
  const v0y = b.y - a.y;
  const v1x = c.x - a.x;
  const v1y = c.y - a.y;
  const v2x = px - a.x;
  const v2y = py - a.y;
  const den = v0x * v1y - v1x * v0y;
  if (Math.abs(den) < 1e-8) return null;
  const bb = (v2x * v1y - v1x * v2y) / den;
  const cc = (v0x * v2y - v2x * v0y) / den;
  return [1 - bb - cc, bb, cc];
}

function bindPoint(x: number, y: number, pts: Pt[]): Binding {
  const ranked = pts
    .map((p, i) => ({ i, d: (p.x - x) ** 2 + (p.y - y) ** 2 }))
    .sort((p, q) => p.d - q.d)
    .slice(0, 8);
  for (let u = 0; u < ranked.length; u++) {
    for (let v = u + 1; v < ranked.length; v++) {
      for (let w = v + 1; w < ranked.length; w++) {
        const i = ranked[u].i;
        const j = ranked[v].i;
        const k = ranked[w].i;
        const coords = barycentric(x, y, pts[i], pts[j], pts[k]);
        if (!coords) continue;
        const [a, b, c] = coords;
        if (a >= -0.08 && b >= -0.08 && c >= -0.08) return { i, j, k, a, b, c };
      }
    }
  }
  const i = ranked[0].i;
  const j = ranked[1].i;
  const k = ranked[2].i;
  const wa = 1 / (Math.sqrt(ranked[0].d) + 1e-4);
  const wb = 1 / (Math.sqrt(ranked[1].d) + 1e-4);
  const wc = 1 / (Math.sqrt(ranked[2].d) + 1e-4);
  const sum = wa + wb + wc;
  return { i, j, k, a: wa / sum, b: wb / sum, c: wc / sum };
}

function thicknessAt(x: number, y: number, boundary: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    best = Math.min(best, distToSegment(x, y, a.x, a.y, b.x, b.y));
  }
  return best;
}

function nearBoundary(x: number, y: number, boundary: Pt[], slack: number): boolean {
  if (pointInPolygon(x, y, boundary)) return true;
  return thicknessAt(x, y, boundary) <= slack;
}

export function buildSharkMesh(): SharkMesh {
  const raw = OUTLINE_RAW.map(([x, y]) => ({ x, y }));
  const smoothed = chaikinClosed(raw, 2);
  const boundaryPts = resampleClosed(smoothed, 108);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of boundaryPts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = 2.4 / (maxX - minX);
  const toWorld = (x: number, y: number): Pt => ({
    x: (x - cx) * scale,
    y: (y - cy) * scale,
  });

  const boundary = boundaryPts.map((p) => toWorld(p.x, p.y));
  const spacing = 0.072;
  const interior: Pt[] = [];
  const minWX = Math.min(...boundary.map((p) => p.x));
  const maxWX = Math.max(...boundary.map((p) => p.x));
  const minWY = Math.min(...boundary.map((p) => p.y));
  const maxWY = Math.max(...boundary.map((p) => p.y));

  const tryAdd = (x: number, y: number, clearance: number) => {
    if (!pointInPolygon(x, y, boundary)) return;
    if (thicknessAt(x, y, boundary) < clearance) return;
    for (const p of interior) {
      if ((p.x - x) ** 2 + (p.y - y) ** 2 < clearance * clearance) return;
    }
    interior.push({ x, y });
  };

  let row = 0;
  for (let y = minWY; y <= maxWY; y += spacing * 0.86) {
    const xoff = row % 2 ? spacing * 0.5 : 0;
    for (let x = minWX + xoff; x <= maxWX; x += spacing) tryAdd(x, y, spacing * 0.42);
    row++;
  }
  for (const [x, y] of FIN_SEEDS) {
    const p = toWorld(x, y);
    tryAdd(p.x, p.y, 0.03);
  }

  const rest = boundary.concat(interior);
  const boundaryIndex = boundary.map((_, i) => i);
  const bCount = boundary.length;
  const thickness = rest.map((p, i) => (i < bCount ? 0.012 : thicknessAt(p.x, p.y, boundary)));
  const mass = thickness.map((t) => 0.5 + t * 2.4);

  const constraints: MeshConstraint[] = [];
  const seen = new Set<string>();
  const add = (i: number, j: number, stiffness: number, limit: boolean) => {
    if (i === j) return;
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const key = `${a}:${b}`;
    if (seen.has(key)) return;
    const restLen = Math.hypot(rest[a].x - rest[b].x, rest[a].y - rest[b].y);
    if (restLen < 1e-5) return;
    seen.add(key);
    constraints.push({ i: a, j: b, rest: restLen, stiffness, limit });
  };

  for (let i = 0; i < bCount; i++) add(i, (i + 1) % bCount, PARAMS.boundaryStiffness, true);
  for (let i = 0; i < bCount; i++) {
    const j = (i + 2) % bCount;
    const mid = {
      x: (rest[i].x + rest[j].x) / 2,
      y: (rest[i].y + rest[j].y) / 2,
    };
    if (nearBoundary(mid.x, mid.y, boundary, 0.03)) add(i, j, PARAMS.bendStiffness, false);
  }

  const linkRadius = spacing * 1.72;
  const cell = linkRadius;
  const buckets = new Map<string, number[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  rest.forEach((p, i) => {
    const key = keyOf(p.x, p.y);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  });

  for (let i = 0; i < rest.length; i++) {
    const p = rest[i];
    const gx = Math.floor(p.x / cell);
    const gy = Math.floor(p.y / cell);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const bucket = buckets.get(`${gx + ox},${gy + oy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const q = rest[j];
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d > linkRadius) continue;
          const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
          const boundaryEdge =
            i < bCount && j < bCount && (Math.abs(i - j) === 1 || Math.abs(i - j) === bCount - 1);
          if (!boundaryEdge && !nearBoundary(mid.x, mid.y, boundary, 0.025)) continue;
          // Long near-boundary bars are a hard scaffold so the outline cannot
          // accordion. Short links stay soft: locking every one of them at
          // once does not converge once the candy flattens.
          const edgeStiffness =
            i < bCount && j < bCount ? PARAMS.boundaryStiffness : PARAMS.distanceStiffness;
          add(i, j, edgeStiffness, d >= 0.09);
        }
      }
    }
  }

  const len = maxWX - minWX;
  const height = maxWY - minWY;
  const x0 = minWX;
  const y0 = minWY;
  const along = (p: Pt) => (p.x - x0) / len;
  const down = (p: Pt) => (p.y - y0) / height;

  const pick = (pred: (p: Pt) => boolean) =>
    rest.map((p, i) => (pred(p) ? i : -1)).filter((i) => i >= 0);

  const clusters: MeshCluster[] = [
    {
      name: "global",
      indices: rest.map((_, i) => i),
      k: PARAMS.globalK,
      weight: PARAMS.globalWeight,
    },
    { name: "head", indices: pick((p) => along(p) > 0.66), k: PARAMS.headK, weight: 1 },
    {
      name: "thorax",
      indices: pick((p) => along(p) > 0.4 && along(p) < 0.74 && down(p) > 0.16 && down(p) < 0.84),
      k: PARAMS.thoraxK,
      weight: 0.82,
    },
    {
      name: "abdomen",
      indices: pick((p) => along(p) > 0.18 && along(p) < 0.5 && down(p) > 0.18 && down(p) < 0.86),
      k: PARAMS.abdomenK,
      weight: 0.78,
    },
    { name: "tail", indices: pick((p) => along(p) < 0.24), k: PARAMS.tailK, weight: 1 },
    {
      name: "dorsal",
      indices: pick((p) => down(p) < 0.3 && along(p) > 0.34 && along(p) < 0.7),
      k: PARAMS.dorsalK,
      weight: 1.2,
    },
    {
      name: "pectoral",
      indices: pick((p) => down(p) > 0.7 && along(p) > 0.46 && along(p) < 0.8),
      k: PARAMS.pectoralK,
      weight: 1.2,
    },
    {
      name: "pelvic",
      indices: pick((p) => down(p) > 0.68 && along(p) > 0.26 && along(p) < 0.5),
      k: PARAMS.pelvicK,
      weight: 1.1,
    },
  ].filter((cluster) => cluster.indices.length >= 3);

  const worldFeatures = {
    eye: toWorld(...FEATURE_RAW.eye),
    mouth: FEATURE_RAW.mouth.map(([x, y]) => toWorld(x, y)),
    gills: FEATURE_RAW.gills.map(
      ([a, b]) => [toWorld(...a), toWorld(...b)] as [Pt, Pt],
    ),
    highlights: FEATURE_RAW.highlights.map(([x, y]) => toWorld(x, y)),
  };

  const rand = mulberry32(0x5a4a);
  const sugar: Binding[] = [];
  let guard = 0;
  while (sugar.length < 42 && guard < 800) {
    guard++;
    const x = minWX + rand() * len;
    const y = minWY + rand() * height;
    if (!pointInPolygon(x, y, boundary)) continue;
    const thick = thicknessAt(x, y, boundary);
    if (thick < 0.02 || thick > 0.22) continue;
    sugar.push(bindPoint(x, y, rest));
  }

  const blotchSeeds: Array<{ at: [number, number]; radius: number; tone: number }> = [
    { at: [520, 250], radius: 0.34, tone: 0.2 },
    { at: [700, 230], radius: 0.26, tone: -0.12 },
    { at: [390, 250], radius: 0.28, tone: 0.08 },
    { at: [840, 270], radius: 0.2, tone: -0.18 },
    { at: [600, 320], radius: 0.22, tone: 0.16 },
  ];
  const blotches = blotchSeeds.map((seed) => {
    const p = toWorld(...seed.at);
    return { binding: bindPoint(p.x, p.y, rest), radius: seed.radius, tone: seed.tone };
  });

  return {
    rest,
    boundary: boundaryIndex,
    thickness,
    mass,
    constraints,
    clusters,
    features: {
      eye: bindPoint(worldFeatures.eye.x, worldFeatures.eye.y, rest),
      mouth: worldFeatures.mouth.map((p) => bindPoint(p.x, p.y, rest)) as [
        Binding,
        Binding,
        Binding,
      ],
      gills: worldFeatures.gills.map(
        ([a, b]) => [bindPoint(a.x, a.y, rest), bindPoint(b.x, b.y, rest)] as [Binding, Binding],
      ),
      highlights: worldFeatures.highlights.map((p) => bindPoint(p.x, p.y, rest)),
      sugar,
      blotches,
    },
  };
}

export function evalBinding(binding: Binding, points: Pt[]): Pt {
  return {
    x:
      binding.a * points[binding.i].x +
      binding.b * points[binding.j].x +
      binding.c * points[binding.k].x,
    y:
      binding.a * points[binding.i].y +
      binding.b * points[binding.j].y +
      binding.c * points[binding.k].y,
  };
}

export type Frame = { f00: number; f01: number; f10: number; f11: number };

export function bindingFrame(binding: Binding, current: Pt[], rest: Pt[]): Frame {
  const ri = rest[binding.i];
  const rj = rest[binding.j];
  const rk = rest[binding.k];
  const pi = current[binding.i];
  const pj = current[binding.j];
  const pk = current[binding.k];
  const ax = rj.x - ri.x;
  const ay = rj.y - ri.y;
  const bx = rk.x - ri.x;
  const by = rk.y - ri.y;
  const cx = pj.x - pi.x;
  const cy = pj.y - pi.y;
  const dx = pk.x - pi.x;
  const dy = pk.y - pi.y;
  const den = ax * by - bx * ay;
  if (Math.abs(den) < 1e-8) return { f00: 1, f01: 0, f10: 0, f11: 1 };
  const inv00 = by / den;
  const inv01 = -bx / den;
  const inv10 = -ay / den;
  const inv11 = ax / den;
  return {
    f00: cx * inv00 + dx * inv10,
    f01: cx * inv01 + dx * inv11,
    f10: cy * inv00 + dy * inv10,
    f11: cy * inv01 + dy * inv11,
  };
}
