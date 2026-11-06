import { drawShark } from "./render/drawShark";
import { createSoftBody, type SoftBody } from "./sim/softBody";

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
const hint = document.querySelector<HTMLElement>("#hint");
const pullButton = document.querySelector<HTMLButtonElement>("#mode-pull");
const dropButton = document.querySelector<HTMLButtonElement>("#mode-drop");
if (!canvas || !hint || !pullButton || !dropButton) throw new Error("Missing stage");
const ctx = canvas.getContext("2d", { alpha: false });
if (!ctx) throw new Error("Canvas unavailable");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const debug = new URLSearchParams(location.search).has("debug");
const body = createSoftBody({ intro: !reduceMotion });

let pointerId: number | null = null;
let lastX = 0;
let lastY = 0;
let lastT = 0;
let velX = 0;
let velY = 0;
let raf = 0;
let running = true;
let hintTimer = 0;

function showHint(text: string): void {
  hint!.textContent = text;
  hint!.classList.remove("hide");
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(hideHint, 3400);
}

function sharkLength(width: number, height: number): number {
  if (width < 760) return Math.min(width * 0.74, height * 0.5);
  return Math.min(height * 0.78, width * 0.5, 760);
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas!.width = Math.round(width * dpr);
  canvas!.height = Math.round(height * dpr);
  canvas!.style.width = `${width}px`;
  canvas!.style.height = `${height}px`;
  const length = sharkLength(width, height);
  const ppu = length / 2.4;
  const margin = 0.06;
  body.minX = -width / 2 / ppu + margin;
  body.maxX = width / 2 / ppu - margin;
  body.minY = -height / 2 / ppu + margin;
  body.maxY = height / 2 / ppu - margin;
  view.width = width;
  view.height = height;
  view.ppu = ppu;
  view.dpr = dpr;
}

const view = { width: 1, height: 1, ppu: 200, dpr: 1, debug };
resize();

function toWorld(event: PointerEvent): { x: number; y: number } {
  const rect = canvas!.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - rect.width / 2) / view.ppu,
    y: (event.clientY - rect.top - rect.height / 2) / view.ppu,
  };
}

function hideHint(): void {
  hint!.classList.add("hide");
}

function onPointerDown(event: PointerEvent): void {
  if (pointerId !== null) return;
  const point = toWorld(event);
  if (!body.beginGrab(point.x, point.y)) return;
  pointerId = event.pointerId;
  canvas!.setPointerCapture(event.pointerId);
  lastX = point.x;
  lastY = point.y;
  lastT = performance.now();
  velX = 0;
  velY = 0;
  canvas!.style.cursor = "grabbing";
  hideHint();
  event.preventDefault();
}

function onPointerMove(event: PointerEvent): void {
  const point = toWorld(event);
  if (pointerId !== event.pointerId) {
    if (pointerId === null) {
      canvas!.style.cursor = body.hitTest(point.x, point.y) ? "grab" : "default";
    }
    return;
  }
  const now = performance.now();
  const dt = Math.max(0.008, (now - lastT) / 1000);
  const ivx = (point.x - lastX) / dt;
  const ivy = (point.y - lastY) / dt;
  velX = velX * 0.35 + ivx * 0.65;
  velY = velY * 0.35 + ivy * 0.65;
  lastX = point.x;
  lastY = point.y;
  lastT = now;
  body.moveGrab(point.x, point.y, velX, velY);
  event.preventDefault();
}

function onPointerUp(event: PointerEvent): void {
  if (pointerId !== event.pointerId) return;
  body.endGrab();
  pointerId = null;
  const point = toWorld(event);
  canvas!.style.cursor = body.hitTest(point.x, point.y) ? "grab" : "default";
}

window.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);
window.addEventListener("resize", resize);

if (debug) {
  window.addEventListener("keydown", (event) => {
    if (event.key === "r") body.reset();
  });
}

function chooseMode(mode: "pull" | "drop"): void {
  body.setMode(mode);
  pullButton!.setAttribute("aria-pressed", mode === "pull" ? "true" : "false");
  dropButton!.setAttribute("aria-pressed", mode === "drop" ? "true" : "false");
  showHint(mode === "pull" ? "pull a spot" : "lift and drop");
}

function onPullMode(event: PointerEvent): void {
  event.stopPropagation();
  chooseMode("pull");
}

function onDropMode(event: PointerEvent): void {
  event.stopPropagation();
  chooseMode("drop");
}

const onPullClick = (): void => chooseMode("pull");
const onDropClick = (): void => chooseMode("drop");
pullButton.addEventListener("pointerdown", onPullMode);
dropButton.addEventListener("pointerdown", onDropMode);
pullButton.addEventListener("click", onPullClick);
dropButton.addEventListener("click", onDropClick);
showHint("pull a spot");

let lastFrame = performance.now();
function frame(now: number): void {
  if (!running) return;
  const dt = Math.min(0.033, (now - lastFrame) / 1000);
  lastFrame = now;
  body.step(dt);
  drawShark(ctx!, body, view);
  raf = requestAnimationFrame(frame);
}
raf = requestAnimationFrame(frame);

function cleanup(): void {
  running = false;
  cancelAnimationFrame(raf);
  window.removeEventListener("pointerdown", onPointerDown);
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  window.removeEventListener("resize", resize);
  pullButton!.removeEventListener("pointerdown", onPullMode);
  dropButton!.removeEventListener("pointerdown", onDropMode);
  pullButton!.removeEventListener("click", onPullClick);
  dropButton!.removeEventListener("click", onDropClick);
}

if (import.meta.hot) import.meta.hot.dispose(cleanup);

export type { SoftBody };
