import { evalBinding, bindingFrame, type Binding, type Frame } from "../sim/geometry";
import { chaikinClosed, clamp, type Pt } from "../sim/math2";
import type { SoftBody } from "../sim/softBody";

export type View = {
  width: number;
  height: number;
  ppu: number;
  dpr: number;
  debug: boolean;
};

function limitFrame(frame: Frame): Frame {
  const s0 = Math.hypot(frame.f00, frame.f10) || 1;
  const s1 = Math.hypot(frame.f01, frame.f11) || 1;
  const c0 = clamp(s0, 0.5, 1.85) / s0;
  const c1 = clamp(s1, 0.5, 1.85) / s1;
  const f00 = frame.f00 * c0;
  const f10 = frame.f10 * c0;
  let f01 = frame.f01 * c1;
  let f11 = frame.f11 * c1;
  if (f00 * f11 - f01 * f10 < 0) {
    f01 = -f01;
    f11 = -f11;
  }
  return { f00, f01, f10, f11 };
}

function smoothPath(points: Pt[], project: (p: Pt) => [number, number]): Path2D {
  const smooth = chaikinClosed(points, 2);
  const path = new Path2D();
  const [x0, y0] = project(smooth[0]);
  path.moveTo(x0, y0);
  for (let i = 1; i < smooth.length; i++) {
    const [x, y] = project(smooth[i]);
    path.lineTo(x, y);
  }
  path.closePath();
  return path;
}

export function drawShark(
  ctx: CanvasRenderingContext2D,
  body: SoftBody,
  view: View,
): void {
  const { width, height, ppu, dpr } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createRadialGradient(
    width * 0.5,
    height * 0.42,
    ppu * 0.2,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.72,
  );
  bg.addColorStop(0, "#fffaf6");
  bg.addColorStop(0.48, "#f4efe7");
  bg.addColorStop(1, "#e3dbd0");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    Math.min(width, height) * 0.35,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.72,
  );
  vignette.addColorStop(0, "rgba(255,255,255,0)");
  vignette.addColorStop(1, "rgba(120, 90, 70, 0.16)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const floorY = height / 2 + body.maxY * ppu;
  const table = ctx.createLinearGradient(0, floorY - ppu * 0.55, 0, height);
  table.addColorStop(0, "rgba(255,250,246,0)");
  table.addColorStop(0.42, "rgba(214, 196, 176, 0.28)");
  table.addColorStop(1, "rgba(186, 164, 142, 0.45)");
  ctx.fillStyle = table;
  ctx.fillRect(0, Math.max(0, floorY - ppu * 0.45), width, height);
  ctx.beginPath();
  ctx.moveTo(width * 0.08, floorY);
  ctx.lineTo(width * 0.92, floorY);
  ctx.strokeStyle = "rgba(140, 110, 90, 0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const project = (p: Pt): [number, number] => [
    width / 2 + p.x * ppu,
    height / 2 + p.y * ppu,
  ];
  const outline = body.boundary.map((index) => body.particles[index]);
  const path = smoothPath(outline, project);

  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let lowest = -Infinity;
  for (const p of outline) {
    const [x, y] = project(p);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    lowest = Math.max(lowest, p.y);
  }

  const com = body.center();
  const gap = Math.max(0, body.maxY - lowest);
  const shadowAlpha = 0.3 / (1 + gap * 1.35);
  ctx.save();
  ctx.translate(width / 2 + com.x * ppu, floorY - 2);
  ctx.scale(1.02 + gap * 0.03, 0.14 + Math.min(gap, 1.1) * 0.05);
  ctx.translate(-(width / 2 + com.x * ppu), -(height / 2 + com.y * ppu));
  ctx.fillStyle = `rgba(78, 32, 40, ${shadowAlpha})`;
  ctx.shadowColor = `rgba(70, 28, 36, ${shadowAlpha})`;
  ctx.shadowBlur = 16 + gap * ppu * 0.22;
  ctx.fill(path);
  ctx.restore();

  const candy = ctx.createLinearGradient(0, minY - 12, 0, maxY + 16);
  candy.addColorStop(0, "#ffd0dc");
  candy.addColorStop(0.3, "#ff5b7a");
  candy.addColorStop(0.68, "#ef1d50");
  candy.addColorStop(1, "#d21448");
  ctx.fillStyle = candy;
  ctx.fill(path);

  ctx.save();
  ctx.clip(path);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(18, ppu * 0.09);
  ctx.strokeStyle = "rgba(255, 214, 224, 0.55)";
  ctx.stroke(path);

  const core = body.features.blotches[0]?.binding ?? body.features.highlights[0];
  const belly = body.features.blotches[4]?.binding ?? core;
  drawDeformedDisc(ctx, body, core, project, ppu, 0.46, 0.24, "rgba(146, 10, 46, 0.62)", "rgba(146, 10, 46, 0)");
  drawDeformedDisc(ctx, body, core, project, ppu, 0.24, 0.13, "rgba(102, 4, 32, 0.38)", "rgba(102, 4, 32, 0)");
  paintTip(ctx, body, project, ppu, (p) => -p.restY);
  paintTip(ctx, body, project, ppu, (p) => p.restY);
  paintTip(ctx, body, project, ppu, (p) => -p.restX);
  drawDeformedDisc(ctx, body, belly, project, ppu, 0.34, 0.16, "rgba(255, 196, 196, 0.42)", "rgba(255, 196, 196, 0)");
  for (const blotch of body.features.blotches) {
    const color = blotch.tone >= 0 ? "rgba(176, 16, 52, 0.16)" : "rgba(255, 170, 160, 0.2)";
    drawDeformedDisc(
      ctx,
      body,
      blotch.binding,
      project,
      ppu,
      blotch.radius * 0.85,
      blotch.radius * 0.55,
      color,
      "rgba(255,255,255,0)",
    );
  }

  const lamp = ctx.createRadialGradient(
    (minX + maxX) * 0.42,
    minY + (maxY - minY) * 0.18,
    ppu * 0.05,
    (minX + maxX) * 0.48,
    minY + (maxY - minY) * 0.35,
    (maxX - minX) * 0.55,
  );
  lamp.addColorStop(0, "rgba(255,255,255,0.42)");
  lamp.addColorStop(0.45, "rgba(255,255,255,0.08)");
  lamp.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = lamp;
  ctx.fillRect(minX - 20, minY - 20, maxX - minX + 40, maxY - minY + 40);

  const placed = body.features.highlights.map((binding) => {
    const at = evalBinding(binding, body.particles);
    return { binding, at };
  });
  placed.sort((a, b) => a.at.y - b.at.y);
  drawGlint(ctx, body, placed[0].binding, placed[0].at, project, ppu, 0.2, 0.075, 0.62);
  if (placed[1]) {
    drawGlint(ctx, body, placed[1].binding, placed[1].at, project, ppu, 0.09, 0.04, 0.78);
  }

  ctx.fillStyle = "rgba(255,255,255,0.42)";
  body.features.sugar.forEach((speck, index) => {
    if (index % 2) return;
    const at = evalBinding(speck, body.particles);
    const [x, y] = project(at);
    ctx.beginPath();
    ctx.arc(x, y, index % 4 === 0 ? 1.6 : 1.1, 0, Math.PI * 2);
    ctx.fill();
  });

  const grab = body.grabPoint();
  if (grab) {
    const [x, y] = project(grab);
    const radius = ppu * 0.18;
    const press = ctx.createRadialGradient(x, y, 2, x, y, radius);
    press.addColorStop(0, "rgba(255,255,255,0.55)");
    press.addColorStop(0.45, "rgba(255,255,255,0.16)");
    press.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = press;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  drawFace(ctx, body, project, ppu);

  ctx.lineWidth = Math.max(7, ppu * 0.035);
  ctx.strokeStyle = "rgba(92, 8, 32, 0.16)";
  ctx.stroke(path);
  ctx.restore();

  const rim = ctx.createLinearGradient(0, minY, 0, maxY);
  rim.addColorStop(0, "rgba(255,255,255,0.5)");
  rim.addColorStop(0.42, "rgba(255,255,255,0.14)");
  rim.addColorStop(0.74, "rgba(255, 186, 196, 0.12)");
  rim.addColorStop(1, "rgba(120, 16, 40, 0.28)");
  ctx.lineWidth = Math.max(1.6, ppu * 0.01);
  ctx.strokeStyle = rim;
  ctx.lineJoin = "round";
  ctx.stroke(path);

  if (view.debug) drawDebug(ctx, body, project);
}

function paintTip(
  ctx: CanvasRenderingContext2D,
  body: SoftBody,
  project: (p: Pt) => [number, number],
  ppu: number,
  score: (p: { restX: number; restY: number }) => number,
): void {
  let best = body.particles[0];
  let bestScore = score(best);
  for (const particle of body.particles) {
    const value = score(particle);
    if (value > bestScore) {
      best = particle;
      bestScore = value;
    }
  }
  const [x, y] = project(best);
  const radius = ppu * 0.16;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, "rgba(255, 228, 234, 0.5)");
  glow.addColorStop(1, "rgba(255, 228, 234, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawDeformedDisc(
  ctx: CanvasRenderingContext2D,
  body: SoftBody,
  binding: SoftBody["features"]["highlights"][number],
  project: (p: Pt) => [number, number],
  ppu: number,
  rx: number,
  ry: number,
  inner: string,
  outer: string,
): void {
  const at = evalBinding(binding, body.particles);
  const frame = limitFrame(bindingFrame(binding, body.particles, restOf(body)));
  const [x, y] = project(at);
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(frame.f00 * ppu, frame.f10 * ppu, frame.f01 * ppu, frame.f11 * ppu, 0, 0);
  const g = ctx.createRadialGradient(0, -ry * 0.15, rx * 0.08, 0, 0, Math.max(rx, ry));
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGlint(
  ctx: CanvasRenderingContext2D,
  body: SoftBody,
  binding: SoftBody["features"]["highlights"][number],
  at: Pt,
  project: (p: Pt) => [number, number],
  ppu: number,
  rx: number,
  ry: number,
  alpha: number,
): void {
  const frame = limitFrame(bindingFrame(binding, body.particles, restOf(body)));
  const [x, y] = project(at);
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(frame.f00 * ppu, frame.f10 * ppu, frame.f01 * ppu, frame.f11 * ppu, 0, 0);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  body: SoftBody,
  project: (p: Pt) => [number, number],
  ppu: number,
): void {
  const rest = restOf(body);
  const eyeAt = evalBinding(body.features.eye, body.particles);
  const frame = limitFrame(bindingFrame(body.features.eye, body.particles, rest));
  const [ex, ey] = project(eyeAt);
  ctx.save();
  ctx.translate(ex, ey);
  ctx.transform(frame.f00 * ppu, frame.f10 * ppu, frame.f01 * ppu, frame.f11 * ppu, 0, 0);
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.052, 0.04, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(74, 8, 26, 0.78)";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-0.014, -0.012, 0.014, 0.009, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fill();
  ctx.restore();

  const eyeRest = evalBinding(body.features.eye, rest);
  const place = (binding: Binding): Pt => {
    const p = evalBinding(binding, rest);
    const dx = p.x - eyeRest.x;
    const dy = p.y - eyeRest.y;
    return {
      x: eyeAt.x + frame.f00 * dx + frame.f01 * dy,
      y: eyeAt.y + frame.f10 * dx + frame.f11 * dy,
    };
  };
  strokeBound(ctx, body.features.mouth.map(place), project, ppu, 0.018, "rgba(80, 10, 28, 0.45)");
  for (const gill of body.features.gills) {
    strokeBound(ctx, gill.map(place), project, ppu, 0.012, "rgba(90, 12, 32, 0.32)");
  }
}

function strokeBound(
  ctx: CanvasRenderingContext2D,
  points: Pt[],
  project: (p: Pt) => [number, number],
  ppu: number,
  width: number,
  color: string,
): void {
  const screen = points.map(project);
  ctx.beginPath();
  ctx.moveTo(screen[0][0], screen[0][1]);
  if (screen.length === 3) {
    ctx.quadraticCurveTo(screen[1][0], screen[1][1], screen[2][0], screen[2][1]);
  } else {
    for (let i = 1; i < screen.length; i++) ctx.lineTo(screen[i][0], screen[i][1]);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, ppu * width);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function restOf(body: SoftBody): Pt[] {
  return body.particles.map((p) => ({ x: p.restX, y: p.restY }));
}

function drawDebug(
  ctx: CanvasRenderingContext2D,
  body: SoftBody,
  project: (p: Pt) => [number, number],
): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(20,40,80,0.25)";
  ctx.beginPath();
  for (const p of body.particles) {
    const [x, y] = project(p);
    ctx.moveTo(x, y);
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.fillStyle = "rgba(40, 30, 30, 0.7)";
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText(`speed ${body.meanSpeed.toFixed(2)}  t ${body.time.toFixed(2)}`, 12, 20);
  ctx.restore();
}
